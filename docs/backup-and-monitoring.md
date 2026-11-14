# Backups, recovery and monitoring

## 1. What was verified locally (disposable MongoDB 7, synthetic data, 2026-11-14)
The scripts were exercised end to end on a throw-away database that the real API had populated (3 roles of users, a full pool
workflow, an Upwork lead, a saved workspace, a login-lockout record, a revoked session):
1. `scripts/backup/mongo-backup.sh`: wrote a compressed archive (about 7 KB for 28 documents); with `KEEP=2`, four backups left
   two archives; a bad URI exits 1, prints no URI and leaves no partial archive.
2. `scripts/backup/mongo-restore.sh`: refuses to restore over the source database without `CONFIRM_OVERWRITE=yes` (exit 2);
   by default restores into `<db>_restore_test`.
3. `scripts/backup/verify_restore.py` (new): compared **45 collections, 28 documents (content hashes) and 128 index
   definitions**, including unique and TTL indexes: all equal.
4. The API was then started **on the restored database** and signed in with the original passwords; the awarded contract and
   earnings, the workspace, the Upwork lead and the unique-index duplicate protection were all intact.
5. `scripts/backup/restore-drill.sh` (new): does 1-3 in one command in about 10 s on this data set and drops its scratch
   database. It found and fixed one real trap: `mongorestore` *adds* to an existing database, so a scratch database that is not
   empty makes the comparison fail; the drill now starts from an empty scratch database (only ever `<db>_restore_test`).

Not verified: anything against MongoDB Atlas (no account access), restore time on a production-sized database, and TTL
behaviour on a restore long after the backup (expired documents in TTL collections are removed by MongoDB on its own, so a few
may legitimately differ: sessions, login failures, notifications, activity, oauth state; `verify_restore.py` lists them).

Other health facilities: `/health` returns 200 `{"status":"ok","database":"ok"}` or 503 `degraded` when MongoDB is unreachable
(Render uses it as the health check); in production the API refuses to start without `MONGODB_URI`.

## 2. Recommended Atlas configuration (to be applied by the account owner)
Plan names, defaults and prices change: confirm each item in the Atlas console before relying on it.
* **Tier:** M10 or larger for production. Atlas's shared free/low tiers (M0/M2/M5) do not provide Cloud Backup with
  point-in-time recovery; do not launch real customers on them. Use a dedicated **staging** cluster/database as well.
* **Cloud Backup:** enabled, with these snapshot policies (a sensible starting point for this app): hourly snapshots every 6 h
  retained 2 days; daily retained 14 days; weekly retained 8 weeks; monthly retained 12 months.
* **Continuous Cloud Backup (point-in-time recovery):** enabled, restore window 7 days (so an accidental delete can be undone to
  the minute). Expect higher storage cost.
* **Copy snapshots to a second region** (and keep them in the same Atlas project that owns the cluster, with a *Backup
  Compliance Policy* if you want deletion protection against a compromised or mistaken admin).
* **Users:** one application user (`readWrite` on the `autopilot` database only) for Render; one separate **read-only** user for
  logical dumps; no human reuses the application user. Store passwords only in the platform dashboards/password manager.
* **Network access:** IP access list limited to Render's outbound addresses (or Render private networking if available); never
  leave `0.0.0.0/0` in production.
* **Encryption:** TLS is on by default; encryption at rest is on for M10+. Customer-managed keys are optional.
* **Alerts:** Atlas alerts for backup failure, replication lag, disk > 80%, connections > 80%, and failed logins, sent to a shared
  mailbox/Slack (not one person's inbox).
* **Secondary logical dumps (belt and braces):** a weekly `mongo-backup.sh` run from a scheduled job somewhere that has the
  MongoDB Database Tools (a small VM, a scheduled GitHub Action with the secret in GitHub Secrets, or a Render cron job with a
  Docker image), writing to storage in a *different account/region*. Use the read-only user.
* **Restore drills:** quarterly, and after any schema or major release: restore the latest snapshot **into a new, separate
  cluster** (never over production), point a staging API at it, sign in, and run `scripts/backup/verify_restore.py` or the manual
  checks. Record how long it took.

### Recovery targets (proposal, needs the owner's sign-off)
RPO: minutes with point-in-time recovery (24 h if only nightly dumps exist). RTO: 2 hours. These are targets until the first
real Atlas restore drill proves them.

## 3. Exactly what is needed to enable Atlas backups (needs you)
1. An Atlas account and a **Project Owner** (or Organization Owner) login for the project that holds, or will hold, the cluster.
   A database user cannot change backups or tiers.
2. Your decision on the tier and budget (M10+ is a paid cluster), and the regions for the cluster and the backup copy.
3. The Render service's outbound IP addresses (Render dashboard -> the service -> Connect/Outbound) for the IP access list.
4. Creating the two database users above and putting the connection strings **only** into Render (`MONGODB_URI`) and, for the
   dump job, into the scheduler's secret store.
5. An alert recipient address.
6. Then, in Atlas: Cluster -> Backup -> enable Cloud Backup and Continuous Cloud Backup, set the policy items above, add the
   snapshot copy region, and run the first restore drill into a new cluster. I cannot do any of these steps without access, and
   I will not connect to, read, or modify any production database.

## 4. Taking a backup and running a drill yourself
```bash
export MONGODB_URI='mongodb+srv://<read-only-user>:<password>@<cluster>/'   # never commit this
BACKUP_DIR=/var/backups/autopilot MONGODB_DB=autopilot scripts/backup/mongo-backup.sh
# drill on a COPY or a disposable database (it reads every document of the source):
MONGODB_DB=autopilot scripts/backup/restore-drill.sh
# no mongodump installed? use the Docker image:
MONGODUMP="docker run --rm --user $(id -u) --network host -v $PWD/backups:$PWD/backups mongo:7 mongodump" \
MONGORESTORE="docker run --rm --user $(id -u) --network host -v $PWD/backups:$PWD/backups mongo:7 mongorestore" \
BACKUP_DIR=$PWD/backups scripts/backup/restore-drill.sh
```
Restoring over production is an incident-only action: stop the API, then
`CONFIRM_OVERWRITE=yes scripts/backup/mongo-restore.sh <archive> autopilot`. It adds archived documents back (it does not drop
collections), so resolve conflicts first or restore into a new database and switch `MONGODB_DB`.

## 5. Monitoring (needs you)
1. **Uptime:** an external checker (UptimeRobot, Better Stack...) on `https://<api>/health` and the frontend home page every
   minute; alert on non-200 and responses over 10 s. Render's free plan sleeps after 15 idle minutes; use a paid plan.
2. **Errors:** set `SENTRY_DSN` (API) and `NEXT_PUBLIC_SENTRY_DSN` (frontend); alert rules for new issues and error-rate spikes.
3. **Logs:** Render keeps JSON request logs (`request completed`, status, duration, request id). Production startup logs one
   `production config:` warning per integration that is off.
4. **Secrets:** keep `SECRET_KEY`, Stripe and provider keys in the team password manager; rotating `SECRET_KEY` signs everyone out.
