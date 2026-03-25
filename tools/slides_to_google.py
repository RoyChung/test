#!/usr/bin/env python3
"""
Convert a YAML slide definition to Google Slides in your Google Drive.

Supports: titles, body text (with native bullet lists from •, -, *), tables, images (local files uploaded to Drive or URLs).

Setup:
  1. Create a Google Cloud project and enable Slides API + Drive API
  2. Create OAuth 2.0 credentials (Desktop app), download as credentials.json
  3. Place credentials.json in project root (or set SLIDES_CREDENTIALS_PATH)
  4. Run once; browser opens for consent. Token is saved to token.json.

Usage:
  .venv/bin/python3 tools/slides_to_google.py slides.yaml
  .venv/bin/python3 tools/slides_to_google.py slides.yaml --update PRESENTATION_ID
  .venv/bin/python3 tools/slides_to_google.py slides.yaml -o "My Presentation"
"""
import argparse
import hashlib
import os
import sys
from pathlib import Path
import re
import uuid
from typing import List, Optional, Tuple

# EMU: English Metric Units. 1 inch = 914400 EMU.
EMU_PER_INCH = 914400
BODY_FONT_SIZE_PT = 14
BODY_LINE_SPACING = 115
LOCAL_IMAGE_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*\.(png|jpg|jpeg|gif|webp)$")

# User-level config dir (industry practice: ~/.config/app-name/)
USER_CONFIG_DIR = Path.home() / ".config" / "slides-to-google"


def _resolve_credentials_paths(
    explicit_path: Optional[str], project_root: Path
) -> Tuple[str, str]:
    """
    Resolve credentials and token paths (industry practice: env var > user config > project).
    Priority: --credentials > SLIDES_CREDENTIALS_PATH > GOOGLE_APPLICATION_CREDENTIALS
              > ~/.config/slides-to-google/ > .secrets/
    """
    if explicit_path:
        p = Path(explicit_path).resolve()
        return str(p), str(p.parent / "token.json")

    env_path = os.environ.get("SLIDES_CREDENTIALS_PATH") or os.environ.get(
        "GOOGLE_APPLICATION_CREDENTIALS"
    )
    if env_path:
        p = Path(env_path).expanduser().resolve()
        return str(p), str(p.parent / "token.json")

    user_creds = USER_CONFIG_DIR / "credentials.json"
    if user_creds.exists():
        return str(user_creds), str(USER_CONFIG_DIR / "token.json")

    secrets_dir = project_root / ".secrets"
    return str(secrets_dir / "credentials.json"), str(secrets_dir / "token.json")


def get_credentials(credentials_path: str, token_path: str):
    """Load OAuth credentials, refreshing token if needed."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    SCOPES = [
        "https://www.googleapis.com/auth/presentations",
        "https://www.googleapis.com/auth/drive",
    ]

    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(credentials_path):
                print(
                    f"Credentials not found at {credentials_path}",
                    file=sys.stderr,
                )
                print(
                    "Create OAuth 2.0 credentials (Desktop) in Google Cloud Console,",
                    file=sys.stderr,
                )
                print(
                    "enable Slides API + Drive API, then download credentials.json.",
                    file=sys.stderr,
                )
                print(
                    "Place in .secrets/, ~/.config/slides-to-google/, or set SLIDES_CREDENTIALS_PATH.",
                    file=sys.stderr,
                )
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(
                credentials_path, SCOPES
            )
            creds = flow.run_local_server(port=0)

        os.makedirs(os.path.dirname(token_path) or ".", exist_ok=True)
        with open(token_path, "w") as f:
            f.write(creds.to_json())

    return creds


def upload_image_to_drive(drive_service, local_path: str, base_dir: Path) -> str:
    """Upload a local image to Drive and return a public download URL."""
    from googleapiclient.http import MediaFileUpload

    path = (base_dir / local_path).resolve() if not os.path.isabs(local_path) else Path(local_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")

    project_root = Path(__file__).resolve().parent.parent
    allowed_dir = (project_root / "slides" / "assets").resolve()
    try:
        path.relative_to(allowed_dir)
    except ValueError:
        raise ValueError(
            f"Local images must live under {allowed_dir}. Got: {path}"
        )

    if not LOCAL_IMAGE_NAME_RE.match(path.name):
        raise ValueError(
            "Local image filenames must use kebab-case, e.g. ai-competence-matrix.png"
        )

    name = path.name
    mime = "image/png"
    if name.lower().endswith(".jpg") or name.lower().endswith(".jpeg"):
        mime = "image/jpeg"
    elif name.lower().endswith(".gif"):
        mime = "image/gif"

    local_md5 = hashlib.md5(path.read_bytes()).hexdigest()
    escaped_name = name.replace("'", "\\'")
    query = f"name = '{escaped_name}' and trashed = false"
    existing = (
        drive_service.files()
        .list(q=query, fields="files(id,name,md5Checksum,permissions(type,role))")
        .execute()
        .get("files", [])
    )
    for file in existing:
        if file.get("md5Checksum") != local_md5:
            continue
        perms = file.get("permissions", [])
        is_public = any(
            perm.get("type") == "anyone" and perm.get("role") == "reader"
            for perm in perms
        )
        if not is_public:
            drive_service.permissions().create(
                fileId=file["id"],
                body={"role": "reader", "type": "anyone"},
            ).execute()
        return f"https://drive.google.com/uc?export=download&id={file['id']}"

    file_metadata = {"name": name}
    media = MediaFileUpload(str(path), mimetype=mime, resumable=True)
    file = (
        drive_service.files()
        .create(body=file_metadata, media_body=media, fields="id")
        .execute()
    )
    file_id = file["id"]

    drive_service.permissions().create(
        fileId=file_id,
        body={"role": "reader", "type": "anyone"},
    ).execute()

    return f"https://drive.google.com/uc?export=download&id={file_id}"


def resolve_image_url(
    drive_service, value: str, base_dir: Path
) -> str:
    """Return a public URL. If value is a local path, upload to Drive first."""
    s = str(value).strip()
    if s.startswith(("http://", "https://")):
        return s
    return upload_image_to_drive(drive_service, s, base_dir)


# Bullet characters that start a bullet line (after stripping leading spaces)
_BULLET_CHARS = ("•", "-", "*", "○", "▪", "▸")
# Regex: optional spaces, bullet char (-, *, •), optional space
_BULLET_PATTERN = re.compile(r"^\s*[-*•]\s*")


def _is_bullet_line(stripped: str) -> bool:
    """True if the line (stripped of leading/trailing whitespace) is a bullet line."""
    if not stripped:
        return False
    if stripped[0] in _BULLET_CHARS:
        return True
    return bool(_BULLET_PATTERN.match(stripped))


def _strip_bullet_prefix(line: str) -> str:
    """Remove bullet character and optional trailing space from a bullet line."""
    stripped = line.lstrip()
    indent = len(line) - len(stripped)
    if not stripped:
        return line
    # Remove first character if it's a bullet
    if stripped[0] in _BULLET_CHARS:
        rest = stripped[1:].lstrip()
        return "\t" * (indent // 2) + rest
    m = _BULLET_PATTERN.match(stripped)
    if m:
        rest = stripped[m.end() :].lstrip()
        return "\t" * (indent // 2) + rest
    return line


def parse_content_for_bullets(content: str) -> Tuple[str, List[Tuple[int, int]]]:
    """Parse content, strip bullet prefixes, and return cleaned text plus bullet ranges.

    Returns:
        (cleaned_text, bullet_ranges) where bullet_ranges is a list of (start, end)
        character indices for contiguous bullet blocks in the cleaned text.
    """
    lines = content.split("\n")
    cleaned_parts: List[str] = []
    bullet_ranges: List[Tuple[int, int]] = []
    current_block_start: Optional[int] = None
    pos = 0

    for line in lines:
        stripped = line.strip()
        if _is_bullet_line(stripped):
            cleaned = _strip_bullet_prefix(line)
        else:
            cleaned = line

        # Ensure we end with newline for paragraph boundaries
        if not cleaned.endswith("\n") and cleaned:
            cleaned += "\n"

        start = pos
        end = pos + len(cleaned)
        pos = end

        cleaned_parts.append(cleaned)

        if _is_bullet_line(stripped):
            if current_block_start is None:
                current_block_start = start
        else:
            if current_block_start is not None:
                bullet_ranges.append((current_block_start, start))
                current_block_start = None

    if current_block_start is not None:
        bullet_ranges.append((current_block_start, pos))

    cleaned_text = "".join(cleaned_parts).rstrip("\n")
    if cleaned_text and not cleaned_text.endswith("\n"):
        cleaned_text += "\n"

    return cleaned_text, bullet_ranges


def _body_paragraph_style_request(object_id: str) -> dict:
    """Default paragraph styling for body text across generated slides."""
    return {
        "updateParagraphStyle": {
            "objectId": object_id,
            "textRange": {"type": "ALL"},
            "style": {
                "lineSpacing": BODY_LINE_SPACING,
            },
            "fields": "lineSpacing",
        },
    }


def _estimate_wrapped_line_count(text: str, max_chars_per_line: int = 30) -> int:
    """Rough line-count estimate for title placement decisions."""
    words = text.split()
    if not words:
        return 1

    lines = 1
    current = 0
    for word in words:
        word_len = len(word)
        if current == 0:
            current = word_len
            continue
        if current + 1 + word_len <= max_chars_per_line:
            current += 1 + word_len
        else:
            lines += 1
            current = word_len
    return lines


def _relative_translate_y_request(object_id: str, translate_y_pt: float) -> dict:
    """Move a page element down relative to its current position."""
    return {
        "updatePageElementTransform": {
            "objectId": object_id,
            "applyMode": "RELATIVE",
            "transform": {
                "scaleX": 1,
                "scaleY": 1,
                "translateX": 0,
                "translateY": translate_y_pt,
                "unit": "PT",
            },
        }
    }


# Slide dimensions: 10" x 7.5" in EMU
SLIDE_WIDTH_EMU = 9144000
SLIDE_HEIGHT_EMU = 6858000


def build_requests_for_slide(
    page_id: str,
    slide_data: dict,
    base_dir: Path,
    drive_service,
    idx: int,
    object_prefix: Optional[str] = None,
    use_placeholders: bool = False,
    title_placeholder_id: Optional[str] = None,
    body_placeholder_id: Optional[str] = None,
    two_column_layout: bool = False,
) -> list:
    """Build batchUpdate requests for one slide."""
    requests = []
    prefix = object_prefix or f"p{idx}_"
    y_cursor = 24  # PT
    title_line_count = _estimate_wrapped_line_count(slide_data.get("title", ""))
    title_extra_height = max(0, title_line_count - 1) * 24

    # Title
    title = slide_data.get("title", "")
    title_id = title_placeholder_id or f"{prefix}title"
    if title:
        if use_placeholders and title_placeholder_id:
            requests.append({
                "insertText": {
                    "objectId": title_placeholder_id,
                    "insertionIndex": 0,
                    "text": title,
                },
            })
        else:
            requests.append({
                "createShape": {
                    "objectId": title_id,
                    "shapeType": "TEXT_BOX",
                    "elementProperties": {
                        "pageObjectId": page_id,
                        "size": {
                            "height": {"magnitude": 50 + title_extra_height, "unit": "PT"},
                            "width": {"magnitude": 648, "unit": "PT"},
                        },
                        "transform": {
                            "scaleX": 1,
                            "scaleY": 1,
                            "translateX": 36,
                            "translateY": y_cursor,
                            "unit": "PT",
                        },
                    },
                },
            })
            requests.append({
                "insertText": {
                    "objectId": title_id,
                    "insertionIndex": 0,
                    "text": title,
                },
            })
            requests.append({
                "updateTextStyle": {
                    "objectId": title_id,
                    "textRange": {"type": "ALL"},
                    "style": {
                        "fontSize": {"magnitude": 24, "unit": "PT"},
                        "bold": True,
                    },
                    "fields": "fontSize,bold",
                },
            })
        y_cursor += 66 + title_extra_height

    # Body content
    content = slide_data.get("content") or slide_data.get("body") or ""
    body_id = body_placeholder_id or f"{prefix}body"
    if content:
        cleaned_text, bullet_ranges = parse_content_for_bullets(content.strip())
        if use_placeholders and body_placeholder_id:
            if title_extra_height:
                requests.append(
                    _relative_translate_y_request(body_placeholder_id, title_extra_height)
                )
            requests.append({
                "insertText": {
                    "objectId": body_placeholder_id,
                    "insertionIndex": 0,
                    "text": cleaned_text,
                },
            })
            requests.append({
                "updateTextStyle": {
                    "objectId": body_placeholder_id,
                    "textRange": {"type": "ALL"},
                    "style": {
                        "fontSize": {"magnitude": BODY_FONT_SIZE_PT, "unit": "PT"},
                    },
                    "fields": "fontSize",
                },
            })
            for start, end in bullet_ranges:
                text_range = (
                    {"type": "ALL"}
                    if start == 0 and end == len(cleaned_text)
                    else {
                        "type": "FIXED_RANGE",
                        "startIndex": start,
                        "endIndex": end,
                    }
                )
                requests.append({
                    "createParagraphBullets": {
                        "objectId": body_placeholder_id,
                        "textRange": text_range,
                        "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
                    },
                })
            requests.append(_body_paragraph_style_request(body_placeholder_id))
        else:
            requests.append({
                "createShape": {
                    "objectId": body_id,
                    "shapeType": "TEXT_BOX",
                    "elementProperties": {
                        "pageObjectId": page_id,
                        "size": {
                            "height": {"magnitude": 280, "unit": "PT"},
                            "width": {"magnitude": 648, "unit": "PT"},
                        },
                        "transform": {
                            "scaleX": 1,
                            "scaleY": 1,
                            "translateX": 36,
                            "translateY": y_cursor,
                            "unit": "PT",
                        },
                    },
                },
            })
            requests.append({
                "insertText": {
                    "objectId": body_id,
                    "insertionIndex": 0,
                    "text": cleaned_text,
                },
            })
            requests.append({
                "updateTextStyle": {
                    "objectId": body_id,
                    "textRange": {"type": "ALL"},
                    "style": {
                        "fontSize": {"magnitude": BODY_FONT_SIZE_PT, "unit": "PT"},
                    },
                    "fields": "fontSize",
                },
            })
            for start, end in bullet_ranges:
                text_range = (
                    {"type": "ALL"}
                    if start == 0 and end == len(cleaned_text)
                    else {
                        "type": "FIXED_RANGE",
                        "startIndex": start,
                        "endIndex": end,
                    }
                )
                requests.append({
                    "createParagraphBullets": {
                        "objectId": body_id,
                        "textRange": text_range,
                        "bulletPreset": "BULLET_DISC_CIRCLE_SQUARE",
                    },
                })
            requests.append(_body_paragraph_style_request(body_id))
        y_cursor += 296

    # Table
    table_data = slide_data.get("table")
    if table_data:
        rows = table_data.get("rows", table_data if isinstance(table_data, list) else [])
        if rows:
            num_rows = len(rows)
            num_cols = max(len(r) if isinstance(r, (list, tuple)) else 1 for r in rows)
            num_cols = max(1, num_cols)
            table_id = f"{prefix}table"
            table_height = min(40 * num_rows, 220)
            requests.append({
                "createTable": {
                    "objectId": table_id,
                    "elementProperties": {
                        "pageObjectId": page_id,
                        "size": {
                            "height": {"magnitude": table_height, "unit": "PT"},
                            "width": {"magnitude": min(120 * num_cols, 648), "unit": "PT"},
                        },
                        "transform": {
                            "scaleX": 1,
                            "scaleY": 1,
                            "translateX": 36,
                            "translateY": y_cursor,
                            "unit": "PT",
                        },
                    },
                    "rows": num_rows,
                    "columns": num_cols,
                },
            })
            y_cursor += table_height + 12
            for r_idx, row in enumerate(rows):
                cells = list(row) if isinstance(row, (list, tuple)) else [str(row)]
                for c_idx, cell_text in enumerate(cells):
                    if c_idx < num_cols:
                        requests.append({
                            "insertText": {
                                "objectId": table_id,
                                "insertionIndex": 0,
                                "text": str(cell_text),
                                "cellLocation": {
                                    "rowIndex": r_idx,
                                    "columnIndex": c_idx,
                                },
                            },
                        })

    # Image (Method A: TITLE_AND_TWO_COLUMNS = content left, image right)
    image_spec = slide_data.get("image") or slide_data.get("img")
    image_fullscreen = slide_data.get("fullscreen") or slide_data.get("image_fullscreen")
    if image_spec:
        try:
            url = resolve_image_url(drive_service, image_spec, base_dir)
        except FileNotFoundError as e:
            print(f"Warning: {e}", file=sys.stderr)
            url = None
        if url:
            img_id = f"{prefix}img"
            if image_fullscreen:
                # Full slide: 10" x 7.5", small margin
                emu_w = int(9.6 * EMU_PER_INCH)
                emu_h = int(7.1 * EMU_PER_INCH)
                emu_x = int(0.2 * EMU_PER_INCH)
                emu_y = int(0.2 * EMU_PER_INCH)
            else:
                emu_size = 2800000  # ~3" square
                emu_w = emu_h = emu_size
                if two_column_layout:
                    emu_x = int(5.2 * EMU_PER_INCH)
                    emu_y = int(1.5 * EMU_PER_INCH)
                else:
                    y_inches = (y_cursor / 72) + 0.2
                    emu_x = int(0.2 * EMU_PER_INCH)
                    emu_y = int(y_inches * EMU_PER_INCH)
            requests.append({
                "createImage": {
                    "objectId": img_id,
                    "url": url,
                    "elementProperties": {
                        "pageObjectId": page_id,
                        "size": {
                            "height": {"magnitude": emu_h, "unit": "EMU"},
                            "width": {"magnitude": emu_w, "unit": "EMU"},
                        },
                        "transform": {
                            "scaleX": 1,
                            "scaleY": 1,
                            "translateX": emu_x,
                            "translateY": emu_y,
                            "unit": "EMU",
                        },
                    },
                },
            })

    return requests


# Canonical layout names (aligned with Google Slides API)
LAYOUT_TITLE_ONLY = "TITLE_ONLY"
LAYOUT_TITLE = "TITLE"  # title + subtitle
LAYOUT_TITLE_AND_BODY = "TITLE_AND_BODY"
LAYOUT_TITLE_AND_TWO_COLUMNS = "TITLE_AND_TWO_COLUMNS"
LAYOUT_BLANK = "BLANK"
CANONICAL_LAYOUTS = [
    LAYOUT_BLANK,
    LAYOUT_TITLE_ONLY,
    LAYOUT_TITLE,
    LAYOUT_TITLE_AND_BODY,
    LAYOUT_TITLE_AND_TWO_COLUMNS,
]


def _content_type(slide_data: dict) -> str:
    """Determine content type for auto-layout selection."""
    has_title = bool(slide_data.get("title"))
    has_subtitle = bool(slide_data.get("subtitle"))
    has_content = bool(slide_data.get("content") or slide_data.get("body"))
    has_table = bool(slide_data.get("table"))
    has_image = bool(slide_data.get("image") or slide_data.get("img"))
    is_fullscreen_image = bool(
        (slide_data.get("fullscreen") or slide_data.get("image_fullscreen"))
        and has_image
        and not (has_title or has_subtitle or has_content or has_table)
    )

    if is_fullscreen_image:
        return LAYOUT_BLANK

    if has_content and has_image:
        return LAYOUT_TITLE_AND_TWO_COLUMNS
    if has_title and has_subtitle and not (has_content or has_table or has_image):
        return LAYOUT_TITLE
    if has_title and not (has_content or has_table or has_image):
        return LAYOUT_TITLE_ONLY
    return LAYOUT_TITLE_AND_BODY


def _pick_layout(
    slide_data: dict, layout_map: Optional[dict], template_id: Optional[str]
) -> Tuple[dict, bool, bool]:
    """Return (layout_ref, use_placeholders, two_column_layout).
    layout_ref: {"predefinedLayout": "X"} or {"layoutId": "xxx"}.
    """
    explicit = slide_data.get("layout")
    content_type = _content_type(slide_data)
    two_column = content_type == LAYOUT_TITLE_AND_TWO_COLUMNS

    if explicit:
        key = str(explicit).strip().upper().replace(" ", "_").replace("-", "_")
        if key == LAYOUT_TITLE_ONLY and layout_map:
            if key in layout_map:
                rid = layout_map[key]
                if rid and len(str(rid)) > 10:
                    return {"layoutId": rid}, True, False
            if "title_only" in layout_map:
                rid = layout_map["title_only"]
                if rid and len(str(rid)) > 10:
                    return {"layoutId": rid}, True, False
        if key in CANONICAL_LAYOUTS:
            return {"predefinedLayout": key}, key != "BLANK", two_column
        # layout_map: displayName or normalized (title_and_two_columns) -> layoutId
        if layout_map:
            norm = key.lower()
            if norm in layout_map:
                rid = layout_map[norm]
                if rid and len(str(rid)) > 10:
                    return {"layoutId": rid}, True, two_column

    if layout_map:
        ct_norm = content_type.lower().replace(" ", "_")
        for k, v in layout_map.items():
            if not isinstance(k, str) or not v or len(str(v)) <= 10:
                continue
            if ct_norm in k.lower() or content_type.lower() in k.replace(" ", "_").lower():
                return {"layoutId": v}, True, two_column

    return {"predefinedLayout": content_type}, content_type != "BLANK", two_column


def get_layouts(slides_service, presentation_id: str) -> dict:
    """Return dict of displayName -> layoutId. Also indexes by normalized name (lowercase, underscores)."""
    pres = slides_service.presentations().get(
        presentationId=presentation_id,
        fields="layouts(objectId,layoutProperties)",
    ).execute()
    result = {}
    for layout in pres.get("layouts", []):
        obj_id = layout.get("objectId", "")
        props = layout.get("layoutProperties", {})
        name = props.get("displayName") or props.get("name") or obj_id
        result[name] = obj_id
        normalized = name.lower().replace(" ", "_").replace("-", "_")
        if normalized not in result:
            result[normalized] = obj_id
    return result


def get_layout_placeholder_map(slides_service, presentation_id: str) -> dict:
    """Return layoutId -> placeholders available on that layout."""
    pres = slides_service.presentations().get(
        presentationId=presentation_id,
        fields="layouts(objectId,pageElements(shape(placeholder)))",
    ).execute()
    result = {}
    for layout in pres.get("layouts", []):
        placeholders = []
        for el in layout.get("pageElements", []):
            shape = el.get("shape")
            if not shape:
                continue
            placeholder = shape.get("placeholder")
            if placeholder:
                placeholders.append({
                    "type": placeholder.get("type"),
                    "index": placeholder.get("index", 0),
                })
        result[layout.get("objectId")] = placeholders
    return result


def _extract_presentation_id(value: str) -> str:
    """Extract presentation ID from URL or return as-is if already an ID."""
    s = value.strip()
    if "/d/" in s:
        # URL like https://docs.google.com/presentation/d/ABC123/edit
        parts = s.split("/d/")
        if len(parts) >= 2:
            return parts[1].split("/")[0].split("?")[0]
    return s


def _placeholder_mappings_for_slide(
    slide_data: dict,
    content_type: str,
    title_placeholder_id: str,
    body_placeholder_id: str,
) -> List[dict]:
    """Create only the placeholder mappings a layout actually needs."""
    mappings: List[dict] = []
    has_title = bool(slide_data.get("title"))
    has_body = bool(slide_data.get("content") or slide_data.get("body"))

    if has_title and content_type in {
        LAYOUT_TITLE_ONLY,
        LAYOUT_TITLE,
        LAYOUT_TITLE_AND_BODY,
        LAYOUT_TITLE_AND_TWO_COLUMNS,
    }:
        mappings.append({
            "objectId": title_placeholder_id,
            "layoutPlaceholder": {"type": "TITLE", "index": 0},
        })

    if has_body and content_type in {LAYOUT_TITLE_AND_BODY, LAYOUT_TITLE_AND_TWO_COLUMNS}:
        mappings.append({
            "objectId": body_placeholder_id,
            "layoutPlaceholder": {"type": "BODY", "index": 0},
        })

    return mappings


def _placeholder_mappings_from_layout(
    slide_data: dict,
    layout_id: str,
    layout_placeholder_map: dict,
    title_placeholder_id: str,
    body_placeholder_id: str,
) -> List[dict]:
    """Create placeholder mappings from actual template layout metadata."""
    mappings: List[dict] = []
    placeholders = layout_placeholder_map.get(layout_id, [])
    has_title = bool(slide_data.get("title"))
    has_body = bool(slide_data.get("content") or slide_data.get("body"))

    if has_title:
        for placeholder in placeholders:
            if placeholder["type"] in {"TITLE", "CENTERED_TITLE"}:
                mappings.append({
                    "objectId": title_placeholder_id,
                    "layoutPlaceholder": {
                        "type": placeholder["type"],
                        "index": placeholder.get("index", 0),
                    },
                })
                break

    if has_body:
        for placeholder in placeholders:
            if placeholder["type"] in {"BODY", "SUBTITLE"}:
                mappings.append({
                    "objectId": body_placeholder_id,
                    "layoutPlaceholder": {
                        "type": placeholder["type"],
                        "index": placeholder.get("index", 0),
                    },
                })
                break

    return mappings


def create_or_update_presentation(
    slides_service,
    drive_service,
    data: dict,
    base_dir: Path,
    presentation_id: Optional[str],
    title_override: Optional[str],
    template_id: Optional[str] = None,
) -> str:
    """Create a new presentation or append slides to an existing one.
    If template_id is set, copy the template (preserves theme) then add content.
    """
    title = title_override or data.get("title", "Untitled Presentation")
    slides_list = data.get("slides", [])

    if presentation_id:
        presentation = (
            slides_service.presentations()
            .get(presentationId=presentation_id)
            .execute()
        )
        insertion_index = len(presentation.get("slides", []))
    elif template_id:
        # Copy template via Drive API - preserves theme, masters, layouts
        tid = _extract_presentation_id(template_id)
        copy_result = (
            drive_service.files()
            .copy(fileId=tid, body={"name": title})
            .execute()
        )
        presentation_id = copy_result["id"]
        presentation = (
            slides_service.presentations()
            .get(presentationId=presentation_id)
            .execute()
        )
        # Delete template slides so we add our own content (theme preserved)
        existing = presentation.get("slides", [])
        delete_requests = [
            {"deleteObject": {"objectId": s["objectId"]}} for s in existing
        ]
        if delete_requests:
            slides_service.presentations().batchUpdate(
                presentationId=presentation_id, body={"requests": delete_requests}
            ).execute()
        insertion_index = 0
    else:
        presentation = (
            slides_service.presentations()
            .create(body={"title": title})
            .execute()
        )
        presentation_id = presentation["presentationId"]
        insertion_index = 0
        existing = presentation.get("slides", [])
        if existing:
            insertion_index = len(existing)

    layout_map = None
    layout_placeholder_map = {}

    appending = presentation_id and insertion_index > 0
    # Fetch layout map when creating from template OR when appending (use target deck's layouts)
    if presentation_id:
        layout_map = get_layouts(slides_service, presentation_id)
        layout_placeholder_map = get_layout_placeholder_map(
            slides_service, presentation_id
        )

    all_requests = []
    use_unique_ids = appending
    append_run_prefix = f"ins_{uuid.uuid4().hex[:8]}" if use_unique_ids else None
    for i, slide_data in enumerate(slides_list):
        idx = insertion_index + i
        page_id = (
            f"{append_run_prefix}_page_{idx}" if use_unique_ids else f"page_{idx}"
        )
        prefix = (
            f"{append_run_prefix}_{idx}_"
            if use_unique_ids
            else f"p{idx}_"
        )
        title_ph = f"{prefix}title_ph"
        body_ph = f"{prefix}body_ph"

        layout_ref, use_placeholders, two_column_layout = _pick_layout(
            slide_data, layout_map, template_id
        )
        content_type = _content_type(slide_data)

        create_slide_req = {
            "objectId": page_id,
            "insertionIndex": insertion_index + i,
            "slideLayoutReference": layout_ref,
        }
        if use_placeholders:
            if "layoutId" in layout_ref:
                mappings = _placeholder_mappings_from_layout(
                    slide_data,
                    layout_ref["layoutId"],
                    layout_placeholder_map,
                    title_ph,
                    body_ph,
                )
            else:
                mappings = _placeholder_mappings_for_slide(
                    slide_data,
                    content_type,
                    title_ph,
                    body_ph,
                )
            if mappings:
                create_slide_req["placeholderIdMappings"] = mappings
        all_requests.append({"createSlide": create_slide_req})

        slide_reqs = build_requests_for_slide(
            page_id,
            slide_data,
            base_dir,
            drive_service,
            insertion_index + i,
            object_prefix=prefix,
            use_placeholders=use_placeholders,
            title_placeholder_id=title_ph if use_placeholders else None,
            body_placeholder_id=body_ph if use_placeholders else None,
            two_column_layout=two_column_layout,
        )
        all_requests.extend(slide_reqs)

    if all_requests:
        slides_service.presentations().batchUpdate(
            presentationId=presentation_id,
            body={"requests": all_requests},
        ).execute()

    return presentation_id


def main():
    parser = argparse.ArgumentParser(
        description="Convert YAML slide definition to Google Slides",
        epilog="Credentials: --credentials, SLIDES_CREDENTIALS_PATH, ~/.config/slides-to-google/, or .secrets/",
    )
    parser.add_argument(
        "yaml_file",
        type=str,
        help="Path to YAML file defining slides",
    )
    parser.add_argument(
        "-o", "--title",
        type=str,
        help="Presentation title (overrides YAML title)",
    )
    parser.add_argument(
        "--update",
        type=str,
        metavar="PRESENTATION_ID",
        help="Append slides to existing presentation",
    )
    parser.add_argument(
        "--credentials",
        type=str,
        default=None,
        help="Path to credentials.json (overrides env and defaults)",
    )
    parser.add_argument(
        "--template",
        type=str,
        metavar="TEMPLATE_ID_OR_URL",
        help="Use a Google Slides template (ID or URL). Copies template to preserve theme, then fills with your content.",
    )
    args = parser.parse_args()

    try:
        import yaml
    except ImportError:
        print("Install PyYAML: .venv/bin/pip install PyYAML", file=sys.stderr)
        sys.exit(1)

    yaml_path = Path(args.yaml_file).resolve()
    if not yaml_path.exists():
        print(f"File not found: {yaml_path}", file=sys.stderr)
        sys.exit(1)

    base_dir = yaml_path.parent
    with open(yaml_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not data:
        data = {}

    project_root = Path(__file__).resolve().parent.parent

    # Template: CLI > YAML > project default (slides/.template)
    template_id = args.template or data.get("template")
    if not template_id:
        default_file = project_root / "slides" / ".template"
        if default_file.exists():
            template_id = default_file.read_text(encoding="utf-8").strip()
    creds_path, token_path = _resolve_credentials_paths(args.credentials, project_root)

    creds = get_credentials(creds_path, token_path)
    from googleapiclient.discovery import build
    slides_service = build("slides", "v1", credentials=creds)
    drive_service = build("drive", "v3", credentials=creds)

    try:
        presentation_id = create_or_update_presentation(
            slides_service,
            drive_service,
            data,
            base_dir,
            args.update,
            args.title,
            template_id,
        )
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        raise

    url = f"https://docs.google.com/presentation/d/{presentation_id}/edit"
    print(url)


if __name__ == "__main__":
    main()
