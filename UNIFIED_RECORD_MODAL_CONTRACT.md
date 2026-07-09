# Unified Record Modal Contract

This document protects the integrated input modal used by flow, water, medicine, and kit screens.

## Date Opening Rules

- If a user double-clicks a grid row, the modal opens with that row date.
- If a user selects a date and clicks the open-input button, the modal opens with the selected date.
- If no date is selected, the modal opens with today's local date.
- Add/edit mode must not override a selected date back to today.
- Changing the date inside the modal resets drafts and reloads context for the new date.

## Editing Rules

- Flow, medicine, kit, and enabled water text inputs must remain clickable and editable.
- The modal body must not use a blanket `pointer-events: none` rule that blocks text-box editing.
- Flow and inventory inputs must not be disabled just because the modal is in add/edit mode.
- Water PO4-P may remain disabled only for locations where that field is not applicable.

## Auto Calculation Rules

- Flow has no inventory concept.
- In flow tabs, editing reading recalculates that day's flow from the previous reading.
- In flow tabs, editing flow recalculates that day's reading from the previous reading plus edited flow.
- Saving a past flow date triggers server-side recalculation of later flow values from raw readings.
- Medicine and kit have inventory.
- Empty medicine and kit purchase/usage inputs default to zero, and inventory carries forward from the previous date.
- Empty sludge export defaults to zero, while its cumulative value carries forward.
- Editing purchase or usage recalculates that day's inventory from previous inventory plus purchase minus usage.
- Editing inventory marks that date as a manual inventory baseline.
- Saving a past medicine or kit date triggers server-side recalculation of later inventory values.
- Water quality values have no formula cascade and only the edited date/round/location is saved.

## Close And Save Rules

- Save happens only from the save button.
- Close/X may warn about unsaved data, but confirming close must close without saving.

## Save And Update Rules

- The save button saves only the active tab.
- Flow save must call `FlowModel.bulkSave(date, flowItems)` and post to `/api/flows/bulk`.
- Medicine save must call `MedicineModel.bulkSave(medicineItems)` and post to `/api/medicines/bulk`.
- Kit save must call `KitModel.bulkSave(kitItems)` and post to `/api/kits/bulk`.
- Water save must call `WaterQualityModel.bulkSave(waterItems)` and post to `/api/water-quality/bulk`.
- Each model must clear its history cache before save.
- After a successful save, the modal must force reload only the saved tabs so visible values match the DB.
- The parent grid must reuse the refreshed model cache and must not issue a duplicate forced request.
- Saving one tab must not reload unrelated flow, medicine, kit, or water histories.
- Flow server save must upsert by `(date, type)`.
- Medicine server save must upsert by `(medicine_name, date)`.
- Kit server save must upsert by `(kit_name, date)`.
- Water server save must upsert by `(date, measurement_group, location, item_code)`.
- Save failures must return `success: false` to the modal and must not be treated as success.
