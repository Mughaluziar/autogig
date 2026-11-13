"""Capital program: investor pool, early payment and protection fund.

SIMULATED SETTLEMENT: the ledger records every movement, and no money moves
until a licensed settlement partner is integrated.

  policy.py    every limit, rate and fee split
  ledger.py    append-only double-entry journal, NAV and share math
  store.py     profiles, advances, protection cover, claims
  service.py   verification, underwriting, disbursement, repayment, claims,
               scheduled jobs and reconciliation

HTTP routes: app/routers/capital.py. Scheduled job: queue.scheduled_capital_jobs.
"""
