import os
from pathlib import Path
from tempfile import TemporaryDirectory
from fastapi.testclient import TestClient

def test_api_end_to_end():
    with TemporaryDirectory() as tmp:
        os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(tmp) / "test.db")
        os.environ["TIXBAM_ADMIN_API_KEY"] = "test-only-private-key"
        from app.main import app
        with TestClient(app) as client:
            assert client.get("/healthz").json()["status"] == "ok"
            addons = client.get("/v1/addons").json()["items"]
            assert len(addons) == 7
            assert any(item["id"] == "cityline" for item in addons)
            assert any(item["id"] == "livenation" and item["kind"] == "event-presale" for item in addons)
            assert client.post("/v1/admin/artists", json={"name":"DAY6"}).status_code == 401
            headers = {"X-Admin-Key": "test-only-private-key"}
            artist = client.post("/v1/admin/artists", headers=headers,
                                 json={"name":"DAY6","country":"KR"})
            assert artist.status_code == 201
            artist_id = artist.json()["id"]
            event = client.post("/v1/admin/events", headers=headers,
                                json={"artist_id": artist_id, "title":"Example Concert", "city":"Hong Kong"})
            assert event.status_code == 201
            event_id = event.json()["id"]
            sale = client.post("/v1/admin/sales", headers=headers,
                               json={"event_id":event_id, "provider_id":"cityline",
                                     "booking_url":"https://www.cityline.com.hk/en_US/"})
            assert sale.status_code == 201
            events = client.get("/v1/events").json()["items"]
            assert len(events) == 1 and events[0]["artist"] == "DAY6"
            assert events[0]["sales"][0]["providerId"] == "cityline"
            source = client.post("/v1/admin/sources", headers=headers,
                                 json={"name":"Verified schedule", "url":"https://example.com/events"})
            assert source.status_code == 201
            source_id = source.json()["id"]
            found = {"source_id":source_id, "events":[
              {"artist":"Young K", "title":"Sample Event", "source_url":"https://example.com/sample"}
            ]}
            first = client.post("/v1/admin/ingest", headers=headers, json=found)
            second = client.post("/v1/admin/ingest", headers=headers, json=found)
            assert first.json()["created"] == 1
            assert second.json()["updated"] == 1
            assert len(client.get("/v1/artists").json()["items"]) == 2
            assert len(client.get("/v1/events").json()["items"]) == 2
            assert client.post("/v1/admin/sales", headers=headers,
                               json={"event_id":event_id, "provider_id":"cityline",
                                     "booking_url":"http://unsafe.example"}).status_code == 422
            verify_admin_updates(client, headers)
            verify_performance_workflows(client, headers, artist_id, source_id)

def verify_admin_updates(client, headers):
    artist = client.post("/v1/admin/artists", headers=headers, json={"name": "Schedules Test"}).json()
    aid = artist["id"]
    assert client.put(f"/v1/admin/artists/{aid}", json={"name": "Edited Schedules"}).status_code == 401
    changed_artist = client.put(f"/v1/admin/artists/{aid}", headers=headers, json={"name": "Edited Schedules", "country": "KR"})
    assert changed_artist.status_code == 200
    assert changed_artist.json()["name"] == "Edited Schedules"
    assert client.put("/v1/admin/artists/missing", headers=headers, json={"name": "Other"}).status_code == 404
    event = client.post("/v1/admin/events", headers=headers, json={
        "artist_id": aid, "title": "Hong Kong Show", "city": "Hong Kong", "country": "HK",
        "timezone": "Asia/Hong_Kong", "starts_at_local": "2027-01-15T20:00"})
    assert event.status_code == 201, event.text
    eid = event.json()["id"]
    assert event.json()["startsAt"] == "2027-01-15T12:00:00Z"
    assert event.json()["timezone"] == "Asia/Hong_Kong"
    updated_event = client.put(f"/v1/admin/events/{eid}", headers=headers, json={
        "artist_id": aid, "title": "HK Encore", "city": "Hong Kong", "country": "HK",
        "timezone": "Asia/Hong_Kong", "starts_at_local": "2027-01-16T20:00"})
    assert updated_event.status_code == 200, updated_event.text
    assert updated_event.json()["startsAt"] == "2027-01-16T12:00:00Z"
    assert client.put("/v1/admin/events/missing", headers=headers, json={"artist_id": aid, "title": "Missing"}).status_code == 404
    sale = client.post("/v1/admin/sales", headers=headers, json={
        "event_id": eid, "provider_id": "cityline", "sale_type": "presale",
        "city": "Seoul", "country": "KR", "timezone": "Asia/Seoul",
        "sale_at_local": "2027-01-05T12:00", "booking_url": "https://www.cityline.com.hk/en_US/"})
    assert sale.status_code == 201, sale.text
    sid = sale.json()["id"]
    assert sale.json()["saleAt"] == "2027-01-05T03:00:00Z"
    assert sale.json()["city"] == "Seoul"
    changed_sale = client.put(f"/v1/admin/sales/{sid}", headers=headers, json={
        "event_id": eid, "provider_id": "cityline", "sale_type": "general",
        "city": "Hong Kong", "country": "HK", "timezone": "Asia/Hong_Kong",
        "sale_at_local": "2027-01-06T10:00", "booking_url": "https://www.cityline.com.hk/en_US/"})
    assert changed_sale.status_code == 200, changed_sale.text
    assert changed_sale.json()["saleAt"] == "2027-01-06T02:00:00Z"
    assert client.put("/v1/admin/sales/missing", headers=headers, json={
        "event_id": eid, "provider_id": "cityline", "booking_url": "https://www.cityline.com.hk/"}).status_code == 404
    assert client.post("/v1/admin/events", headers=headers, json={
        "artist_id": aid, "title": "DST invalid", "timezone": "America/New_York",
        "starts_at_local": "2027-03-14T02:30"}).status_code == 422
    assert client.post("/v1/admin/sales", headers=headers, json={
        "event_id": eid, "provider_id": "cityline", "timezone": "Invalid/Zone",
        "sale_at_local": "2027-01-06T10:00", "booking_url": "https://www.cityline.com.hk/"}).status_code == 422


def verify_performance_workflows(client, headers, artist_id, source_id):
    event = client.post("/v1/admin/events", headers=headers, json={
        "artist_id": artist_id, "title": "Multi-session tour", "city": "Tokyo",
        "country": "JP", "venue": "Tokyo Dome", "timezone": "Asia/Tokyo",
        "source_url": "https://official.example/tour/tokyo",
        "starts_at_local": "2026-11-07T17:00",
    })
    assert event.status_code == 201, event.text
    event_id = event.json()["id"]
    default = event.json()["performances"][0]
    assert default["startsAt"] == "2026-11-07T08:00:00Z"
    assert default["sessionKey"] == "default"
    assert default["eventId"] == event_id

    second = client.post("/v1/admin/performances", headers=headers, json={
        "event_id": event_id, "session_key": "2026-11-07-20:00", "label": "Late show",
        "starts_at_local": "2026-11-07T20:00", "timezone": "Asia/Tokyo"
    })
    assert second.status_code == 201, second.text
    second_id = second.json()["id"]
    assert second.json()["startsAt"] == "2026-11-07T11:00:00Z"
    assert len(client.get(f"/v1/events/{event_id}/performances").json()["items"]) == 2
    assert len(client.get(f"/v1/events/{event_id}").json()["performances"]) == 2

    duplicate = client.post("/v1/admin/performances", headers=headers, json={
        "event_id": event_id, "session_key": "another-key",
        "starts_at_local": "2026-11-07T20:00", "timezone": "Asia/Tokyo"
    })
    assert duplicate.status_code == 409
    dst = client.post("/v1/admin/performances", headers=headers, json={
        "event_id": event_id, "session_key": "dst-test",
        "starts_at_local": "2027-11-07T01:30", "timezone": "America/New_York"
    })
    assert dst.status_code == 422

    other_event = client.post("/v1/admin/events", headers=headers, json={
        "artist_id": artist_id, "title": "Multi-session tour", "city": "Osaka",
        "country": "JP", "venue": "Osaka Dome", "timezone": "Asia/Tokyo",
        "source_url": "https://official.example/tour/tokyo",
    })
    assert other_event.status_code == 201, other_event.text
    foreign_id = other_event.json()["performances"][0]["id"]

    bad_scope = client.post("/v1/admin/sales", headers=headers, json={
        "event_id": event_id, "provider_id": "cityline",
        "booking_url": "https://www.cityline.com.hk/",
        "applies_to_all": False, "performance_ids": [foreign_id]
    })
    assert bad_scope.status_code == 409
    sale = client.post("/v1/admin/sales", headers=headers, json={
        "event_id": event_id, "provider_id": "cityline",
        "booking_url": "https://www.cityline.com.hk/",
        "applies_to_all": False, "performance_ids": [second_id],
        "sale_at_local": "2026-10-10T13:00", "timezone": "Asia/Hong_Kong",
    })
    assert sale.status_code == 201, sale.text
    assert sale.json()["performanceIds"] == [second_id]
    assert not sale.json()["appliesToAll"]
    sid = sale.json()["id"]

    changed = client.put(f"/v1/admin/performances/{second_id}", headers=headers, json={
        "event_id": event_id, "session_key": "2026-11-07-20:00",
        "label": "Updated second show", "status": "postponed",
        "starts_at_local": "2026-11-07T21:00", "timezone": "Asia/Tokyo",
    })
    assert changed.status_code == 200, changed.text
    assert changed.json()["status"] == "postponed"
    assert changed.json()["startsAt"] == "2026-11-07T12:00:00Z"
    assert client.delete(f"/v1/admin/performances/{second_id}", headers=headers).status_code == 409

    widened = client.put(f"/v1/admin/sales/{sid}", headers=headers, json={
        "event_id": event_id, "provider_id": "cityline",
        "booking_url": "https://www.cityline.com.hk/",
        "applies_to_all": True, "performance_ids": []
    })
    assert widened.status_code == 200, widened.text
    assert widened.json()["performanceIds"] == []
    assert client.delete(f"/v1/admin/performances/{second_id}", headers=headers).status_code == 200
    assert client.delete(f"/v1/admin/performances/{default['id']}", headers=headers).status_code == 409

    # Same announcement, many distinct sessions; repeated ingest is idempotent.
    feed = {"source_id": source_id, "events": [
        {"artist": "DAY6", "title": "Shared announcement tour", "city": "Seoul",
         "country": "KR", "venue": "KSPO", "source_url": "https://official.example/tour",
         "starts_at": "2026-12-02T18:00:00+09:00"},
        {"artist": "DAY6", "title": "Shared announcement tour", "city": "Seoul",
         "country": "KR", "venue": "KSPO", "source_url": "https://official.example/tour",
         "starts_at": "2026-12-03T18:00:00+09:00"},
    ]}
    first = client.post("/v1/admin/ingest", headers=headers, json=feed)
    again = client.post("/v1/admin/ingest", headers=headers, json=feed)
    assert first.status_code == 200, first.text
    assert first.json()["performancesCreated"] == 2
    assert again.json()["performancesCreated"] == 0
    grouped = [e for e in client.get("/v1/events").json()["items"] if e["title"] == "Shared announcement tour"]
    assert len(grouped) == 1 and len(grouped[0]["performances"]) == 2
