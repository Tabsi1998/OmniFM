from datetime import datetime
from zoneinfo import ZoneInfo

from backend import server


def to_ms(year, month, day, hour=20, minute=0):
    return int(datetime(year, month, day, hour, minute, tzinfo=ZoneInfo("Europe/Vienna")).timestamp() * 1000)


def test_preview_expands_weekday_schedule_in_local_timezone():
    friday = to_ms(2026, 9, 4)
    rows = server.build_dashboard_event_preview_rows({
        "runAtMs": friday,
        "durationMs": 90 * 60 * 1000,
        "repeat": "weekdays",
        "timeZone": "Europe/Vienna",
    }, 3)

    assert [row["startsAtLocal"] for row in rows] == [
        "2026-09-04T20:00",
        "2026-09-07T20:00",
        "2026-09-08T20:00",
    ]
    assert rows[0]["endsAtLocal"] == "2026-09-04T21:30"


def test_preview_reports_voice_channel_overlap_but_ignores_other_channels():
    candidate = {
        "id": "candidate",
        "name": "Candidate Show",
        "voiceChannelId": "123456789012345678",
        "runAtMs": to_ms(2026, 9, 8),
        "durationMs": 60 * 60 * 1000,
        "repeat": "none",
        "timeZone": "Europe/Vienna",
    }
    conflicts = server.build_dashboard_event_conflicts(candidate, [
        {
            "id": "same-channel", "name": "Existing Show",
            "voiceChannelId": "123456789012345678",
            "runAtMs": to_ms(2026, 9, 8, 20, 30), "durationMs": 60 * 60 * 1000,
            "repeat": "none", "timeZone": "Europe/Vienna", "enabled": True,
        },
        {
            "id": "other-channel", "name": "Other Channel",
            "voiceChannelId": "987654321098765432",
            "runAtMs": to_ms(2026, 9, 8, 20, 30), "durationMs": 60 * 60 * 1000,
            "repeat": "none", "timeZone": "Europe/Vienna", "enabled": True,
        },
    ])

    assert len(conflicts) == 1
    assert conflicts[0]["severity"] == "error"
    assert conflicts[0]["eventId"] == "same-channel"
    assert "Existing Show" in conflicts[0]["message"]
