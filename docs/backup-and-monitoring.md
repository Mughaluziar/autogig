# Backups, recovery and monitoring

## What exists in the repo (verified 2026-11-13)
- `scripts/backup/mongo-backup.sh`: compressed logical dump (`mongodump --gzip --archive`), retention via `KEEP` (default 14). Tested against a throwaway MongoDB 7: three runs with `KEEP=2` left two archives.
- `scripts/backup/mongo-restore.sh`: restores into `<db>_restore_test` by default and refuses to restore over the live database unless `CONFIRM_OVERWRITE=yes`. Tested: the restored user count matched the source.
- `/health` returns 200 `{"status":"ok","database":"ok"}`, or 503 `degraded` when MongoDB is unreachable. Render uses it as the health check.
- Sentry is wired on the frontend and backend and reports once DSNs are set.
- In production the API refuses to start without `MONGODB_URI` (or the explicit `ALLOW_IN_MEMORY_DB=true`) and pings MongoDB at startup.

## What still has to be done by the account owner (cannot be done from code)
1. **Turn on MongoDB Atlas backups.** Atlas M0 (free) has none: use M10 or larger and enable Cloud Backup with point-in-time recovery, or schedule `mongo-backup.sh` somewhere that has the MongoDB Database Tools (a small VM, GitHub Actions on a schedule, or a Render cron job with a Docker image). Store archives in a different account or region from the database.
2. **Run a restore drill** (below) once, and again after any schema change, and write down how long it took.
3. **Uptime monitoring.** Point an external checker (UptimeRobot, Better Stack, etc.) at `https://<api>/health` every minute, and at the frontend home page. Alert on non-200 and on a response time above 10 s. Render's free plan sleeps after 15 idle minutes, so use at least the Starter plan before real customers.
4. **Sentry:** set `SENTRY_DSN` (API) and `NEXT_PUBLIC_SENTRY_DSN` (frontend); create an alert rule for new issues and for error-rate spikes.
5. **Secrets backup:** store `SECRET_KEY` and the Stripe keys in the team password manager. Rotating `SECRET_KEY` signs every user out.

## Taking and checking a backup
```bash
export MONGODB_URI='mongodb+srv://...'      # never commit this
BACKUP_DIR=/var/backups/autopilot scripts/backup/mongo-backup.sh
```

## Restore drill (non-destructive)
```bash
scripts/backup/mongo-restore.sh /var/backups/autopilot/autopilot-<stamp>.archive.gz   # -> autopilot_restore_test
# check counts in autopilot_restore_test, then drop it
```
To restore over production (after an incident only): stop the API, then
`CONFIRM_OVERWRITE=yes scripts/backup/mongo-restore.sh <archive> autopilot`, which adds the archived documents back (it does not drop collections; resolve conflicts first), then start the API.

## Recovery targets (proposal, needs the client's sign-off)
RPO 24 h with nightly dumps (minutes with Atlas point-in-time recovery). RTO 2 h.
