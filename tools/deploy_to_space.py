#!/usr/bin/env python3
"""
Queue a deployment on AI Builder Space (Koyeb) via POST /v1/deployments.

Requires:
  - AI_BUILDER_TOKEN in the environment (same key as for chat / Space API).
  - deploy-config.json in the project root (copy from deploy-config.example.json).

Usage:
  .venv/bin/python3 tools/deploy_to_space.py
  .venv/bin/python3 tools/deploy_to_space.py /path/to/deploy-config.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

DEFAULT_BASE = os.getenv("AI_BUILDER_BASE_URL", "https://space.ai-builders.com/backend").rstrip("/")


def main() -> int:
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

    parser = argparse.ArgumentParser(description="POST /v1/deployments to AI Builder Space")
    parser.add_argument(
        "config",
        nargs="?",
        default=None,
        help="Path to deploy-config.json (default: ./deploy-config.json next to repo root)",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE,
        help=f"API base (default: env AI_BUILDER_BASE_URL or {DEFAULT_BASE})",
    )
    args = parser.parse_args()

    token = os.getenv("AI_BUILDER_TOKEN")
    if not token:
        print("Missing AI_BUILDER_TOKEN. Set it in the environment (e.g. from your .env).", file=sys.stderr)
        return 1

    if args.config:
        cfg_path = Path(args.config).resolve()
    else:
        repo_root = Path(__file__).resolve().parent.parent
        cfg_path = repo_root / "deploy-config.json"

    if not cfg_path.is_file():
        print(
            f"Config not found: {cfg_path}\n"
            "Copy deploy-config.example.json to deploy-config.json and edit service_name.",
            file=sys.stderr,
        )
        return 1

    with open(cfg_path, encoding="utf-8") as f:
        body = json.load(f)

    required = ("repo_url", "service_name", "branch")
    for k in required:
        if k not in body or not str(body[k]).strip():
            print(f"Missing or empty '{k}' in {cfg_path}", file=sys.stderr)
            return 1

    if "your-unique-name-here" in str(body.get("service_name", "")):
        print(
            "Edit deploy-config.json: set 'service_name' to a unique name "
            "(lowercase letters, digits, hyphen; 3–32 chars). Example: my-cursor-chat",
            file=sys.stderr,
        )
        return 1

    url = f"{args.base_url.rstrip('/')}/v1/deployments"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    print(f"POST {url}", file=sys.stderr)
    print(f"repo_url={body['repo_url']} branch={body['branch']} service_name={body['service_name']}", file=sys.stderr)

    with httpx.Client(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
        r = client.post(url, json=body, headers=headers)

    try:
        out = r.json()
    except Exception:
        print(r.text, file=sys.stderr)
        return 1

    print(json.dumps(out, indent=2, ensure_ascii=False))

    if r.is_success:
        pub = out.get("public_url") or out.get("message")
        if pub:
            print(f"\nTip: public URL may look like https://<service_name>.ai-builders.space", file=sys.stderr)
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
