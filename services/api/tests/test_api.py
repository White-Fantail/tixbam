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
            assert len(addons) == 6
            assert any(item["id"] == "cityline" for item in addons)
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
