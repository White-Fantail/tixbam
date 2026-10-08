from crawler.parser import extract_events

def test_jsonld_event_parsing_and_deduplication():
    html = """
    <html><head><script type="application/ld+json">
    {"@graph":[
      {"@type":"MusicEvent","name":"Young K Live","performer":{"@type":"Person","name":"Young K"},
       "startDate":"2027-01-15T20:00:00+08:00",
       "location":{"name":"Arena","address":{"addressLocality":"Hong Kong","addressCountry":"HK"}},
       "url":"https://events.example/yk"},
      {"@type":"MusicEvent","name":"Young K Live","performer":{"name":"Young K"},"url":"https://events.example/yk"},
      {"@type":"Event","name":"No performer"}
    ]}
    </script></head></html>
    """
    records = extract_events(html, "https://events.example/list")
    assert len(records) == 1
    assert records[0]["artist"] == "Young K"
    assert records[0]["country"] == "HK"
    assert records[0]["source_url"] == "https://events.example/yk"

def test_non_jsonld_pages_do_not_create_fake_events():
    assert extract_events("<html><h1>Concert</h1></html>", "https://example.com") == []


def test_one_official_link_can_describe_multiple_show_dates():
    html = """
    <script type="application/ld+json">
    {"@graph":[
      {"@type":"MusicEvent","name":"Tour","performer":{"name":"Artist"},
       "startDate":"2026-12-02T18:00:00+09:00",
       "location":{"name":"KSPO","address":{"addressLocality":"Seoul","addressCountry":"KR"}},
       "url":"https://official.example/tour"},
      {"@type":"MusicEvent","name":"Tour","performer":{"name":"Artist"},
       "startDate":"2026-12-03T18:00:00+09:00",
       "location":{"name":"KSPO","address":{"addressLocality":"Seoul","addressCountry":"KR"}},
       "url":"https://official.example/tour"}
    ]}
    </script>
    """
    events = extract_events(html, "https://official.example/tour")
    assert len(events) == 2
    assert len({e["session_key"] for e in events}) == 2
    assert {e["source_url"] for e in events} == {"https://official.example/tour"}
