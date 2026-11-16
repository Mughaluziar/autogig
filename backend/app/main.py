"""Autopilot — Autonomous AI Agency & Career Ecosystem backend.

FastAPI application entry point. User accounts and per-user data persist in
MongoDB when MONGODB_URI is set (see db.py, repo.py); otherwise in memory.
Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""
import asyncio
import logging
import json
import time
import uuid
from contextvars import ContextVar

import sentry_sdk
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db, ratelimit, repo, rights_store
from . import integrations
from . import oauth
from .auth import current_user, require_roles
from .modules_gate import require_simulated_access
from .config import get_settings
from .routers import (
    activity, admin, agents, auth, automation, billing, core, demo, freelancer, growth,
    capital, operations, orders, pipeline, portal, public, radar, revenue, studio, system, token, workspace,
    inbox, payments, pool, upwork, upwork_leads, me, credit,
)
from .capital import ledger as capital_ledger, store as capital_store
from .orders import store as order_store
from .payments import store as payments_store, subscriptions as subscriptions_store
from .access import store as access_store
from .pool import store as pool_store
from .routers import api_keys as api_keys_router, team as team_router
from .routers import fleet as fleet_router
from . import session as session_store
from .edge import EdgeProofMiddleware
from .security import ApiKeyMiddleware, OriginMiddleware, RateLimitMiddleware, SecurityHeadersMiddleware
from .store import init_store

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", request_id_var.get()),
        }
        for key in ("method", "path", "status_code", "duration_ms"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"))


handler = logging.StreamHandler()
handler.setFormatter(JsonLogFormatter())
logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
log = logging.getLogger("autopilot")

settings = get_settings()
settings.validate_for_production()
if settings.environment == "production":
    for _warning in settings.production_warnings():
        logging.getLogger("autopilot").warning("production config: %s", _warning)
if settings.sentry_dsn:
    from .privacy import scrub_event
    # Errors only: no request bodies, cookies, headers, user or query strings (see app/privacy.py).
    sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.environment, traces_sample_rate=0.05,
                    send_default_pii=False, max_request_body_size="never", include_local_variables=False,
                    before_send=scrub_event)

app = FastAPI(
    title="Autopilot Agency API",
    version="0.3.0",
    description="Backend for the Autonomous AI Agency & Career Ecosystem (MongoDB-persisted).",
)


@app.middleware("http")
async def request_logging(request: Request, call_next):
    supplied_id = request.headers.get("X-Request-ID", "")
    request_id = supplied_id[:128] if supplied_id and all(c.isalnum() or c in "-_." for c in supplied_id[:128]) else uuid.uuid4().hex
    token = request_id_var.set(request_id)
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        sentry_sdk.capture_exception()
        log.exception("request failed", extra={"request_id": request_id})
        response = JSONResponse(status_code=500, content={"detail": "Internal server error", "request_id": request_id})
    response.headers["X-Request-ID"] = request_id
    log.info("request completed", extra={"request_id": request_id, "method": request.method,
                                          "path": request.url.path, "status_code": response.status_code,
                                          "duration_ms": round((time.monotonic() - started) * 1000, 2)})
    request_id_var.reset(token)
    return response

# Security middleware (applied outermost → innermost in reverse order)
app.add_middleware(ApiKeyMiddleware)
app.add_middleware(OriginMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(EdgeProofMiddleware)   # outside the rate limiter so client_ip() sees the verified edge address
app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    # In-memory catalog + demo data (plans, and the demo-only routers below).
    # Never persisted — real user data lives in repo.py's collections.
    init_store()
    if db.enabled():
        try:
            await db._get_db().command("ping")
        except Exception:
            # Production must not come up half-working against a dead database.
            log.exception("MongoDB is not reachable at startup")
            if settings.environment == "production":
                raise RuntimeError("MongoDB is not reachable; refusing to start in production.")
        await repo.ensure_indexes()
        await order_store.ensure_indexes()
        await capital_store.ensure_indexes()
        await capital_ledger.ensure_indexes()
        await payments_store.ensure_indexes()
        await subscriptions_store.ensure_indexes()
        await oauth.ensure_indexes()
        await session_store.ensure_indexes()
        await pool_store.ensure_indexes()
        await access_store.ensure_indexes()
        await rights_store.ensure_indexes()
        await ratelimit.ensure_indexes()
        await repo.archive_legacy_state()
        log.info("MongoDB connected")
    else:
        log.warning("MONGODB_URI not set — accounts and data are kept in memory only")
    if settings.deletion_runner and settings.environment != "test":
        app.state.housekeeping = asyncio.create_task(me.housekeeping_loop())
    if settings.credit_jobs_runner and settings.environment != "test":
        from .credit import service as credit_service
        app.state.credit_jobs = asyncio.create_task(credit_service.scheduler_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    for name in ("housekeeping", "credit_jobs"):
        task = getattr(app.state, name, None)
        if task:
            task.cancel()


@app.get("/health")
async def health() -> dict:
    database = "in-memory"
    if db.enabled():
        try:
            await db._get_db().command("ping")
            database = "ok"
        except Exception:
            log.exception("health check: MongoDB ping failed")
            return JSONResponse(status_code=503, content={
                "status": "degraded", "environment": settings.environment,
                "version": "0.3.0", "database": "unavailable",
            })
    return {
        "status": "ok",
        "environment": settings.environment,
        "version": "0.3.0",
        "database": database,
    }


# Public — no session needed (login/signup, pricing, beta signup). /auth/me
# guards itself.
for r in (public.router, auth.router):
    app.include_router(r, prefix=settings.api_prefix)

# Per-user data for every signed-in role — each route scopes to the caller.
for r in (workspace.router, billing.router, activity.router):
    app.include_router(r, prefix=settings.api_prefix, dependencies=[Depends(current_user)])
app.include_router(radar.router, prefix=settings.api_prefix, dependencies=[Depends(current_user)])
app.include_router(inbox.router, prefix=settings.api_prefix)
# Per-user routes guard themselves; the provider webhook authenticates by signature.
app.include_router(orders.router, prefix=settings.api_prefix)
# Any signed-in role; investing and early payment are gated by verification.
app.include_router(capital.router, prefix=settings.api_prefix, dependencies=[Depends(require_simulated_access)])
# Investment marketplace and banking (simulated settlement, same ledger as capital).
from .routers import banking as banking_routes, marketplace as marketplace_routes  # noqa: E402
app.include_router(marketplace_routes.router, prefix=settings.api_prefix, dependencies=[Depends(require_simulated_access)])
app.include_router(banking_routes.router, prefix=settings.api_prefix, dependencies=[Depends(require_simulated_access)])
# Token program: the transparency report is public (no personal data); the
# rest needs a session, and admin routes check for a platform owner.
app.include_router(credit.router, prefix=settings.api_prefix, dependencies=[Depends(require_simulated_access)])
app.include_router(token.public_router, prefix=settings.api_prefix)
app.include_router(token.router, prefix=settings.api_prefix, dependencies=[Depends(require_simulated_access)])
app.include_router(integrations.router, prefix=settings.api_prefix,
                   dependencies=[Depends(current_user)])
# Invoice pay links: the pay page and Stripe webhook are public (the link
# token and Stripe's signature authenticate them); managing links needs a session.
app.include_router(payments.public_router, prefix=settings.api_prefix)
app.include_router(payments.router, prefix=settings.api_prefix, dependencies=[Depends(current_user)])
# Upwork job leads from the user's own alert emails (human-in-the-loop: no
# Upwork API, no login, no submission). Any signed-in role; rows are per-user.
app.include_router(upwork_leads.router, prefix=settings.api_prefix, dependencies=[Depends(current_user)])
# Freelancer pool: specs, blind bids, contracts, earnings. Role checks are per route (agency vs freelancer).
app.include_router(pool.router, prefix=settings.api_prefix, dependencies=[Depends(current_user)])
# Agent Fleet Copilot: interprets free-form commands; the browser runs them.
app.include_router(fleet_router.router, prefix=settings.api_prefix, dependencies=[Depends(current_user)])
# Team & invites and personal API keys: the invite preview is public (the
# link token authorises it); everything else needs a session.
app.include_router(team_router.public_router, prefix=settings.api_prefix)
app.include_router(team_router.router, prefix=settings.api_prefix, dependencies=[Depends(current_user)])
app.include_router(me.public_router, prefix=settings.api_prefix)
app.include_router(me.router, prefix=settings.api_prefix, dependencies=[Depends(current_user)])
app.include_router(api_keys_router.router, prefix=settings.api_prefix, dependencies=[Depends(current_user)])

# Agency dashboard — admin accounts only.
for r in (studio.router, growth.router, freelancer.router, upwork.router,
          automation.router):
    app.include_router(r, prefix=settings.api_prefix, dependencies=[Depends(require_roles("admin"))])

# Demo-data features (agents, arbitrage, QA, contracts, portals…) read one
# shared in-memory store, so they're only served when SEED_DEMO_DATA=true —
# never alongside real users' data. The frontend shows them as "Coming soon".
if settings.seed_demo_data:
    for r in (core.router, agents.router, pipeline.router):
        app.include_router(r, prefix=settings.api_prefix, dependencies=[Depends(require_roles("admin"))])
    for r in (operations.router, revenue.router, system.router, portal.router, admin.router, demo.router):
        app.include_router(r, prefix=settings.api_prefix, dependencies=[Depends(current_user)])
