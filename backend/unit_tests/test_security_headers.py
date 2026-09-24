import asyncio

from starlette.requests import Request
from starlette.responses import JSONResponse

from backend import server


def run_middleware(path, headers=None):
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "scheme": "http",
        "server": ("127.0.0.1", 8001),
        "headers": [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()],
    }

    async def call_next(_request):
        return JSONResponse({"ok": True})

    return asyncio.run(server.add_security_headers(Request(scope), call_next)).headers


def test_api_responses_carry_a_content_security_policy():
    headers = run_middleware("/api/legal")

    policy = headers["content-security-policy"]
    assert "default-src 'self'" in policy
    assert policy.index("object-src 'none'") < policy.index("frame-ancestors 'none'")
    assert headers["x-frame-options"] == "DENY"


def test_hsts_only_behind_https():
    assert "strict-transport-security" not in run_middleware("/api/legal")

    proxied = run_middleware("/api/legal", {"X-Forwarded-Proto": "https"})
    assert proxied["strict-transport-security"].startswith("max-age=31536000")
