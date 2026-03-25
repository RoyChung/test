#!/usr/bin/env python3
"""
Call the local FastAPI AI Builder proxy (OpenAI-compatible chat completions)
with Grok 4 fast and print a short joke.

Requires the proxy running, e.g.:
  .venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8002

The client does not need AI_BUILDER_TOKEN; the server injects it upstream.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import httpx


def _eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


def fetch_joke(
    *,
    chat_url: str,
    model: str,
    prompt: str,
    max_tokens: int,
    timeout: float,
) -> tuple[str, dict[str, Any]]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
    }
    headers = {"Content-Type": "application/json"}

    with httpx.Client(timeout=timeout) as client:
        r = client.post(chat_url, json=payload, headers=headers)
        r.raise_for_status()
        data = r.json()

    err = data.get("error")
    if err:
        raise RuntimeError(f"API error: {err}")

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"Unexpected response (no choices): {json.dumps(data)[:500]}")

    msg = (choices[0].get("message") or {}) if isinstance(choices[0], dict) else {}
    content = msg.get("content")
    if content is None:
        raise RuntimeError(f"Unexpected response (no content): {json.dumps(data)[:500]}")

    return str(content).strip(), data


def main() -> int:
    default_url = os.getenv(
        "CHAT_COMPLETIONS_URL",
        "http://127.0.0.1:8002/v1/chat/completions",
    )
    parser = argparse.ArgumentParser(
        description="POST to local /v1/chat/completions with Grok (via AI Builder proxy).",
    )
    parser.add_argument(
        "--url",
        default=default_url,
        help=f"Full chat completions URL (default: env CHAT_COMPLETIONS_URL or {default_url!r})",
    )
    parser.add_argument(
        "--model",
        default=os.getenv("GROK_MODEL", "grok-4-fast"),
        help="Model id to send upstream (default: grok-4-fast or env GROK_MODEL)",
    )
    parser.add_argument(
        "--prompt",
        default="請用粵語講一個短笑話，約三句內。",
        help="User message content",
    )
    parser.add_argument("--max-tokens", type=int, default=300)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print upstream model name and raw JSON keys to stderr",
    )
    args = parser.parse_args()

    _eprint("request:", args.url, "model:", args.model)

    try:
        text, data = fetch_joke(
            chat_url=args.url,
            model=args.model,
            prompt=args.prompt,
            max_tokens=args.max_tokens,
            timeout=args.timeout,
        )
    except httpx.HTTPStatusError as e:
        _eprint("HTTP", e.response.status_code, e.response.text[:2000])
        return 1
    except Exception as e:
        _eprint("error:", e)
        return 1

    if args.verbose:
        _eprint("upstream model field:", data.get("model"))
        _eprint("response keys:", list(data.keys()))

    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
