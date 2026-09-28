# Local Data And Backup Contract

## Source Of Truth

- The field app's local SQLite database is the operational source of truth.
- BigQuery receives local changes as synchronization and backup storage.
- Normal views, previews, reports, exports, and roadwork helpers must never restore BigQuery rows into the local database.

## Disaster Recovery

- `bigQueryRestoreService.cjs` is retained only for a future admin-only disaster-recovery command under Settings.
- Disaster recovery must be an explicit administrator action.
- Even during recovery, unsynchronized local rows (`is_synced = 0`) must not be overwritten.

## Diagnostic Log Retention

- Detailed diagnostic events stay in the local SQLite upload queue only until Drive confirms receipt; after receipt, the message and detail payload are scrubbed while small summary fields remain for daily stability counts. Unsent items expire after 30 KST days.
- Legacy local diagnostic JSONL files are removed after 14 KST days. New work activity history records only timestamp, work title, and result in `logs/activity/`, retained for 30 KST days or 500 MiB total, whichever limit is reached first.
- On the first startup of each app version, Google Drive `앱진단로그` files older than 14 KST days are removed.
- The raw `electron-server.log` keeps only bounded stderr (4 MiB maximum; an oversized legacy file is compacted on startup).
- Logs created on the current KST date must remain available for field diagnosis.
