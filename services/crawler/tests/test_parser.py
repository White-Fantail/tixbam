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
