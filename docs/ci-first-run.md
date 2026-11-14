# CI: what exists, what was verified locally, and the exact steps for the first GitHub Actions run

Status: **the workflow has never run on GitHub.** There is no git remote configured and nothing has been pushed. Everything
below that needs GitHub is a step for you; I will not push or trigger a workflow without your approval.

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
* Public repositories get free Actions minutes. **Private repositories on the Free plan get a monthly allowance of Linux
  minutes (2,000 at the time of writing; confirm on your plan page).** The frontend and backend jobs take roughly 3-5 minutes
  each; the Mongo job about 45 minutes, which is why it only runs on pushes to `main` and manual runs. At about 50 minutes per
  push to `main` the free allowance supports on the order of 30-40 such pushes a month. Options: keep it as is, run it only
  nightly/weekly, speed up the test setup (drop collections instead of the database), or use a paid plan/self-hosted runner.
* Check Settings -> Actions -> General: Actions enabled, and (organisation accounts) the workflow permissions policy allows read.
* Check Settings -> Billing: a spending limit of $0 stops runs when the free minutes are used up.
* Optional hardening: protect `main` (require the `frontend` and `backend` checks to pass, no force pushes); enable Dependabot
  alerts and security updates; pin third-party actions by commit SHA.

## 4. Exact steps for the first run (needs you; nothing is pushed yet)
1. Create an empty **private** repository on GitHub (no README/license so the histories do not conflict).
2. In this project directory: `git remote add origin git@github.com:<you>/<repo>.git`. The history to publish is `main`
   including the tag `baseline-as-received` (`git push origin main --tags`). **Do this only when you approve it.**
3. Open the Actions tab. The push to `main` triggers `frontend`, `backend` and `backend-mongo`. Expect green for the first two in
   a few minutes and for `backend-mongo` after roughly 45 minutes.
4. To see the pull-request behaviour (the Mongo job is skipped): push a branch with a trivial change and open a PR to `main`.
5. If a job fails, open it and compare with the local commands in section 5; the usual causes are a different Node/Python
   patch version, a stalled package download (re-run the job), or a test that depends on the clock or a shared port.
6. Once green, enable branch protection (section 3), then deploy only from a commit that is green.

## 5. Local equivalents (run before pushing)
```bash
npm ci && npm run typecheck && npm run lint && npm run qa && npm run test:deploy-guards && npm run build
cd backend && python -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
pytest                                                    # in-memory
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 pytest         # real MongoDB (disposable instance; about 45 min)
```
Note: only `TEST_MONGODB_URI` switches the suite to MongoDB. Setting `MONGODB_URI` does nothing (the test setup overrides it),
which once made a memory-mode run look like a MongoDB run.
