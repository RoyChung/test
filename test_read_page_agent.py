#!/usr/bin/env python3
"""POST /chat with agent tools (web_search + read_page) — requires local uvicorn."""

from __future__ import annotations

import json
import os
import sys

import httpx


def main() -> int:
    url = os.getenv("CHAT_URL", "http://127.0.0.1:8002/chat")
    prompt = (
        "Search for the latest release of Python, then read the official changelog page "
        "to tell me the new features."
    )
    payload = {
        "model": "gpt-5",
        "messages": [{"role": "user", "content": prompt}],
    }
    print("POST", url, file=sys.stderr)
    try:
        r = httpx.post(url, json=payload, timeout=300.0)
    except httpx.RequestError as e:
        print("request failed:", e, file=sys.stderr)
        return 1
    print("HTTP", r.status_code, file=sys.stderr)
    if r.status_code != 200:
        print(r.text[:4000], file=sys.stderr)
        return 1
    data = r.json()
    msg = (data.get("choices") or [{}])[0].get("message") or {}
    content = msg.get("content")
    print(json.dumps({"assistant": content}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
