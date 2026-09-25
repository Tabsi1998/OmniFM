from backend import server


def test_catalog_fields_are_cleaned_like_the_node_side():
    fields = server.station_catalog_fields({
        "genre": "Techno", "color": "7c3aed", "logo": "http://x/logo.png",
        "homepage": "https://example.com/", "country": "DE", "language": "",
    })
    assert fields == {"genre": "Techno", "color": "#7C3AED", "homepage": "https://example.com/", "country": "DE"}
    assert server.station_catalog_fields({}) == {"genre": "Radio"}


def test_the_start_fills_only_what_the_owner_left_empty():
    stored = {"key": "pro_tech_02", "url": "https://stream.technolovers.fm/hypertechno", "genre": "Radio", "color": "#123456"}
    file_entry = {"genre": "Techno", "color": "#7C3AED", "country": "DE"}
    assert server.catalog_updates_for(stored, file_entry) == {"genre": "Techno", "country": "DE"}

    owner_genre = {**stored, "genre": "Hard Techno"}
    assert "genre" not in server.catalog_updates_for(owner_genre, file_entry)


def test_a_broken_stream_is_replaced_only_where_its_old_url_is_still_stored():
    scanner = {"key": "pro_tech_20", "url": "https://ice4.somafm.com/scanner-128-mp3", "genre": "Techno"}
    assert server.catalog_updates_for(scanner, {"genre": "Techno"})["url"] == "https://stream.technolovers.fm/dark-techno"

    owner_url = {**scanner, "url": "https://my.own/stream"}
    assert "url" not in server.catalog_updates_for(owner_url, {"genre": "Techno"})
