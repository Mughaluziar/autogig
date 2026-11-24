# CI: local checks and GitHub Actions on the integration branch

Status: GitHub remote exists. Prior `main` CI succeeded at `d075a33`. Manual dispatch on the published integration branch
at `5f26b18` created [run 45397936608](https://github.com/Mughaluziar/autogig/actions/runs/45397936608), but all three jobs
failed **before any step ran**. GitHub's annotation says recent account payments failed or the Actions spending limit needs
adjustment. The account owner must resolve this and rerun CI on the final commit; do not interpret this as a code-test failure.

## 1. What the workflow does (`.github/workflows/ci.yml`)
| Job | Runs on | Steps | Needs secrets? |
|---|---|---|---|
| `frontend` | every pull request and every push to `main`/`master` | Node 22, `npm ci`, `typecheck`, `lint`, `npm run qa` (gap check), `npm run test:deploy-guards`, `npm run build` | none |
| `backend` | same | Python 3.12, `pip install -r requirements-dev.txt`, `pytest` (in-memory storage) | none |
| `backend-mongo` | **pushes to `main`/`master` and manual runs only** | MongoDB 7 service container, `TEST_MONGODB_URI=mongodb://localhost:27017`, `pytest` | none |
Also: least-privilege `permissions: contents: read`, per-job `timeout-minutes`, and a concurrency group that cancels a superseded
run. **No repository secrets are required**: tests use throw-away services and never call a real provider (outbound HTTP is
blocked in the test setup). Do not add production secrets to this workflow.

The browser end-to-end suite (`scripts/qa/e2e.mjs`) is **not** in CI: it needs a running API, a real MongoDB, the built frontend,
a stand-in AI provider and Chromium, and was run locally. Adding it as a separate job is possible but is extra work.

## 2. Verified locally (replicating CI, 2026-11-14)
* From a clean export of the repository: `npm ci` (about 20 s), typecheck, lint (1 pre-existing warning), `npm run qa`,
  `npm run test:deploy-guards`, production build: all pass on the final tree.
* A fresh Python 3.12 virtualenv from `requirements-dev.txt`, then `pytest`: pass. The first attempt hung on a stalled package
  download (a network hiccup, not a code problem); a retry with `--default-timeout` installed cleanly.
* `actionlint` (via Docker) on the workflow: no findings.
* **A real defect found by this replication:** `npm run qa` failed because its escrow rule matched the corrected Terms
  ("not ... an escrow agent"). The first GitHub run would have gone red on the frontend job. Fixed.
* The `backend-mongo` job's suite takes about **45 minutes** locally (the test setup drops the database before every test).

## 3. GitHub account, plan and billing restrictions to check
* Check the current Actions allowance in GitHub billing before repeated manual runs. The Mongo job can take roughly 45 minutes
  because setup drops its disposable database before every test. Avoid unnecessary reruns.
* Check Settings -> Actions -> General: Actions enabled, and (organisation accounts) the workflow permissions policy allows read.
* Check Settings -> Billing: a spending limit of $0 stops runs when the free minutes are used up.
* Optional hardening: protect `main` (require the `frontend` and `backend` checks to pass, no force pushes); enable Dependabot
  alerts and security updates; pin third-party actions by commit SHA.

## 4. Run the published integration commit without deploying
1. Resolve GitHub's Actions payment/spending-limit block, then confirm `integration/autogig-fahim-readiness` points to the intended commit and Vercel/Render deployment settings remain safe.
2. Dispatch `CI` on that branch from GitHub Actions or run
   `gh workflow run ci.yml --ref integration/autogig-fahim-readiness`.
3. Check all three job results and their commit SHA with `gh run view <run-id>`; manual dispatch includes the Mongo job.
4. If a job fails, compare its log with section 5 and fix it on the integration branch. Do not merge or deploy until the
   exact release commit is green and staging acceptance passes.

## 5. Local equivalents (run before pushing)
```bash
npm ci && npm run typecheck && npm run lint && npm run qa && npm run test:deploy-guards && npm run build
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
pytest                                                    # in-memory
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 pytest         # real MongoDB (disposable instance; about 45 min)
```
Note: only `TEST_MONGODB_URI` switches the suite to MongoDB. Setting `MONGODB_URI` does nothing (the test setup overrides it),
which once made a memory-mode run look like a MongoDB run.
