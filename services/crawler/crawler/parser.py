"""Extract genuine structured Event records; no anti-bot or checkout automation."""
import hashlib
import json
from bs4 import BeautifulSoup

def walk(value):
    if isinstance(value, list):
        for child in value:
            yield from walk(child)
    elif isinstance(value, dict):
        if "@graph" in value:
            yield from walk(value["@graph"])
        yield value

def extract_events(html: str, page_url: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    result = []
    seen = set()
    for element in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(element.string or element.get_text())
        except (ValueError, TypeError):
            continue
        for event in walk(data):
            types = event.get("@type", [])
            types = [types] if isinstance(types, str) else types
            if not isinstance(types, list) or not set(types).intersection({"Event", "MusicEvent"}):
                continue
            performer = event.get("performer") or event.get("byArtist")
            if isinstance(performer, list):
                performer = performer[0] if performer else None
            artist = performer.get("name", "") if isinstance(performer, dict) else performer
            title = event.get("name")
            if not isinstance(artist, str) or not artist.strip() or not isinstance(title, str) or not title.strip():
                continue
            date = event.get("startDate")
            location = event.get("location", {})
            location = location[0] if isinstance(location, list) and location else location
            location = location if isinstance(location, dict) else {}
            address = location.get("address", {})
            address = address if isinstance(address, dict) else {}
            url = event.get("url")
            if not isinstance(url, str) or not url.startswith("https://"):
                digest = hashlib.sha256((title + str(date)).encode()).hexdigest()[:16]
                url = page_url.split("#")[0] + "#event-" + digest
            if url in seen:
                continue
            seen.add(url)
            result.append({"artist": artist.strip(), "title": title.strip(),
                           "city": str(address.get("addressLocality") or ""),
                           "country": str(address.get("addressCountry") or ""),
                           "venue": location.get("name"),
                           "starts_at": date if isinstance(date, str) else None,
                           "source_url": url})
    return result
