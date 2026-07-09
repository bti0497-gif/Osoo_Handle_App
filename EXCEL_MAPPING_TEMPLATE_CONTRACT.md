# Excel Mapping And Template Contract

This document protects the field setup workflow after an Excel file has been accepted and mapped.

## Excel Mapping

- The Excel file accepted in Basic Settings must be copied into `AppData/templates/excel-originals` and become the sole import source.
- A successful Excel upload must leave only the active original file in that folder; development samples and older originals must not remain.
- Selecting the same Excel file again must trigger a fresh upload so its latest contents replace the AppData copy.
- Saved column letters are the source of truth. Import code must read each saved column 1:1.
- Inventory mappings use exactly these suffixes: `purchase`, `usage`, `inventory`.
- Medicine and kit imports must read:
  - purchase from `cols.purchase`
  - usage from `cols.usage`
  - inventory from `cols.inventory`
- Inventory mapping UI must not auto-select the next column. The user-selected dropdown value is saved as-is.
- Flow mapping may keep the raw-to-flow next-column UI convenience, but import still reads `raw` and `flow` from their saved letters.
- Start-row auto end-row selection is UI convenience only. It must not change saved column mappings.
- Import accepts dates from `2000-01-01` through today's KST date only; formula-generated future rows and invalid legacy dates are ignored.
- Re-import removes prior `imported` rows before applying the selected Excel range, while unrelated manual rows remain protected.
- Saving an Excel mapping overwrites local DB rows for the mapped dates and mapped item names before inserting imported rows.
- Import progress must be tracked per mapping type: `flow`, `medicine`, `kit`, `water`.

## Basic Settings Widgets

- Basic site settings must keep the existing widgets:
  - `BasicSiteHeaderPanel`
  - `ItemManagementPanel`
  - `MeasurementPlacePanel`
  - `TemplateFilePanel`
- Basic settings save must update site identity and active config items without rewriting Excel column mapping rules.
- BigQuery operational data reset controls must not appear in the settings UI.

## Report Templates And Packaging

- Report templates under `templates/reports` are release assets.
- Electron packaging must include `templates/**/*` and copy `templates` as `extraResources`.
- Daily work log HWPX binding must select method-specific templates:
  - `일일업무일지(A2O).hwpx`
  - `일일업무일지(MBR).hwpx`
- Bundled templates must sync to AppData and replace placeholder-sized files when a real bundled template is available.
- Release validation must fail if required report templates are missing from source or packaged resources.
