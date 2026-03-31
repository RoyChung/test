import asyncio
import html as html_module
import json
import logging
import os
import re
from collections.abc import AsyncIterator
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

load_dotenv()

log = logging.getLogger(__name__)

# Max chars of tool / search JSON to print per log line (avoid huge stderr).
_AGENT_LOG_PREVIEW_CHARS = 8000

# Human-readable agent trace (terminal): matches "timestamp - name - LEVEL - [第N轮] …"
_agent_log = logging.getLogger("agent")
_AGENT_LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
_AGENT_LOG_DATEFMT = "%Y-%m-%d %H:%M:%S"
_AGENT_SEP_WIDTH = 60


def _ensure_agent_logger() -> logging.Logger:
    if not _agent_log.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter(_AGENT_LOG_FORMAT, datefmt=_AGENT_LOG_DATEFMT))
        _agent_log.addHandler(h)
        _agent_log.setLevel(logging.INFO)
        _agent_log.propagate = False
    return _agent_log


def _agent_round_label(round_idx: int) -> str:
    return f"[第{round_idx}轮]"


def _agent_sep(alog: logging.Logger) -> None:
    alog.info("=" * _AGENT_SEP_WIDTH)


def _agent_msg(alog: logging.Logger, round_idx: int, text: str) -> None:
    alog.info("%s %s", _agent_round_label(round_idx), text)

APP_DESCRIPTION = """
## 說明

本服務為 **FastAPI** 範例／代理：提供示範用問候端點，以及將 **OpenAI 相容** 的聊天請求轉發至 [AI Builder Space](https://space.ai-builders.com) 後端。

## Chat 代理行為

- 轉發目標：環境變數 `AI_BUILDER_BASE_URL`（預設 `https://space.ai-builders.com/backend`）下的 **`/v1/chat/completions`**。
- 上游認證：使用伺服器端設定的 **`AI_BUILDER_TOKEN`**（Bearer），**不需**在呼叫本 API 時帶入該金鑰。
- 若請求 JSON 物件中未指定 **`model`**，預設為 **`gpt-5`**。
- 查詢字串會一併轉發（例如上游支援的 `debug=true`）。
- **`stream: true`** 時回應為 **SSE／串流**（`text/event-stream`），與上游一致。

## 環境變數

| 變數 | 說明 |
|------|------|
| `AI_BUILDER_TOKEN` | 必填。AI Builder API 權杖，建議放在 `.env`。 |
| `AI_BUILDER_BASE_URL` | 選填。後端根路徑，預設見上。 |

## Web 介面

- 瀏覽器開啟根路徑 **`/`** 可使用類 ChatGPT 的對話頁（Enter 送出、Shift+Enter 換行、送出後顯示「正在思考」動畫、助理回覆支援 **Markdown**）。
- 頁面可選呼叫 **`POST /v1/chat/agent`** 或 **`POST /v1/chat/completions`**。

## 使用 OpenAI 官方 SDK

將 **`base_url`** 指到本機的 **`/v1`**，例如：`http://127.0.0.1:8000/v1`。  
SDK 內建的 `api_key` 可填任意非空字串（僅用於客戶端；實際上游金鑰由本伺服器注入）。

## Search 代理

- 本機 **`POST /search`** 請求體必填 **`keyword`**、**`max_results`**；轉發時改為上游的 **`keywords`** 陣列。
- 轉發目標：`AI_BUILDER_BASE_URL` + **`/v1/search/`**（[Tavily 網搜](https://space.ai-builders.com/backend/openapi.json)）。
- 認證同樣使用伺服器端 **`AI_BUILDER_TOKEN`**，呼叫本機 API 時無需帶上游金鑰。

## Agent（最多四輪上游呼叫）

- **`POST /v1/chat/agent`** 與 **`POST /chat`**：**第 1–3 輪**請求附帶 **`web_search`** / **`read_page`** 工具；**第 4 輪**起不再附帶 **`tools`**（符合上游：不可在無 `tools` 時傳 `tool_choice`），請模型產出最終回答。
- 同一則 assistant 若含**多個** `tool_calls`，各工具會以 **`asyncio.gather` 並行執行**，再依原順序寫入 `tool` 訊息。
- 任一輪若模型**不**呼叫工具，直接回傳該輪上游 JSON。**不支援** `stream`。
- 終端追蹤：logger **`agent`**，格式 `時間 - agent - 級別 - [第N轮] 說明`，輪與輪之間有 **`===`** 分隔線；含呼叫 LLM、HTTP 狀態、工具參數與搜尋摘要。
""".strip()

openapi_tags = [
    {
        "name": "示範",
        "description": "簡單測試端點，用於確認服務已啟動。",
    },
    {
        "name": "Chat 代理",
        "description": (
            "與 [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create) "
            "請求／回應格式相容；本機轉發至 AI Builder Space。"
        ),
    },
    {
        "name": "Search 代理",
        "description": (
            "本機 **`POST /search`** 使用 **`keyword`** + **`max_results`**；轉發時改為上游的 **`keywords`** 陣列。"
            "回應格式與上游 [SearchResponse](https://space.ai-builders.com/backend/openapi.json) 一致。"
        ),
    },
    {
        "name": "Agent",
        "description": (
            "最多四輪：第 1–3 輪可呼叫 **web_search** / **read_page**，第 4 輪起關閉工具；"
            "同一輪多個 tool_calls **並行**執行（不支援串流）。"
        ),
    },
]

app = FastAPI(
    title="本地 FastAPI · AI Builder 代理（Chat / Search / Agent / Web）",
    description=APP_DESCRIPTION,
    version="0.6.1",
    openapi_tags=openapi_tags,
    docs_url="/docs",
    redoc_url="/redoc",
)

AI_BUILDER_BASE = os.getenv("AI_BUILDER_BASE_URL", "https://space.ai-builders.com/backend").rstrip(
    "/"
)
CHAT_PATH = "/v1/chat/completions"
SEARCH_PATH = "/v1/search/"
REALTIME_PROTOCOL_PATH = "/v1/audio/realtime/protocol"
REALTIME_SESSION_PATH = "/v1/audio/realtime/sessions"

# Rounds 1–3 call upstream with tools (web_search / read_page); last round omits tools (final answer).
_AGENT_MAX_ROUNDS = 4
_AGENT_TOOL_ROUNDS = 3

SEARCH_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "Search the web for current information, news, or facts.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query string.",
                },
            },
            "required": ["query"],
        },
    },
}

READ_PAGE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "read_page",
        "description": (
            "Fetch a public HTTP(S) URL and return the main visible text from the HTML "
            "(scripts, styles, and common boilerplate tags are stripped). Use after locating a URL "
            "via search or when the user gives a link."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Absolute http or https URL to fetch.",
                },
            },
            "required": ["url"],
        },
    },
}

AGENT_TOOLS: list[dict[str, Any]] = [SEARCH_TOOL, READ_PAGE_TOOL]

# Fetch limits for read_page (avoid huge responses / OOM).
_READ_PAGE_MAX_BYTES = 2 * 1024 * 1024
_READ_PAGE_MAX_TEXT_CHARS = 120_000
_SKIP_HTML_TAGS = frozenset({"script", "style", "noscript", "template"})
_BLOCK_TAGS = frozenset(
    {
        "br",
        "p",
        "div",
        "li",
        "tr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "section",
        "article",
        "header",
        "footer",
        "main",
        "table",
        "blockquote",
    }
)


class _HTMLTextExtractor(HTMLParser):
    """Collect visible text; skip script/style and similar."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        t = tag.lower()
        if t in _SKIP_HTML_TAGS:
            self._skip_depth += 1
        elif t in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in _SKIP_HTML_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
        elif t in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(data)

    def get_text(self) -> str:
        raw = "".join(self._parts)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        raw = re.sub(r"[ \t]+\n", "\n", raw)
        raw = re.sub(r"\n[ \t]+", "\n", raw)
        raw = html_module.unescape(raw)
        return raw.strip()


def _read_page_html_to_text(html: str) -> str:
    parser = _HTMLTextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception as e:
        log.warning("HTML parse fallback after error: %s", e)
        stripped = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
        stripped = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", stripped)
        stripped = re.sub(r"<[^>]+>", " ", stripped)
        return html_module.unescape(re.sub(r"\s+", " ", stripped).strip())
    return parser.get_text()


class ChatMessage(BaseModel):
    """OpenAI Chat Completions 單則訊息（可含額外欄位）。"""

    model_config = ConfigDict(extra="allow")

    role: str = Field(
        ...,
        description="訊息角色，例如：`user`、`assistant`、`system`、`tool`。",
        examples=["user"],
    )
    content: Any = Field(
        None,
        description="訊息內容；一般為字串，多模態時可為內容片段陣列。",
        examples=["法国的首都在哪里"],
    )


class ChatCompletionRequestBody(BaseModel):
    """OpenAI 相容的 Chat Completions 請求體；未列出的欄位仍會轉發給上游（如 temperature、stream、tools）。"""

    model_config = ConfigDict(
        extra="allow",
        json_schema_extra={
            "example": {
                "messages": [
                    {
                        "role": "user",
                        "content": "法国的首都在哪里",
                    }
                ],
                "model": "gpt-5",
            }
        },
    )

    messages: list[ChatMessage] = Field(
        ...,
        min_length=1,
        description="對話訊息列表（依序為對話歷史與本輪輸入）。",
    )
    model: str = Field(
        default="gpt-5",
        description="模型名稱；若省略，本代理預設為 `gpt-5`。",
        examples=["gpt-5"],
    )


class SearchProxyBody(BaseModel):
    """本機搜尋請求；轉發上游時會轉成 `keywords: [keyword]` 與 `max_results`。"""

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "keyword": "法國 首都",
                "max_results": 6,
            }
        }
    )

    keyword: str = Field(
        ...,
        min_length=1,
        description="搜尋關鍵字（單一字串）。",
        examples=["法國 首都"],
    )
    max_results: int = Field(
        ...,
        ge=1,
        le=20,
        description="此關鍵字最多回傳的結果筆數（1–20）。",
        examples=[6],
    )


def _search_url() -> str:
    return f"{AI_BUILDER_BASE}{SEARCH_PATH}"


def _chat_url(request: Request) -> str:
    base = f"{AI_BUILDER_BASE}{CHAT_PATH}"
    q = request.url.query
    if q:
        return f"{base}?{q}"
    return base


def _passthrough_url(request: Request, upstream_path: str) -> str:
    base = f"{AI_BUILDER_BASE}{upstream_path}"
    q = request.url.query
    if q:
        return f"{base}?{q}"
    return base


def _upstream_headers() -> dict[str, str]:
    token = os.getenv("AI_BUILDER_TOKEN")
    if not token:
        raise HTTPException(
            status_code=500,
            detail="AI_BUILDER_TOKEN is not set. Add it to your environment or a .env file.",
        )
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


async def _post_chat_json(url: str, payload: dict[str, Any]) -> tuple[int, Any]:
    headers = _upstream_headers()
    timeout = httpx.Timeout(300.0, connect=30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(url, json=payload, headers=headers)
    try:
        data = r.json()
    except Exception:
        return r.status_code, {"error": "upstream returned non-JSON", "text": r.text[:2000]}
    return r.status_code, data


def _log_preview(text: str, limit: int = _AGENT_LOG_PREVIEW_CHARS) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}... [truncated, total_chars={len(text)}]"


async def _run_search_tool_call(
    arguments: str,
    *,
    tool_call_id: Optional[str] = None,
    round_idx: int = 0,
    tool_index: int = 1,
    alog: Optional[logging.Logger] = None,
) -> str:
    alog = alog or _ensure_agent_logger()
    ctx = f"tool_call_id={tool_call_id!r}" if tool_call_id else "tool_call_id=None"
    _agent_msg(alog, round_idx, f"工具調用 #{tool_index}：解析參數 …")
    log.info("search tool (%s) raw_arguments=%s", ctx, _log_preview(arguments or "", 4000))

    try:
        args = json.loads(arguments or "{}")
    except json.JSONDecodeError as e:
        _agent_msg(alog, round_idx, f"工具調用 #{tool_index} 失敗：參數不是合法 JSON（{e}）")
        log.warning("search tool (%s) invalid JSON arguments: %s", ctx, e)
        return json.dumps({"error": "invalid JSON in tool arguments"}, ensure_ascii=False)
    query = args.get("query")
    if not query or not isinstance(query, str):
        _agent_msg(alog, round_idx, f"工具調用 #{tool_index} 失敗：缺少 query")
        log.warning("search tool (%s) missing/invalid query args=%s", ctx, args)
        return json.dumps({"error": "query is required and must be a string"}, ensure_ascii=False)
    
    payload = {"keywords": [query], "max_results": 3}
    _agent_msg(
        alog,
        round_idx,
        f"工具調用 #{tool_index}：POST {_search_url()} query={query!r}",
    )

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
        r = await client.post(_search_url(), json=payload, headers=_upstream_headers())
    try:
        body = r.json()
    except Exception:
        err = json.dumps(
            {"error": "search response not JSON", "status_code": r.status_code},
            ensure_ascii=False,
        )
        _agent_msg(alog, round_idx, f"工具調用 #{tool_index}：搜尋 API HTTP {r.status_code}（非 JSON）")
        log.warning(
            "search tool (%s) upstream status=%s non-JSON body_preview=%s",
            ctx,
            r.status_code,
            _log_preview(r.text, 2000),
        )
        return err

    out = json.dumps(body, ensure_ascii=False)
    _agent_msg(alog, round_idx, f"工具調用 #{tool_index} 完成：搜尋 API HTTP {r.status_code}，結果摘要：{_log_preview(out, 1500)}")
    log.info(
        "search tool (%s) upstream status=%s result_preview=%s",
        ctx,
        r.status_code,
        _log_preview(out),
    )
    return out


def _read_page_validate_url(url: str) -> Optional[str]:
    """Return error message string if invalid; None if OK."""
    u = (url or "").strip()
    if not u:
        return "url is empty"
    try:
        parsed = urlparse(u)
    except Exception:
        return "url is not parseable"
    if parsed.scheme not in ("http", "https"):
        return "only http and https URLs are allowed"
    if not parsed.netloc:
        return "url must include a host"
    return None


async def _run_read_page_tool_call(
    arguments: str,
    *,
    tool_call_id: Optional[str] = None,
    round_idx: int = 0,
    tool_index: int = 1,
    alog: Optional[logging.Logger] = None,
) -> str:
    """Fetch URL, strip HTML to main text; return JSON string for tool message."""
    alog = alog or _ensure_agent_logger()
    ctx = f"tool_call_id={tool_call_id!r}" if tool_call_id else "tool_call_id=None"
    _agent_msg(alog, round_idx, f"工具調用 #{tool_index}（read_page）：解析參數 …")
    log.info("read_page tool (%s) raw_arguments=%s", ctx, _log_preview(arguments or "", 4000))

    try:
        args = json.loads(arguments or "{}")
    except json.JSONDecodeError as e:
        _agent_msg(alog, round_idx, f"read_page #{tool_index} 失敗：參數不是合法 JSON（{e}）")
        log.warning("read_page tool (%s) invalid JSON: %s", ctx, e)
        return json.dumps({"error": "invalid JSON in tool arguments"}, ensure_ascii=False)

    raw_url = args.get("url")
    if not raw_url or not isinstance(raw_url, str):
        _agent_msg(alog, round_idx, f"read_page #{tool_index} 失敗：缺少 url")
        log.warning("read_page tool (%s) missing url args=%s", ctx, args)
        return json.dumps({"error": "url is required and must be a string"}, ensure_ascii=False)

    url_err = _read_page_validate_url(raw_url)
    if url_err:
        _agent_msg(alog, round_idx, f"read_page #{tool_index} 失敗：{url_err}")
        return json.dumps({"error": url_err, "url": raw_url}, ensure_ascii=False)

    url = raw_url.strip()
    _agent_msg(alog, round_idx, f"read_page #{tool_index}：GET {url!r} …")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; FastAPI-Agent/1.0; +https://space.ai-builders.com) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    timeout = httpx.Timeout(60.0, connect=15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            r = await client.get(url, headers=headers)
    except httpx.RequestError as e:
        err = json.dumps({"error": f"request failed: {e!s}", "url": url}, ensure_ascii=False)
        _agent_msg(alog, round_idx, f"read_page #{tool_index}：請求失敗 {e!r}")
        log.warning("read_page tool (%s) request error: %s", ctx, e)
        return err

    if r.status_code >= 400:
        err = json.dumps(
            {
                "error": f"HTTP {r.status_code}",
                "url": url,
                "body_preview": _log_preview(r.text, 500),
            },
            ensure_ascii=False,
        )
        _agent_msg(alog, round_idx, f"read_page #{tool_index}：HTTP {r.status_code}")
        return err

    body_bytes = r.content
    if len(body_bytes) > _READ_PAGE_MAX_BYTES:
        err = json.dumps(
            {
                "error": f"response too large (>{_READ_PAGE_MAX_BYTES} bytes)",
                "url": url,
            },
            ensure_ascii=False,
        )
        _agent_msg(alog, round_idx, f"read_page #{tool_index}：內容過大")
        return err

    charset = r.encoding or "utf-8"
    try:
        html = body_bytes.decode(charset, errors="replace")
    except LookupError:
        html = body_bytes.decode("utf-8", errors="replace")

    text = _read_page_html_to_text(html)
    truncated = False
    if len(text) > _READ_PAGE_MAX_TEXT_CHARS:
        text = text[:_READ_PAGE_MAX_TEXT_CHARS]
        truncated = True

    out_obj: dict[str, Any] = {
        "url": url,
        "final_url": str(r.url),
        "status_code": r.status_code,
        "content_type": r.headers.get("content-type", ""),
        "text": text,
    }
    if truncated:
        out_obj["truncated"] = True
        out_obj["max_text_chars"] = _READ_PAGE_MAX_TEXT_CHARS

    out = json.dumps(out_obj, ensure_ascii=False)
    _agent_msg(
        alog,
        round_idx,
        f"read_page #{tool_index} 完成：HTTP {r.status_code}，文字長度 {len(text)}，摘要：{_log_preview(text, 1200)}",
    )
    log.info(
        "read_page tool (%s) status=%s text_len=%s preview=%s",
        ctx,
        r.status_code,
        len(text),
        _log_preview(text),
    )
    return out


async def _agent_execute_one_tool_call(
    tc: dict[str, Any],
    tool_index: int,
    round_idx: int,
    alog: logging.Logger,
) -> tuple[str, str, Optional[str]]:
    """Run one tool call; returns (tool_call_id, content_json_string, tool_name)."""
    fn = tc.get("function") or {}
    name = fn.get("name")
    args = fn.get("arguments") or "{}"
    tc_id = tc.get("id", "")
    if name == "web_search" or name == "search":
        tool_content = await _run_search_tool_call(
            args,
            tool_call_id=tc_id,
            round_idx=round_idx,
            tool_index=tool_index,
            alog=alog,
        )
    elif name == "read_page":
        tool_content = await _run_read_page_tool_call(
            args,
            tool_call_id=tc_id,
            round_idx=round_idx,
            tool_index=tool_index,
            alog=alog,
        )
    else:
        tool_content = json.dumps({"error": f"unknown tool: {name}"}, ensure_ascii=False)
        _agent_msg(alog, round_idx, f"未知工具 {name!r}，已寫入錯誤訊息")
        log.warning("agent round %s unknown tool name=%s id=%s", round_idx, name, tc_id)
    return (tc_id, tool_content, name)


def _agent_messages_with_default_system(messages: list[Any]) -> list[Any]:
    """Prepend a system hint when none is present so models use tools instead of refusing."""
    has_system = any(isinstance(m, dict) and m.get("role") == "system" for m in messages)
    if has_system:
        return messages
    hint = (
        "You have tools: web_search (query the web) and read_page (fetch an http(s) URL and return "
        "visible page text). When the user needs current facts, changelog text, or page content, "
        "call these tools. Do not say you cannot browse or that tools are disabled. "
        "If the user asks to read a changelog or official page: search first, then call read_page "
        "on the docs.python.org (or python.org) URL from the results; do not only repeat searches."
    )
    return [{"role": "system", "content": hint}, *messages]


async def _agentic_chat_response(request: Request, body: ChatCompletionRequestBody) -> Response:
    base = body.model_dump(mode="json")
    if base.get("stream") is True:
        raise HTTPException(
            status_code=400,
            detail="Agentic chat does not support stream=true; omit stream or set false.",
        )
    base.pop("stream", None)
    base.pop("tools", None)
    base.pop("tool_choice", None)

    model = base.get("model") or "gpt-5"
    messages: list[Any] = _agent_messages_with_default_system(list(base["messages"]))
    url = _chat_url(request)

    passthrough = {k: base[k] for k in ("temperature", "max_tokens", "top_p", "user", "metadata") if k in base and base[k] is not None}

    def _json_response(data: Any, status_code: int) -> Response:
        return Response(
            content=json.dumps(data, ensure_ascii=False).encode("utf-8"),
            status_code=status_code,
            media_type="application/json",
        )

    alog = _ensure_agent_logger()
    _agent_sep(alog)
    alog.info(
        "Agent 開始 | model=%s | 對話 %s 則訊息 | 最多 %s 輪（前 %s 輪可呼叫 web_search / read_page）",
        model,
        len(messages),
        _AGENT_MAX_ROUNDS,
        _AGENT_TOOL_ROUNDS,
    )

    for round_idx in range(1, _AGENT_MAX_ROUNDS + 1):
        use_tools = round_idx <= _AGENT_TOOL_ROUNDS
        if round_idx > 1:
            _agent_sep(alog)
        _agent_msg(alog, round_idx, "開始呼叫 LLM")
        if use_tools:
            _agent_msg(alog, round_idx, "已提供 web_search / read_page 工具（tool_choice=auto）")
        else:
            _agent_msg(alog, round_idx, "本輪不再提供工具，請產出最終回答")

        if use_tools:
            payload: dict[str, Any] = {
                "model": model,
                "messages": messages,
                "tools": AGENT_TOOLS,
                "tool_choice": "auto",
                **passthrough,
            }
        else:
            payload = {"model": model, "messages": messages, **passthrough}

        status, data = await _post_chat_json(url, payload)
        _agent_msg(alog, round_idx, f"POST {CHAT_PATH} → HTTP {status}")
        log.info(
            "agent round %s/%s model=%s use_tools=%s message_count=%s",
            round_idx,
            _AGENT_MAX_ROUNDS,
            model,
            use_tools,
            len(messages),
        )

        if status >= 400:
            _agent_msg(alog, round_idx, f"上游錯誤，結束：{_log_preview(json.dumps(data, ensure_ascii=False), 1200)}")
            _agent_sep(alog)
            log.warning(
                "agent round %s chat upstream error status=%s body_preview=%s",
                round_idx,
                status,
                _log_preview(json.dumps(data, ensure_ascii=False)),
            )
            return _json_response(data, status)

        choices = data.get("choices") or []
        if not choices:
            _agent_msg(alog, round_idx, "上游未回傳 choices，直接返回")
            _agent_sep(alog)
            return _json_response(data, 200)

        msg = choices[0].get("message") or {}
        tool_calls = msg.get("tool_calls")

        if not tool_calls:
            finish = choices[0].get("finish_reason")
            content_preview = msg.get("content")
            if isinstance(content_preview, str):
                print(f"[Agent] Final Answer: '{content_preview}'")
                content_preview = _log_preview(content_preview, 2000)
            _agent_msg(
                alog,
                round_idx,
                f"模型未請求工具，finish_reason={finish!r}，內容摘要：{content_preview}",
            )
            _agent_msg(alog, round_idx, "完成，返回最終結果")
            _agent_sep(alog)
            log.info(
                "agent round %s final assistant message (no tool_calls) finish_reason=%s content_preview=%s",
                round_idx,
                finish,
                content_preview,
            )
            return _json_response(data, 200)

        if round_idx >= _AGENT_MAX_ROUNDS:
            _agent_msg(alog, round_idx, f"最後一輪仍出現 tool_calls（異常），原樣返回：{tool_calls!r}")
            log.warning(
                "agent round %s unexpected tool_calls on last round; returning upstream as-is tool_calls=%s",
                round_idx,
                tool_calls,
            )
            _agent_sep(alog)
            return _json_response(data, 200)

        tc_summary = [
            {
                "id": tc.get("id"),
                "name": (tc.get("function") or {}).get("name"),
                "arguments_preview": _log_preview((tc.get("function") or {}).get("arguments") or "", 2000),
            }
            for tc in tool_calls
        ]
        
        for tc in tool_calls:
            name = (tc.get("function") or {}).get("name")
            print(f"[Agent] Decided to call tool: '{name}'")
            
        _agent_msg(alog, round_idx, f"模型請求 {len(tool_calls)} 個工具：{json.dumps(tc_summary, ensure_ascii=False)}")
        log.info(
            "agent round %s assistant requested %s tool_call(s): %s",
            round_idx,
            len(tool_calls),
            json.dumps(tc_summary, ensure_ascii=False),
        )

        messages.append(dict(msg))
        n_tools = len(tool_calls)
        if n_tools > 1:
            _agent_msg(alog, round_idx, f"並行執行 {n_tools} 個工具調用（asyncio.gather）…")
        coros = [
            _agent_execute_one_tool_call(tc, ti, round_idx, alog)
            for ti, tc in enumerate(tool_calls, start=1)
        ]
        results = await asyncio.gather(*coros)
        for ti, (tc_id, tool_content, name) in enumerate(results, start=1):
            print(f"[System] Tool Output: '{_log_preview(tool_content, 500)}'")
            _agent_msg(alog, round_idx, f"已將工具 #{ti}（{name}）結果寫入對話（tool_call_id={tc_id!r}）")
            log.info(
                "agent round %s tool result written to conversation id=%s name=%s content_preview=%s",
                round_idx,
                tc_id,
                name,
                _log_preview(tool_content),
            )
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": tool_content,
                }
            )

        _agent_msg(alog, round_idx, "工具結果已加入對話，準備下一輪")

    raise RuntimeError("agent loop fell through")  # pragma: no cover


@app.get(
    "/hello/{input}",
    tags=["示範"],
    summary="問候（路徑參數）",
    description=(
        "回傳 JSON，欄位 **message** 為字串：`Hello, World <` + **input** + `>`；"
        "**input** 為路徑中的單一路徑片段（不含 `/`）。"
    ),
    response_description="固定結構：`message` 為問候字串。",
)
def hello(input: str) -> dict[str, str]:
    return {"message": f"Hello, World <{input}>"}


async def _proxy_chat_to_ai_builder(request: Request, payload: dict[str, Any]) -> Response:
    payload.setdefault("model", "gpt-5")

    url = _chat_url(request)
    headers = _upstream_headers()
    timeout = httpx.Timeout(300.0, connect=30.0)
    client = httpx.AsyncClient(timeout=timeout)
    use_stream = payload.get("stream") is True

    if use_stream:
        req = client.build_request("POST", url, json=payload, headers=headers)
        try:
            upstream = await client.send(req, stream=True)
        except Exception:
            await client.aclose()
            raise

        async def iter_stream() -> AsyncIterator[bytes]:
            try:
                async for chunk in upstream.aiter_bytes():
                    yield chunk
            finally:
                await upstream.aclose()
                await client.aclose()

        media_type = upstream.headers.get("content-type", "text/event-stream; charset=utf-8")
        return StreamingResponse(
            iter_stream(),
            status_code=upstream.status_code,
            media_type=media_type,
        )

    try:
        upstream = await client.post(url, json=payload, headers=headers)
    finally:
        await client.aclose()

    media_type = upstream.headers.get("content-type", "application/json")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=media_type,
    )


@app.post(
    "/v1/chat/completions",
    tags=["Chat 代理"],
    summary="創建聊天完成（OpenAI 相容）",
    description="""
接收 **OpenAI 格式**的聊天完成請求，轉發至 AI Builder API；未指定 **`model`** 時使用 **`gpt-5`**。

**建議使用此路徑**，以便與 OpenAI 官方 SDK／工具鏈一致（`base_url` 指向 `http://主機:埠/v1`）。

**請求體**：至少包含 **`messages`**；其餘欄位與 OpenAI `chat.completions.create` 相同（如 `temperature`、`stream`、`tools` 等），會一併轉發。

**回應**：非串流時為 JSON；`stream: true` 時為 `text/event-stream`（SSE）。

**查詢參數**：URL 上的 query string 會轉發給上游（若上游支援，例如除錯選項）。
    """.strip(),
    response_description=(
        "視上游而定：通常為 `application/json` 的 Chat Completion，"
        "或串流時的 `text/event-stream`。"
    ),
    responses={
        422: {"description": "請求體不符合結構（例如缺少 `messages`）。"},
        500: {"description": "伺服器未設定 `AI_BUILDER_TOKEN`，或上游發生錯誤（狀態碼與內容由上游決定）。"},
    },
)
async def openai_chat_completions(
    request: Request,
    body: ChatCompletionRequestBody,
) -> Response:
    return await _proxy_chat_to_ai_builder(request, body.model_dump(mode="json"))


@app.post(
    "/chat",
    tags=["Chat 代理"],
    summary="創建聊天完成（簡短路徑）",
    description="""
與 **`POST /v1/chat/completions`** 行為與請求體結構相同，僅路徑較短。  
若使用 OpenAI SDK，請優先使用 **`/v1/chat/completions`** 並設定正確的 `base_url`。
    """.strip(),
    response_description="與 `POST /v1/chat/completions` 相同。",
    responses={
        422: {"description": "請求體不符合結構（例如缺少 `messages`）。"},
        500: {"description": "伺服器未設定 `AI_BUILDER_TOKEN`，或上游錯誤。"},
    },
)
async def chat_short_path(
    request: Request,
    body: ChatCompletionRequestBody,
) -> Response:
    return await _agentic_chat_response(request, body)


@app.post(
    "/v1/chat/agent",
    tags=["Agent"],
    summary="Agent：web_search / read_page（最多四輪）",
    description="""
與一般 Chat 請求體相同（**`messages`**、**`model`** 等），由伺服器代為完成 **最多四次** 上游呼叫：

1. **第一至三輪**：附帶 **`web_search`** 與 **`read_page`** 工具，`tool_choice: auto`。  
   若模型**不**呼叫工具，直接回傳該輪上游 JSON（可能僅一或數次呼叫即結束）。
2. **第四輪**：對話中已含先前的 `tool_calls` 與 **`tool`** 結果時，**不再附帶** `tools`／`tool_choice`，請模型產出最終文字回答。

**不支援** `stream`。客戶端若傳入 `tools`／`tool_choice` 會被忽略。

**多工具**：同一輪若模型回傳多個 `tool_calls`，會 **並行** 執行（`asyncio.gather`），再依原順序附加 `tool` 訊息。

**除錯**：終端會顯示 logger **`agent`** 的追蹤行（`[第N轮]`、`===` 分隔、POST 狀態、工具與搜尋摘要）。
    """.strip(),
    response_description="最後一輪上游回傳的 Chat Completion JSON（若第一輪未呼叫工具，則與第一輪相同）。",
    responses={
        400: {"description": "傳入 `stream: true`。"},
        422: {"description": "請求體驗證失敗。"},
        500: {"description": "未設定 `AI_BUILDER_TOKEN` 或上游錯誤。"},
    },
)
async def chat_agent_v1(
    request: Request,
    body: ChatCompletionRequestBody,
) -> Response:
    return await _agentic_chat_response(request, body)


@app.post(
    "/chat/agent",
    tags=["Agent"],
    summary="Agent：web_search / read_page 最多四輪（簡短路徑）",
    description="與 **`POST /v1/chat/agent`** 相同，僅路徑較短。",
    response_description="與 **`POST /v1/chat/agent`** 相同。",
    responses={
        400: {"description": "傳入 `stream: true`。"},
        422: {"description": "請求體驗證失敗。"},
        500: {"description": "伺服器或上游錯誤。"},
    },
)
async def chat_agent_short(
    request: Request,
    body: ChatCompletionRequestBody,
) -> Response:
    return await _agentic_chat_response(request, body)


async def _forward_search_to_ai_builder(payload: dict[str, Any]) -> Response:
    url = _search_url()
    headers = _upstream_headers()
    timeout = httpx.Timeout(120.0, connect=30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        upstream = await client.post(url, json=payload, headers=headers)
    media_type = upstream.headers.get("content-type", "application/json")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=media_type,
    )


async def _forward_request_to_ai_builder(
    request: Request,
    *,
    upstream_path: str,
    method: str,
) -> Response:
    url = _passthrough_url(request, upstream_path)
    headers = _upstream_headers()
    timeout = httpx.Timeout(120.0, connect=30.0)
    content = await request.body()
    async with httpx.AsyncClient(timeout=timeout) as client:
        upstream = await client.request(method, url, content=content, headers=headers)
    media_type = upstream.headers.get("content-type", "application/json")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=media_type,
    )


@app.post(
    "/search",
    tags=["Search 代理"],
    summary="網路搜尋（轉發 AI Builder /v1/search/）",
    description="""
請求體必填 **`keyword`**（字串）與 **`max_results`**（整數，1–20）。  
本機會轉成上游格式：`{"keywords": [keyword], "max_results": ...}`，再呼叫 [AI Builder Space](https://space.ai-builders.com) 的 **`POST /v1/search/`**（Tavily）。

**回應**：與上游 `SearchResponse` 相同。  
認證由本伺服器以 **`AI_BUILDER_TOKEN`** 帶入。
    """.strip(),
    response_description="與上游 `SearchResponse` 相同之 JSON。",
    responses={
        422: {"description": "請求體缺少欄位或格式不符（例如 `keyword` 為空）。"},
        500: {"description": "未設定 `AI_BUILDER_TOKEN`，或上游錯誤。"},
    },
)
async def search_post(body: SearchProxyBody) -> Response:
    payload = {"keywords": [body.keyword], "max_results": body.max_results}
    return await _forward_search_to_ai_builder(payload)


@app.get(
    "/search",
    tags=["Search 代理"],
    summary="網路搜尋（單一關鍵字，查詢參數）",
    description="""
查詢參數 **`keyword`** 與 **`max_results`**（皆必填），語意與 **`POST /search`** 請求體相同。

方便在瀏覽器快速試用；程式整合建議使用 **`POST /search`**。
    """.strip(),
    response_description="與 `POST /search`／上游 `SearchResponse` 相同之 JSON。",
    responses={
        422: {"description": "`keyword` 為空或 `max_results` 超出範圍。"},
        500: {"description": "未設定 `AI_BUILDER_TOKEN`，或上游錯誤。"},
    },
)
async def search_get(
    keyword: str = Query(
        ...,
        min_length=1,
        description="搜尋關鍵字（單一字串）。",
        examples=["法國 首都"],
    ),
    max_results: int = Query(
        ...,
        ge=1,
        le=20,
        description="最多回傳結果筆數（1–20）。",
        examples=[6],
    ),
) -> Response:
    body = SearchProxyBody(keyword=keyword, max_results=max_results)
    payload = {"keywords": [body.keyword], "max_results": body.max_results}
    return await _forward_search_to_ai_builder(payload)


@app.get(
    "/backend/v1/audio/realtime/protocol",
    include_in_schema=False,
)
async def realtime_protocol_proxy(request: Request) -> Response:
    return await _forward_request_to_ai_builder(
        request,
        upstream_path=REALTIME_PROTOCOL_PATH,
        method="GET",
    )


@app.post(
    "/backend/v1/audio/realtime/sessions",
    include_in_schema=False,
)
async def realtime_session_proxy(request: Request) -> Response:
    return await _forward_request_to_ai_builder(
        request,
        upstream_path=REALTIME_SESSION_PATH,
        method="POST",
    )


STATIC_DIR = Path(__file__).resolve().parent / "static"
# Deployment target UI: built `transcriptor-2`.
TRANSCRIPTOR_2_UI_DIR = Path(__file__).resolve().parent / "transcriptor-2" / "dist"
# Legacy Next.js static export (`npm run build` in chatgpt-clone); served if present and Transcriptor 2 is absent.
NEXT_UI_DIR = Path(__file__).resolve().parent / "chatgpt-clone" / "out"

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if TRANSCRIPTOR_2_UI_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(TRANSCRIPTOR_2_UI_DIR), html=True), name="transcriptor_2_ui")
elif NEXT_UI_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(NEXT_UI_DIR), html=True), name="next_ui")
else:

    @app.get("/", include_in_schema=False)
    def chat_web_ui() -> FileResponse:
        return FileResponse(
            STATIC_DIR / "chat.html",
            media_type="text/html; charset=utf-8",
        )
