from datetime import datetime, timezone

from backend import server


def test_process_incident_keeps_its_fields():
    row = server.format_runtime_incident({
        "at": "2026-09-24T10:00:00+00:00",
        "severity": "WARNING",
        "source": "station-health",
        "message": "Sender x ist offline",
        "resolved": False,
    })
    assert row == {
        "at": "2026-09-24T10:00:00+00:00",
        "severity": "warning",
        "source": "station-health",
        "message": "Sender x ist offline",
        "resolved": False,
    }


def test_server_incident_without_message_is_named_after_guild_and_event():
    row = server.format_runtime_incident({
        "guildId": "123456789012345678",
        "guildName": "Guild One",
        "eventKey": "stream_failover_activated",
        "severity": "warning",
        "timestamp": datetime(2026, 9, 24, 10, 0, 0),
        "runtime": {"name": "OmniFM 3"},
        "acknowledgedAt": "2026-09-24T11:00:00+00:00",
    })
    assert row["message"] == "Guild One: stream_failover_activated"
    assert row["source"] == "OmniFM 3"
    assert row["at"] == "2026-09-24T10:00:00+00:00"
    assert row["resolved"] is True


def test_server_incident_with_stored_message_uses_it():
    row = server.format_runtime_incident({
        "guildId": "123456789012345678",
        "eventKey": "stream_failback_completed",
        "at": "2026-09-24T10:00:00.000Z",
        "message": "Guild One: zurück auf Alpha FM (vorher Beta FM)",
        "source": "OmniFM 3",
        "severity": "success",
        "resolved": True,
    })
    assert row["message"].startswith("Guild One: zurück auf Alpha FM")
    assert row["resolved"] is True


class _FakeDirectory:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    def find(self, query, projection=None):
        self.queries.append((query, projection))
        wanted = set(query["_id"]["$in"])
        hidden = set((projection or {}).keys())
        return [{key: value for key, value in row.items() if key not in hidden}
                for row in self.rows if row["_id"] in wanted]


class _FakeDb:
    def __init__(self, rows):
        self.runtime_guild_directory = _FakeDirectory(rows)


GUILD_ONE = "123456789012345678"
GUILD_TWO = "223456789012345678"
DIRECTORY_ROWS = [
    {
        "_id": GUILD_ONE,
        "name": "Guild One",
        "memberCount": 5,
        "iconUrl": "https://cdn.example.test/1.png",
        "roles": [{"id": "1", "name": "DJ"}],
        "voiceChannels": [{"id": "2", "name": "Radio"}],
        "textChannels": [{"id": "3", "name": "chat"}],
        "at": "2026-09-24T10:00:00.000Z",
    },
    {"_id": GUILD_TWO, "name": "Guild Two", "memberCount": 9, "roles": [], "voiceChannels": [], "textChannels": []},
]


def _use(monkeypatch, live, rows):
    fake_db = _FakeDb(rows)
    monkeypatch.setattr(server, "read_runtime_health_fresh", lambda *args, **kwargs: live)
    monkeypatch.setattr(server, "db", fake_db)
    return fake_db


def test_guild_directory_lists_every_member_server_from_guild_ids(monkeypatch):
    live = {"nodes": [
        {"name": "Commander", "guildIds": [GUILD_ONE, GUILD_TWO], "guildDetails": [
            {"id": GUILD_ONE, "guildId": GUILD_ONE, "name": "Guild One", "playing": True},
        ]},
        {"name": "Worker 2", "guildIds": [GUILD_TWO], "guildDetails": []},
    ]}
    fake_db = _use(monkeypatch, live, DIRECTORY_ROWS)
    guilds = server._runtime_guild_directory()
    assert sorted(guilds) == [GUILD_ONE, GUILD_TWO]
    assert guilds[GUILD_TWO]["name"] == "Guild Two"
    assert guilds[GUILD_TWO]["bots"] == ["Commander", "Worker 2"]
    assert guilds[GUILD_ONE]["iconUrl"] == "https://cdn.example.test/1.png"
    assert guilds[GUILD_ONE]["roles"] == [], "lists only on request"
    assert fake_db.runtime_guild_directory.queries[0][1] == {"roles": 0, "voiceChannels": 0, "textChannels": 0}


def test_guild_directory_for_one_server_brings_roles_and_channels(monkeypatch):
    live = {"nodes": [{"name": "Commander", "guildIds": [GUILD_ONE, GUILD_TWO], "guildDetails": []}]}
    fake_db = _use(monkeypatch, live, DIRECTORY_ROWS)
    guilds = server._runtime_guild_directory([GUILD_ONE], with_lists=True)
    assert list(guilds) == [GUILD_ONE]
    assert guilds[GUILD_ONE]["roles"] == [{"id": "1", "name": "DJ"}]
    assert guilds[GUILD_ONE]["voiceChannels"] == [{"id": "2", "name": "Radio"}]
    assert guilds[GUILD_ONE]["textChannels"] == [{"id": "3", "name": "chat"}]
    assert fake_db.runtime_guild_directory.queries == [({"_id": {"$in": [GUILD_ONE]}}, None)]


def test_guild_directory_keeps_inline_lists_of_an_older_bot(monkeypatch):
    inline = {"roles": [{"id": "9", "name": "Alt"}], "voiceChannels": [{"id": "8"}], "textChannels": [{"id": "7"}]}
    live = {"nodes": [{"name": "Commander", "guildDetails": [
        {"id": GUILD_ONE, "name": "Old Name", "memberCount": 3, **inline},
    ]}]}
    _use(monkeypatch, live, DIRECTORY_ROWS)
    guild = server._runtime_guild_directory([GUILD_ONE], with_lists=True)[GUILD_ONE]
    assert guild["roles"] == inline["roles"]
    assert guild["name"] == "Old Name"
    assert guild["memberCount"] == 5
