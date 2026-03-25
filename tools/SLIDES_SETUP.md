# Google Slides Setup

To use `slides_to_google.py`, you need Google Cloud credentials.

## Folder structure

- **`slides/`** – Your YAML working files (slide content)
- **`slides/assets/`** – Required folder for all local slide images
- **Credentials** (priority order):
  1. `--credentials` flag
  2. `SLIDES_CREDENTIALS_PATH` or `GOOGLE_APPLICATION_CREDENTIALS` env var
  3. `~/.config/slides-to-google/credentials.json` (user-level, shared across projects)
  4. `.secrets/credentials.json` (project-level, gitignored)

## 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one

## 2. Enable APIs

1. Open **APIs & Services** > **Library**
2. Enable **Google Slides API**
3. Enable **Google Drive API**

## 3. Create OAuth Credentials

1. Open **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. If prompted, configure the OAuth consent screen:
   - User type: **External** (or Internal if using Workspace)
   - Add your email as a test user
4. Application type: **Desktop app**
5. Name: e.g. "Slides Generator"
6. Click **Create**
7. Download the JSON and save to one of:
   - **Project:** `mkdir -p .secrets && cp downloaded.json .secrets/credentials.json`
   - **User-level (shared):** `mkdir -p ~/.config/slides-to-google && cp downloaded.json ~/.config/slides-to-google/credentials.json`
   - **Env var:** `export SLIDES_CREDENTIALS_PATH=/path/to/credentials.json`

## 4. First Run

```bash
.venv/bin/python3 tools/slides_to_google.py slides/sample_slides.yaml
```

**Using a template:** To use your own Google Slides template (preserves theme, fonts, colors):

```bash
.venv/bin/python3 tools/slides_to_google.py slides/my_slides.yaml --template "TEMPLATE_ID"
# Or with full URL:
.venv/bin/python3 tools/slides_to_google.py slides/my_slides.yaml --template "https://docs.google.com/presentation/d/ABC123/edit"
```

The template is copied (not modified), then your YAML content is added. Share the template with yourself or make it accessible to your Google account.

**Default template:** Create `slides/.template` with a template ID (one line, no URL). All generations will use it when no `--template` flag and no `template:` in YAML. Current default: Retro Modern Style (`16YpxyTKaBNG7ZYtRIS-DOk94JWzrMQaJROPs4jHPGgU`). You can also set `template: "ID"` in any YAML file.

**Local image rule:** All local images must be stored under `slides/assets/` and use kebab-case filenames, for example `assets/ai-competence-matrix.png`. The generator now rejects local image paths outside this folder or with names like `My Image.png`.

## 5. Layouts

Supported layouts (use `layout: NAME` in YAML or auto-select):

- **TITLE_ONLY** – title only
- **TITLE** – title + subtitle
- **TITLE_AND_BODY** – title + content (text, table, or image)
- **TITLE_AND_TWO_COLUMNS** – title + left (content) + right (image). Method A: `content` = left column, `image` = right column.

Auto-selection when `layout` omitted:

- content + image → TITLE_AND_TWO_COLUMNS
- title + subtitle only → TITLE
- title + content/table/image → TITLE_AND_BODY
- title only → TITLE_ONLY

## 6. Security

- `.secrets/` is gitignored – credentials and tokens are never committed
- `token.json` lets the script access your Drive without re-authenticating; keep it private
