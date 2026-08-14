-- The "requisition folder" in OSCAR.
--
-- OSCAR has no folder concept: dms/documentReport.jsp hardcodes exactly one bucket
-- per patient chart ("<Patient>'s Private Documents"), and the only content filter is
-- the View: dropdown, which is built from EDocUtil.getActiveDocTypes(module). So a
-- doctype IS the folder, and this row is the whole feature:
--
--   dms/documentReport.jsp?function=demographic&functionid=<demoNo>&view=requisition
--
-- One type for every requisition rather than one per modality (mri/ultrasound/...):
-- there is no delete-a-doctype UI, each extra value clutters the dropdown forever, and
-- a document filed under the "wrong" modality would vanish from the right folder. The
-- modality is already in docdesc, which is what the list actually shows.
--
-- status='A' is set explicitly and is NOT optional. getActiveDocTypes filters on 'A',
-- and ctl_doctype.status is nullable -- letting the type be auto-created by posting an
-- unknown docType can leave it NULL, in which case it never appears in the dropdown and
-- the folder silently does not exist.
--
-- There is no unique key on (module, doctype), so the WHERE NOT EXISTS is what makes
-- this re-runnable.
--
-- Rollback: UPDATE ctl_doctype SET status='I' WHERE module='demographic' AND doctype='requisition';
-- (drops it out of the dropdown; already-filed documents keep the type and stay visible under "All")

INSERT INTO ctl_doctype (module, doctype, status)
SELECT 'demographic', 'requisition', 'A' FROM DUAL
 WHERE NOT EXISTS (
   SELECT 1 FROM ctl_doctype WHERE module = 'demographic' AND doctype = 'requisition'
 );

SELECT id, module, doctype, status FROM ctl_doctype WHERE module = 'demographic' ORDER BY doctype;
