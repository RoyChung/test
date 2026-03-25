#!/usr/bin/env python3
"""
Extract page content to Obsidian-formatted markdown with assets and downloads.
Images are placed inline at their position in blocks so they display in the correct
place when viewing the md file in Obsidian. Images with URL are downloaded to src/;
local paths (e.g. screenshots) are copied to src/.

Reads JSON input from file or stdin:
  {
    "title": str,
    "url": str,
    "blocks": [
      {"type": "heading"|"paragraph"|"image"|"code", "level"?: int, "text"?: str, "src"?: str, "alt"?: str, "language"?: str},
      ...
    ],
    "links": [{"text": str, "href": str}, ...],   // for file downloads; inline links go in paragraph.text
    "images": [{"src": str}, ...],                // fallback if blocks omit images
    "include_links_section": bool                  // optional, default false – output "链接 / Links" section
  }

  paragraph.text may contain markdown including inline links [text](url).
  Legacy: "paragraphs", "headings" supported for backward compatibility.

Creates:
  output_dir/Extract_<slug>/
    index.md
    src/   (images + downloadable files: .pdf, .zip, etc.)
"""

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Add project root for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# File extensions to treat as downloadable
FILE_EXTENSIONS = {".pdf", ".doc", ".docx", ".xlsx", ".xls", ".pptx", ".ppt", ".zip"}

# Image extensions
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}


def slugify(s: str) -> str:
    """Create a filesystem-safe slug from a title."""
    s = re.sub(r"[^\w\s\-]", "", s)
    s = re.sub(r"\s+", "_", s.strip())
    return s[:64] if s else "extract"


def resolve_url(base_url: str, href: str) -> str:
    """Resolve relative URL against base."""
    if not href or href.startswith(("#", "javascript:", "mailto:")):
        return ""
    return urljoin(base_url, href)


def sanitize_filename(url: str, prefix: str = "file", ext: str = "") -> str:
    """Create a safe filename from URL or prefix."""
    if ext:
        stem = prefix
    else:
        parsed = urlparse(url)
        path = parsed.path or ""
        stem = os.path.basename(path) or prefix
        ext = os.path.splitext(stem)[1]
        stem = os.path.splitext(stem)[0] if stem else prefix
    # Sanitize
    stem = re.sub(r"[^\w\-.]", "_", stem)[:80]
    return f"{stem}{ext}" if stem else f"{prefix}{ext}"


def download_asset(url: str, output_dir: Path, prefix: str, ext_hint: str = "") -> Optional[str]:
    """
    Download URL to output_dir. Returns local filename on success, None on failure.
    If the preferred filename already exists, skips download and returns it (idempotent re-runs).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    ext = ext_hint or Path(urlparse(url).path).suffix or ".bin"
    base = sanitize_filename(url, prefix, ext)
    path = output_dir / base
    if path.exists():
        return path.name  # Skip re-download when file exists
    n = 0
    while path.exists():
        n += 1
        stem = Path(base).stem
        path = output_dir / f"{stem}_{n}{ext}"
    try:
        req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; ExtractToObsidian/1.0)"})
        with urlopen(req, timeout=30) as r:
            data = r.read()
        path.write_bytes(data)
        return path.name
    except (HTTPError, URLError, OSError) as e:
        print(f"Download failed: {url} -> {e}", file=sys.stderr)
        return None


def is_file_link(href: str) -> bool:
    """Check if href points to a downloadable file."""
    try:
        path = urlparse(href).path
        ext = os.path.splitext(path)[1].lower()
        return ext in FILE_EXTENSIONS
    except Exception:
        return False


def is_image_url(src: str) -> bool:
    """Check if src looks like an image."""
    try:
        path = urlparse(src).path
        ext = os.path.splitext(path)[1].lower()
        return ext in IMAGE_EXTENSIONS or "/" in path
    except Exception:
        return True  # assume image if unclear


def build_extract(data: dict, output_base: Path) -> Path:
    """
    Build the Obsidian extract folder and index.md.
    Returns the path to the extract folder.
    """
    title = data.get("title") or "Untitled"
    url = data.get("url") or ""
    blocks = data.get("blocks") or []
    links = data.get("links") or []
    images_raw = data.get("images") or []
    paragraphs = data.get("paragraphs") or []
    headings = data.get("headings") or []

    # Build blocks from legacy format if needed
    if not blocks:
        for h in headings:
            blocks.append({"type": "heading", "level": h.get("level") or 2, "text": h.get("name") or ""})
        for p in paragraphs:
            blocks.append({"type": "paragraph", "text": p.get("text") or "", "heading_level": p.get("heading_level")})

    # Collect images from blocks + images
    images = []
    seen_src = set()
    for b in blocks:
        if b.get("type") == "image" and b.get("src") and b["src"] not in seen_src:
            seen_src.add(b["src"])
            images.append({"src": b["src"]})
    for img in images_raw:
        src = img.get("src") or ""
        if src and src not in seen_src:
            seen_src.add(src)
            images.append({"src": src})

    slug = slugify(title)
    source = data.get("source") or ("Medium" if "medium.com" in url else "Superlinear Academy")
    prefix = "Medium_Extract_" if "medium.com" in url else "Superlinear_Extract_"
    extract_dir = output_base / f"{prefix}{slug}"
    src_dir = extract_dir / "src"

    # Download or copy images
    image_map = {}  # type: dict[str, str]  src -> local filename
    for i, img in enumerate(images):
        src = img.get("src") or ""
        if not src:
            continue
        # Local file path (e.g. screenshot fallback): copy to src
        if src.startswith(("file:", "/")) or os.path.exists(src):
            src_path = Path(src.replace("file://", "").replace("file:", ""))
            if src_path.exists():
                src_dir.mkdir(parents=True, exist_ok=True)
                ext = src_path.suffix or ".png"
                base = f"image_{i + 1}{ext}"
                dest = src_dir / base
                n = 0
                while dest.exists():
                    n += 1
                    dest = src_dir / f"image_{i + 1}_{n}{ext}"
                local = dest.name
                shutil.copy2(src_path, dest)
                image_map[src] = local
                image_map[str(src_path)] = local
            continue
        # URL: download
        abs_url = resolve_url(url, src)
        if not abs_url or not is_image_url(abs_url):
            continue
        local = download_asset(abs_url, src_dir, f"image_{i + 1}", ".png")
        if local:
            image_map[src] = local
            image_map[abs_url] = local

    # Download file links (use URL basename when it has a valid extension, else "download")
    file_link_map = {}  # type: dict[str, str]  href -> local filename
    link_text_to_local = {}  # type: dict[str, str]  link text -> local filename (for inline replacement)
    for link in links:
        href = link.get("href") or ""
        if not href or href in file_link_map:
            continue
        abs_href = resolve_url(url, href)
        if not abs_href or not is_file_link(abs_href):
            continue
        path = urlparse(abs_href).path
        basename = os.path.basename(path)
        ext = Path(path).suffix or ".bin"
        # Prefer URL basename (e.g. lesson4_data.zip) over generic "download.zip"
        if basename and os.path.splitext(basename)[1].lower() in FILE_EXTENSIONS:
            prefix = Path(basename).stem
            local = download_asset(abs_href, src_dir, prefix, ext)
        else:
            local = download_asset(abs_href, src_dir, "download", ext)
        if local:
            file_link_map[href] = local
            file_link_map[abs_href] = local
            link_text = (link.get("text") or basename or "file").strip()
            if link_text:
                link_text_to_local[link_text] = local

    # Build markdown content
    lines = []  # type: list[str]
    lines.append("---")
    lines.append(f"title: {title}")
    lines.append(f"source: {source}")
    lines.append(f"url: {url}")
    lines.append(f"extracted_at: {datetime.now().isoformat()}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"来源：[{source}]({url})")
    lines.append("")
    lines.append("---")
    lines.append("")

    inline_images = set()

    # Content from blocks (preserve order)
    for b in blocks:
        btype = b.get("type") or "paragraph"
        if btype == "heading":
            level = b.get("level") or 2
            text = b.get("text") or ""
            if text:
                lines.append("#" * level + f" {text}")
                lines.append("")
        elif btype == "paragraph":
            text = b.get("text") or ""
            heading_level = b.get("heading_level")
            # Replace bare mentions of downloaded file names with local links [text](src/file)
            # Process longer link texts first to avoid partial matches
            for link_text, local in sorted(link_text_to_local.items(), key=lambda x: -len(x[0])):
                # Only replace when not already inside a markdown link [...](...)
                text = re.sub(
                    r"(?<!\[])" + re.escape(link_text) + r"(?!\])",
                    f"[{link_text}](src/{local})",
                    text,
                )
            if heading_level is not None and heading_level > 0 and text:
                lines.append("#" * heading_level + f" {text}")
                lines.append("")
            elif text.strip():
                lines.append(text)
                lines.append("")
        elif btype == "image":
            src = b.get("src") or ""
            alt = b.get("alt") or ""
            abs_src = resolve_url(url, src)
            local = image_map.get(src) or image_map.get(abs_src)
            if local:
                inline_images.add(local)
                if alt:
                    lines.append(f"![{alt}](src/{local})")
                else:
                    lines.append(f"![[src/{local}]]")
                lines.append("")
        elif btype == "code":
            lang = b.get("language") or ""
            text = b.get("text") or ""
            lines.append(f"```{lang}".rstrip())
            lines.append(text)
            lines.append("```")
            lines.append("")

    # Add images section for those not placed inline (unique locals only)
    unplaced = [local for local in dict.fromkeys(image_map.values()) if local not in inline_images]
    if unplaced:
        lines.append("")
        lines.append("## 图片 / Images")
        lines.append("")
        for local in unplaced:
            # Check if any block had alt for this image
            alt = ""
            for b in blocks:
                if b.get("type") == "image":
                    s = b.get("src") or ""
                    if image_map.get(s) == local or image_map.get(resolve_url(url, s)) == local:
                        alt = b.get("alt") or ""
                        break
            if alt:
                lines.append(f"![{alt}](src/{local})")
            else:
                lines.append(f"![[src/{local}]]")
        lines.append("")

    # Links section (opt-in; default: no separate list – links should be inline in paragraphs)
    include_links_section = data.get("include_links_section", False)
    if include_links_section and links:
        lines.append("")
        lines.append("## 链接 / Links")
        lines.append("")
        seen = set()
        for link in links:
            text = link.get("text") or "Link"
            href = link.get("href") or ""
            abs_href = resolve_url(url, href)
            if not abs_href or abs_href in seen:
                continue
            seen.add(abs_href)
            if abs_href in file_link_map:
                local = file_link_map[abs_href]
                lines.append(f"- [{text}](src/{local})")
            else:
                lines.append(f"- [{text}]({abs_href})")
        lines.append("")

    # Write index.md
    extract_dir.mkdir(parents=True, exist_ok=True)
    index_path = extract_dir / "index.md"
    index_path.write_text("\n".join(lines), encoding="utf-8")
    return extract_dir


def parse_snapshot_to_payload(snapshot_yaml: str, page_url: str, page_title: str) -> dict:
    """
    Parse a browser snapshot YAML (simplified) into the JSON payload format.
    This is a fallback if the caller doesn't provide structured JSON.
    For full fidelity, the agent should build the payload from browser_get_attribute calls.
    """
    # Minimal: return structure that can be augmented by caller
    return {
        "title": page_title,
        "url": page_url,
        "paragraphs": [],
        "links": [],
        "images": [],
        "headings": [],
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract page content to Obsidian-formatted markdown"
    )
    parser.add_argument(
        "--input", "-i",
        help="Path to JSON input file (default: stdin)",
    )
    parser.add_argument(
        "--output-dir", "-o",
        default="Stage",
        help="Output base directory (default: Stage)",
    )
    parser.add_argument(
        "--include-links-section",
        action="store_true",
        help="Output a separate Links section (default: links inline in paragraphs)",
    )
    args = parser.parse_args()

    if args.input:
        with open(args.input, "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    if args.include_links_section:
        data = dict(data, include_links_section=True)

    output_base = Path(args.output_dir)
    output_base.mkdir(parents=True, exist_ok=True)
    extract_dir = build_extract(data, output_base)
    print(str(extract_dir))


if __name__ == "__main__":
    main()
