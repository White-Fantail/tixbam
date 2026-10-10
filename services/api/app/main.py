from contextlib import asynccontextmanager
from pathlib import Path
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .db import Base, SessionLocal, engine
from .seed import seed_providers
from .migrations import migrate_schedule_columns, migrate_purchase_guards
from .routes import router
from .admin import router as admin_router
from .admin_directory import router as directory_router
from .ingest import router as ingest_router
from .accounts import router as account_router, purge_development_accounts
from .oauth import router as oauth_router
from .booking_plans import router as booking_plan_router, migrate_watch_items_to_plans
from .ai import router as ai_router, admin_router as ai_admin_router
from .ai_planner import router as ai_planner_router
from .automation_policies import router as automation_router, admin_router as automation_admin_router
from .provider_verification import router as verification_admin_router
from .booking_leases import router as booking_lease_router

# Local monorepo execution (cd services/api && uvicorn app.main:app) still works.
# Docker installs this module into /app/tixbam_mcp instead.
local_mcp = Path(__file__).resolve().parents[2] / "mcp"
if local_mcp.is_dir() and str(local_mcp) not in sys.path:
    sys.path.insert(0, str(local_mcp))

# Optional MCP integration: unconfigured installations have no MCP route.
# The module lives in services/mcp but runs in this same ASGI process.
from tixbam_mcp.auth import MCPConfig
from tixbam_mcp.server import build_mcp

mcp_config = MCPConfig.from_env()
mcp_server, mcp_asgi_app = build_mcp(mcp_config) if mcp_config else (None, None)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_schedule_columns(engine)
    migrate_purchase_guards(engine)
    with SessionLocal() as db:
        purge_development_accounts(db)
        migrate_watch_items_to_plans(db)
        seed_providers(db)
    if mcp_server:
        # Mounted ASGI apps do not run their own lifespan; the parent must run
        # the MCP session manager or the first tool invocation will fail.
        async with mcp_server.session_manager.run():
            yield
    else:
        yield


app = FastAPI(title="TIXBAM API", version="0.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])
app.include_router(router)
app.include_router(admin_router)
app.include_router(directory_router)
app.include_router(ingest_router)
app.include_router(account_router)
app.include_router(booking_plan_router)
app.include_router(oauth_router)
app.include_router(ai_router)
app.include_router(ai_planner_router)
app.include_router(ai_admin_router)
app.include_router(automation_router)
app.include_router(automation_admin_router)
app.include_router(verification_admin_router)
app.include_router(booking_lease_router)


@app.get("/healthz")
def health():
    return {"status": "ok", "service": "tixbam-api"}


if mcp_asgi_app is not None:
    # Catch-all mount MUST follow the FastAPI routes. MCP itself exposes /mcp
    # and /.well-known/oauth-protected-resource on the existing hostname.
    app.mount("/", mcp_asgi_app)
