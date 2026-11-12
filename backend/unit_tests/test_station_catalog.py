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


def test_325_corrections_only_where_the_old_value_is_still_stored():
    stored = {"key": "pro_tech_16", "name": "Deep Underground", "genre": "Techno", "color": "#7C3AED", "url": "https://x"}
    updates = server.catalog_updates_for(stored, {"genre": "House", "color": "#06B6D4"})
    assert updates == {"name": "Deep Tech House", "genre": "House", "color": "#06B6D4"}

    owner_name = {**stored, "name": "Vereins-Techno"}
    assert "name" not in server.catalog_updates_for(owner_name, {"genre": "House"})

    reggae = {"key": "reggaeradio", "url": "http://streams.bigfm.de/bigfm-reggaevibes-128-mp3", "country": "DE", "genre": "Reggae & Dancehall"}
    assert server.catalog_updates_for(reggae, {"genre": "Reggae & Dancehall"})["url"] == "https://l.rootslegacy.fr/;"


def test_325_the_duplicates_get_a_stream_that_matches_their_name():
    drill = {"key": "pro_urban_04", "name": "Drill Beats", "url": "http://streams.bigfm.de/bigfm-rapfeature-128-mp3?usid=0-0-H-M-D-60", "language": "de", "genre": "Hip Hop & Rap"}
    updates = server.catalog_updates_for(drill, {"genre": "Hip Hop & Rap"})
    assert updates["url"] == "https://stream.laut.fm/drill"
    assert updates["language"] == ""

    owner_stream = {**drill, "url": "https://my.own/drill"}
    assert "url" not in server.catalog_updates_for(owner_stream, {"genre": "Hip Hop & Rap"})


def test_549_rows_apply_like_the_node_side_and_only_on_the_old_url():
    # Same list as src/station-catalog-migrations.json: a replaced SomaFM station.
    soma = {"key": "groovesalad", "url": "https://ice4.somafm.com/groovesalad-128-mp3", "name": "Groove Salad",
            "logo": "https://api.somafm.com/logos/512/groovesalad512.png", "genre": "Ambient"}
    updates = server.catalog_updates_for(soma, {"genre": "Ambient"})
    assert updates["url"] == "https://stream.epic-lounge.com/chillout-lounge"
    assert updates["name"] == "Chillout Lounge" and updates["country"] == "DE"
    assert server.catalog_unsets_for(soma) == ["logo"]

    # The sanitized key MongoDB stores matches too; only the URL changes for an https move.
    bigfm = {"key": "proedm02", "url": "http://streams.bigfm.de/nitrox-128-mp3", "genre": "EDM & Festival"}
    assert server.catalog_updates_for(bigfm, {"genre": "EDM & Festival"}) == {"url": "https://streams.bigfm.de/nitrox-128-mp3"}
    assert server.catalog_unsets_for(bigfm) == []

    # An operator's own URL stays, with every field.
    own = {**soma, "url": "https://my.own/stream"}
    assert server.catalog_updates_for(own, {"genre": "Ambient"}) == {}
    assert server.catalog_unsets_for(own) == []


def test_the_reggae_country_follows_only_together_with_its_url():
    reggae = {"key": "reggaeradio", "url": "http://streams.bigfm.de/bigfm-reggaevibes-128-mp3", "country": "DE", "genre": "Reggae & Dancehall"}
    assert server.catalog_updates_for(reggae, {"genre": "Reggae & Dancehall"}) == {"url": "https://l.rootslegacy.fr/;", "country": "FR"}

    soma_reggae = {**reggae, "url": "https://ice1.somafm.com/reggae-128-mp3", "country": "US"}
    updates = server.catalog_updates_for(soma_reggae, {"genre": "Reggae & Dancehall"})
    assert updates["url"] == "https://l.rootslegacy.fr/;" and updates["country"] == "FR"

    own = {**reggae, "url": "https://my.reggae/stream"}
    assert server.catalog_updates_for(own, {"genre": "Reggae & Dancehall"}) == {}
