import json
from pathlib import Path
from sqlalchemy.orm import Session
from .models import Provider


def seed_providers(db: Session):
    catalog = Path(__file__).resolve().parent.parent / "seed" / "catalog.json"
    for item in json.loads(catalog.read_text(encoding="utf-8")):
        if db.get(Provider, item["id"]) is None:
            db.add(Provider(
                id=item["id"], name=item["name"], region=item["region"], country=item["country"],
                url=item["url"], allowed_hosts=item["allowedHosts"], automation=item["automation"],
                capabilities=item["capabilities"], version=item["version"],description=item["description"]
            ))
    db.commit()
