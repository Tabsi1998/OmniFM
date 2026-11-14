from backend import server


def test_local_hosts_stay_blocked_without_the_test_sender(monkeypatch):
    monkeypatch.delenv("OMNIFM_TEST_STREAM_ORIGIN", raising=False)
    assert server.validate_custom_station_url("http://127.0.0.1:18008/test.mp3")["ok"] is False


def test_only_the_test_harness_sender_passes_exactly(monkeypatch):
    # #542: the contract suite's local test sender, nothing else on the machine.
    monkeypatch.setenv("OMNIFM_TEST_STREAM_ORIGIN", "http://127.0.0.1:18008")
    assert server.validate_custom_station_url("http://127.0.0.1:18008/test.mp3")["ok"] is True
    for url in ("http://127.0.0.1/x", "http://127.0.0.1:18009/x", "https://127.0.0.1:18008/x",
                "http://localhost:18008/x", "http://10.0.0.1:18008/x"):
        assert server.validate_custom_station_url(url)["ok"] is False, url


def test_the_test_sender_must_be_a_loopback_origin_with_a_port(monkeypatch):
    for origin in ("http://10.0.0.1:18008", "http://127.0.0.1", "not a url", "http://127.0.0.1:99999"):
        monkeypatch.setenv("OMNIFM_TEST_STREAM_ORIGIN", origin)
        assert server.validate_custom_station_url("http://10.0.0.1:18008/x")["ok"] is False, origin
        assert server.validate_custom_station_url("http://127.0.0.1/x")["ok"] is False, origin
