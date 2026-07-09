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

- On the first startup of each app version, diagnostic logs older than the current KST date are removed.
- Cleanup is limited to the local diagnostic store and the Google Drive `앱진단로그` tree.
- Logs created on the current KST date must remain available for field diagnosis.
