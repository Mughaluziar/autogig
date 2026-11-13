"""Invoice pay links: clients pay an invoice or a milestone by card or crypto.

The freelancer's invoices live in their workspace ledger (frontend). Getting
a pay link stores a server-side snapshot of the invoice (amounts, milestones,
accepted methods) behind an unguessable token. The public pay page reads that
snapshot, and checkout always charges the stored amount through Stripe
Checkout. Stripe's signed webhook marks a milestone paid; the dashboard picks
the paid status up from GET /api/pay-links. See docs/payments.md.
"""
