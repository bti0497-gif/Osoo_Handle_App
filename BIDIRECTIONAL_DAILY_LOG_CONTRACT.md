# Bidirectional Daily Work Log Contract

This contract protects cross-direction daily-work-log output without mixing operational databases.

## Scope And Visibility

- The feature applies only to `일일업무일지`; no other report menu may use the remote dataset path.
- The design may support bidirectional managers, but the current enabled account is exactly `손규복`.
- Candidate output sites must come from the authenticated user's `managed_sites` and must be assigned to that manager.
- The current candidates must both be active `죽암휴게소` sites.
- The default output site is `죽암휴게소(부산방향)`.
- Single-site users and all other accounts must see the existing screen without the output-site dropdown.

## Data Isolation

- Selecting the locally installed site must keep the existing local-DB report path unchanged.
- Selecting the other direction must query BigQuery into a separate temporary SQLite snapshot.
- The operational SQLite database must never receive remote flow, medicine, kit, QnTECH, or operation-status rows.
- The temporary snapshot must begin as a backup so report configuration remains available, then its operational tables must be cleared before remote rows are restored.
- A failed remote query must show an error and must never fall back to the local site's data.
- Temporary snapshot rows are read-only report inputs and must never be registered for synchronization.

## Template Isolation

- The original HWPX template must never be modified.
- For remote output, only the generated in-memory/output copy may replace the local site name with the selected site name.
- `죽암휴게소(부산방향)` must become `죽암휴게소(서울방향)` when 서울방향 is selected.
- Site-name replacement must support text split across multiple HWPX text runs.

## Operation Status Synchronization

- `operation_status_logs` must include `is_synced` and participate in the normal BigQuery sync state machine.
- Saving or editing PH, DO, or SVI must set `is_synced = 0`.
- The BigQuery natural key is `(site_id, date)`.
- The BigQuery table must be created automatically on the first operation-status upload.
- Existing local operation-status rows receive the migration default and are uploaded after upgrade.
