from backend import server
from backend.routers.admin import is_discord_webhook_url


def test_only_discord_webhooks_are_accepted_for_operator_alerts():
    assert is_discord_webhook_url("https://discord.com/api/webhooks/123/abc")
    assert is_discord_webhook_url("https://canary.discord.com/api/webhooks/123/abc")
    assert not is_discord_webhook_url("http://discord.com/api/webhooks/123/abc")
    assert not is_discord_webhook_url("https://discord.com.evil.example/api/webhooks/123/abc")
    assert not is_discord_webhook_url("https://discord.com/api/users/123")
    assert not is_discord_webhook_url("")


def test_the_operator_webhook_url_is_masked_like_a_password():
    masked = server.mask_config_secrets({"operatorAlerts": {"webhookUrl": "https://discord.com/api/webhooks/1/secret", "mention": "<@1>"}})
    alerts = masked["operatorAlerts"]
    assert "secret" not in alerts["webhookUrl"]
    assert alerts["webhookUrlSet"] is True
    assert alerts["mention"] == "<@1>"


def test_operator_alerts_are_part_of_the_default_system_config():
    defaults = server.DEFAULT_OWNER_CONFIG["system"]["operatorAlerts"]
    assert defaults["webhookUrl"] == ""
    assert all(defaults[key] is True for key in ("workerOffline", "failoverExhausted", "playbackLoops", "workerAutoheal", "diskSpace", "backupFailed", "updates"))
