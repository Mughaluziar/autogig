"""Treasury and financial reporting API (platform owners). SIMULATED: read-only views of the internal capital ledger;
nothing here moves money. See docs/treasury-reporting.md.

GET /api/treasury/overview                      balances by program, key figures, integrity checks
GET /api/treasury/report?start=&end=            period report: opening/closing by group, flows by kind, income, external
GET /api/treasury/journal.csv?start=&end=       every ledger line in the period (includes customer account ids)
Dates are inclusive YYYY-MM-DD in UTC, at most 366 days. Owner only; mounted behind the simulated-modules gate.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from .. import repo
from ..auth import require_owner
from ..capital import treasury

router = APIRouter(prefix="/treasury", tags=["treasury"], dependencies=[Depends(require_owner)])


def _period(start: str | None, end: str | None):
    try:
        return treasury.parse_period(start, end)
    except treasury.PeriodError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/overview")
async def overview():
    return await treasury.overview()


@router.get("/report")
async def report(start: str | None = Query(default=None, max_length=20), end: str | None = Query(default=None, max_length=20)):
    first, last = _period(start, end)
    return await treasury.report(first, last)


@router.get("/journal.csv")
async def journal_csv(start: str | None = Query(default=None, max_length=20), end: str | None = Query(default=None, max_length=20),
                      owner: dict = Depends(require_owner)):
    """The owner's full export: unlike the overview and report, rows name customer accounts (wallet:<user id>…), so
    every download is written to the owner's activity log."""
    first, last = _period(start, end)
    try:
        body = await treasury.journal_csv(first, last)
    except treasury.ExportTooLarge as exc:
        raise HTTPException(413, str(exc)) from None
    await repo.log_activity(owner["id"], "Treasury", f"Exported the simulated ledger journal for {first} to {last}")
    return Response(content=body, media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="treasury-journal-{first}-to-{last}.csv"',
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
