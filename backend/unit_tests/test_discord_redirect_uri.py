"""The Discord redirect URI is made from the website's address, not typed in."""
from backend import server


def _owner(monkeypatch, redirect_uri=""):
    monkeypatch.setattr(server, "load_owner_config_raw", lambda: {"system": {"discordOAuth": {"redirectUri": redirect_uri}}})


def test_a_public_explicit_setting_wins(monkeypatch):
    _owner(monkeypatch)
    monkeypatch.setenv("DISCORD_REDIRECT_URI", "https://login.example.org/api/auth/discord/callback")
    monkeypatch.setenv("PUBLIC_WEB_URL", "https://omnifm.xyz")
    assert server.discord_redirect_uri() == "https://login.example.org/api/auth/discord/callback"


def test_install_leftovers_never_reach_discord(monkeypatch):
    # The live case of 2026-09-25: localhost from .env.example, the LAN address
    # from start.sh, the working address only in the owner console.
    _owner(monkeypatch, "https://omnifm.xyz/api/auth/discord/callback")
    monkeypatch.setenv("DISCORD_REDIRECT_URI", "http://localhost:8081/api/auth/discord/callback")
    monkeypatch.setenv("PUBLIC_WEB_URL", "http://192.168.2.253:8001")
    monkeypatch.delenv("WEB_DOMAIN", raising=False)
    assert server.discord_redirect_uri() == "https://omnifm.xyz/api/auth/discord/callback"
    assert server.is_public_origin("http://10.0.0.5:8001") is False
    assert server.is_public_origin("https://omnifm.xyz") is True


def test_development_without_public_address_keeps_the_local_setting(monkeypatch):
    _owner(monkeypatch)
    monkeypatch.setenv("DISCORD_REDIRECT_URI", "http://localhost:8081/api/auth/discord/callback")
    monkeypatch.setenv("PUBLIC_WEB_URL", "http://localhost:8081")
    monkeypatch.delenv("WEB_DOMAIN", raising=False)
    assert server.discord_redirect_uri() == "http://localhost:8081/api/auth/discord/callback"


def test_made_from_the_website_address(monkeypatch):
    _owner(monkeypatch, "https://old.example/whatever")
    monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    monkeypatch.setenv("PUBLIC_WEB_URL", "https://staging.omnifm.xyz/some/path")
    assert server.discord_redirect_uri() == "https://staging.omnifm.xyz/api/auth/discord/callback"


def test_web_domain_then_an_older_stored_uri_lend_the_address(monkeypatch):
    monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    monkeypatch.delenv("PUBLIC_WEB_URL", raising=False)
    monkeypatch.setenv("WEB_DOMAIN", "radio.example.org")
    _owner(monkeypatch, "https://old.example/cb")
    assert server.discord_redirect_uri() == "https://radio.example.org/api/auth/discord/callback"
    monkeypatch.delenv("WEB_DOMAIN", raising=False)
    assert server.discord_redirect_uri() == "https://old.example/api/auth/discord/callback"
    _owner(monkeypatch, "")
    assert server.discord_redirect_uri() == "https://omnifm.xyz/api/auth/discord/callback"


def test_oauth_counts_as_set_up_with_id_and_secret(monkeypatch):
    monkeypatch.delenv("DISCORD_REDIRECT_URI", raising=False)
    values = {("discordOAuth", "clientId"): "id", ("discordOAuth", "clientSecret"): "secret"}
    monkeypatch.setattr(server, "system_setting", lambda group, key, env_key=None, default="": values.get((group, key), default))
    assert server.is_discord_oauth_configured() is True
    values[("discordOAuth", "clientSecret")] = ""
    assert server.is_discord_oauth_configured() is False
