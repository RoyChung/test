#!/usr/bin/env python3
"""Download a PDF from a URL using Playwright (bypasses Cloudflare etc.)."""

import argparse
import asyncio
import os
import sys

# Add project root for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


async def download_pdf(url: str, output_path: str) -> bool:
    """Download PDF from URL using Playwright (bypasses Cloudflare)."""
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        # Navigate to page first (handles Cloudflare)
        await page.goto(url, wait_until="networkidle")
        await asyncio.sleep(2)  # Allow any JS/Cloudflare to complete

        # Find and click download link (FATF uses "Download the report" or similar)
        download_link = (
            await page.query_selector('a[href*="Understanding-Mitigating-Risks-Offshore-VASPs.pdf"]')
            or await page.query_selector('a[href*=".pdf"]')
        )
        if not download_link:
            download_link = await page.query_selector('a[href*="Understanding-Mitigating"]')

        if not download_link:
            print("Could not find download link on page", file=sys.stderr)
            await browser.close()
            return False

        async with page.expect_download(timeout=60000) as download_info:
            await download_link.click()

        download = await download_info.value
        await download.save_as(output_path)
        await browser.close()
        return True


def main():
    parser = argparse.ArgumentParser(description="Download PDF using browser automation")
    parser.add_argument("url", help="URL of the PDF or page with download link")
    parser.add_argument("-o", "--output", help="Output file path")
    args = parser.parse_args()

    output = args.output or "downloaded.pdf"
    success = asyncio.run(download_pdf(args.url, output))
    if success:
        print(f"Downloaded to {output}")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
