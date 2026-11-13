"""Unified order detection, verification and tracking across marketplaces.

  models.py    canonical order signal, statuses, verification states
  adapters/    one adapter per platform (API, email parsing, limitations)
  service.py   ingestion, dedupe, verification, sync, retention, audit
  store.py     MongoDB / in-memory persistence

HTTP routes live in app/routers/orders.py; the scheduled job is
queue.scheduled_order_sync. See docs/platform-matrix.md for what each
platform supports and why.
"""
