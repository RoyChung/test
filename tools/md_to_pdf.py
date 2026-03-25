#!/usr/bin/env python3
"""
Convert Markdown (with embedded images) to PDF.

Images: use relative paths in the md file, e.g. ![alt](image.png).
Images must be in the same directory as the md file (or adjust paths).
Output PDF is written to the same directory by default, or use --output.

Dependencies: markdown, playwright
Setup (once): .venv/bin/playwright install chromium
"""
import argparse
import os
import sys
import urllib.parse
from pathlib import Path
from typing import Optional


def md_to_pdf(
    md_path: str,
    output_pdf: Optional[str] = None,
    keep_html: bool = False,
    format: str = "A4",
    margin: str = "20mm",
) -> str:
    """
    Convert a markdown file to PDF.
    Returns the path to the created PDF.
    """
    md_path = Path(md_path).resolve()
    if not md_path.exists():
        raise FileNotFoundError(f"Markdown file not found: {md_path}")

    base_dir = md_path.parent
    out_pdf = Path(output_pdf).resolve() if output_pdf else base_dir / (md_path.stem + ".pdf")
    out_html = base_dir / (md_path.stem + ".html")

    try:
        import markdown
    except ImportError:
        print("Install markdown: pip install markdown", file=sys.stderr)
        sys.exit(1)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Install playwright: pip install playwright", file=sys.stderr)
        print("Then run: playwright install chromium", file=sys.stderr)
        sys.exit(1)

    with open(md_path, "r", encoding="utf-8") as f:
        md_content = f.read()

    html_body = markdown.markdown(md_content, extensions=["tables", "fenced_code"])
    title = md_path.stem
    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 2em; color: #333; }}
h1 {{ font-size: 1.8em; border-bottom: 1px solid #ddd; padding-bottom: 0.3em; }}
h2 {{ font-size: 1.4em; margin-top: 1.5em; }}
h3 {{ font-size: 1.2em; margin-top: 1em; }}
code {{ background: #f5f5f5; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }}
pre {{ background: #f5f5f5; padding: 1em; overflow-x: auto; }}
table {{ width: 100%; margin: 1em 0; border-collapse: collapse; }}
th, td {{ border: 1px solid #ddd; padding: 8px 12px; text-align: left; }}
th {{ background: #f9f9f9; }}
img {{ max-width: 100%; height: auto; display: block; margin: 1em 0; }}
hr {{ border: none; border-top: 1px solid #ddd; margin: 2em 0; }}
@media print {{ body {{ padding: 1em; }} img {{ max-width: 95%; }} }}
</style>
</head>
<body>
{html_body}
</body>
</html>"""

    with open(out_html, "w", encoding="utf-8") as f:
        f.write(full_html)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        file_url = "file://" + urllib.parse.quote(str(out_html), safe="/")
        page.goto(file_url)
        page.pdf(
            path=str(out_pdf),
            format=format,
            margin={"top": margin, "right": margin, "bottom": margin, "left": margin},
        )
        browser.close()

    if not keep_html:
        try:
            os.remove(out_html)
        except OSError:
            pass
    else:
        print(f"HTML: {out_html}", file=sys.stderr)

    return str(out_pdf)


def main():
    parser = argparse.ArgumentParser(
        description="Convert Markdown (with images) to PDF",
        epilog="Images: use ![alt](path.png) in md. Paths are relative to the md file.",
    )
    parser.add_argument("md_file", help="Path to markdown file")
    parser.add_argument("-o", "--output", help="Output PDF path (default: same dir, same stem)")
    parser.add_argument("--keep-html", action="store_true", help="Keep intermediate HTML file")
    parser.add_argument("--format", default="A4", help="Page format (default: A4)")
    parser.add_argument("--margin", default="20mm", help="Page margin (default: 20mm)")
    args = parser.parse_args()

    try:
        pdf_path = md_to_pdf(
            args.md_file,
            output_pdf=args.output,
            keep_html=args.keep_html,
            format=args.format,
            margin=args.margin,
        )
        print(pdf_path)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
