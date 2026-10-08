"""Run one scheduled crawl pass using operator-approved sources from FastAPI."""
import ipaddress
import os
import socket
from datetime import datetime, timezone
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser
import httpx
from .parser import extract_events

API = os.environ.get("TIXBAM_API_URL", "http://127.0.0.1:8000").rstrip("/")
TOKEN = os.environ.get("TIXBAM_ADMIN_API_KEY", "")
AGENT = "TIXBAMCrawler/0.2 (+contact: operator)"

def check_public_https(url: str):
    parts = urlparse(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("Source must use a public HTTPS URL")
    # Do not allow scheduled requests into private networks.
    for item in socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM):
        ip = ipaddress.ip_address(item[4][0])
        if not ip.is_global:
            raise ValueError("Source resolves to a private or non-global address")
    return parts

def due(source):
    stamp = source.get("lastCheckedAt")
    if not stamp:
        return True
    previous = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    if previous.tzinfo is None:
        previous = previous.replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - previous).total_seconds()
    return age >= source["intervalMinutes"] * 60

def verify_robots(client, url):
    parts = urlparse(url)
    robots_url = parts.scheme + "://" + parts.netloc + "/robots.txt"
    response = client.get(robots_url)
    if response.status_code in (401, 403):
        raise PermissionError("robots.txt is not accessible")
    if response.status_code == 200:
        robots = RobotFileParser()
        robots.parse(response.text.splitlines())
        if not robots.can_fetch(AGENT, url):
            raise PermissionError("Crawling is disallowed by robots.txt")

def main():
    if not TOKEN:
        raise RuntimeError("TIXBAM_ADMIN_API_KEY must be set")
    headers = {"X-Admin-Key": TOKEN}
    with httpx.Client(timeout=15, follow_redirects=False,
                      headers={"User-Agent": AGENT}) as client:
        resp = client.get(API + "/v1/admin/sources", headers=headers)
        resp.raise_for_status()
        for source in resp.json()["items"]:
            if not source["enabled"] or not due(source):
                continue
            status, found, message = "success", 0, ""
            try:
                check_public_https(source["url"])
                verify_robots(client, source["url"])
                page = client.get(source["url"])
                page.raise_for_status()
                if page.is_redirect:
                    raise ValueError("Redirects require manual source review")
                if "html" not in page.headers.get("content-type", "").lower():
                    raise ValueError("Source did not return HTML")
                events = extract_events(page.text, source["url"])
                found = len(events)
                if events:
                    item = client.post(API + "/v1/admin/ingest",
                                       json={"source_id": source["id"], "events": events},
                                       headers=headers)
                    item.raise_for_status()
                message = "Structured events found: " + str(found)
            except Exception as exc:
                status, message = "failed", str(exc)[:500]
            finally:
                logged = client.post(API + "/v1/admin/crawl-runs",
                                     json={"source_id": source["id"], "status": status,
                                           "found": found, "message": message}, headers=headers)
                logged.raise_for_status()
            print(source["name"], status, message)

if __name__ == "__main__":
    main()
