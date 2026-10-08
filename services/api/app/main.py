from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .db import Base, SessionLocal, engine
from .seed import seed_providers
from .routes import router
from .admin import router as admin_router
from .ingest import router as ingest_router

@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_providers(db)
    yield

app = FastAPI(title="TIXBAM API", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])
app.include_router(router)
app.include_router(admin_router)
app.include_router(ingest_router)

@app.get("/healthz")
def health():
    return {"status": "ok", "service": "tixbam-api"}
