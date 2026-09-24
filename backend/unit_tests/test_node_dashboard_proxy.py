from backend import server


def test_proxy_headers_keep_the_browser_headers_and_add_the_client():
    headers = {
        "host": "omnifm.xyz",
        "cookie": "omnifm_session=abc",
        "x-omnifm-csrf": "dashboard-intent",
        "content-type": "application/json",
        "content-length": "12",
        "connection": "keep-alive",
        "x-forwarded-for": "203.0.113.7",
        "x-forwarded-proto": "https",
        "origin": "https://omnifm.xyz",
    }
    forwarded = server.build_node_proxy_headers(headers, client_host="127.0.0.1", scheme="http")
    assert forwarded["cookie"] == "omnifm_session=abc"
    assert forwarded["x-omnifm-csrf"] == "dashboard-intent"
    assert forwarded["x-forwarded-for"] == "203.0.113.7, 127.0.0.1"
    assert forwarded["x-forwarded-proto"] == "https", "nginx knows the scheme of the browser"
    assert forwarded["x-forwarded-host"] == "omnifm.xyz"
    assert "origin" not in forwarded, "same-origin requests pass without Origin"
    for dropped in ("host", "content-length", "connection"):
        assert dropped not in forwarded


def test_proxy_headers_pass_a_foreign_origin_on():
    forwarded = server.build_node_proxy_headers(
        {"host": "omnifm.xyz", "origin": "https://evil.example"}, client_host="198.51.100.4", scheme="https"
    )
    assert forwarded["origin"] == "https://evil.example"
    assert forwarded["x-forwarded-for"] == "198.51.100.4"
    assert forwarded["x-forwarded-proto"] == "https"


def test_proxy_response_keeps_every_cookie_and_the_redirect():
    response = server.build_node_proxy_response(302, [
        ("Location", "https://discord.com/oauth2/authorize?client_id=1"),
        ("Set-Cookie", "omnifm_session=a; Path=/"),
        ("Set-Cookie", "omnifm_lang=de; Path=/"),
        ("Content-Encoding", "gzip"),
        ("Transfer-Encoding", "chunked"),
    ], b"")
    assert response.status_code == 302
    assert response.headers["location"].startswith("https://discord.com/")
    assert response.headers.getlist("set-cookie") == ["omnifm_session=a; Path=/", "omnifm_lang=de; Path=/"]
    assert "content-encoding" not in response.headers
    assert "transfer-encoding" not in response.headers


def test_proxy_routes_come_before_the_fastapi_routes():
    from fastapi import FastAPI

    probe = FastAPI()

    @probe.get("/api/dashboard/settings")
    async def local_settings():
        return {"from": "fastapi"}

    server.install_node_dashboard_proxy(probe)
    paths = [getattr(route, "path", "") for route in probe.router.routes]
    first_proxy = min(paths.index(p) for p in ("/api/dashboard/{path:path}", "/api/dashboard", "/api/auth/{path:path}", "/api/auth"))
    assert first_proxy < paths.index("/api/dashboard/settings")
