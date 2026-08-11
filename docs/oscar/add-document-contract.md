# OSCAR "Add Document" — the upload contract

Recorded from the live server (oscar.mymdonline.ca / 192.168.1.201) on 2026-08-10, because
OSCAR publishes **no** document API and nothing here could be inferred from the repo. The live
WADL (`/oscar/ws/services?_wadl`) exposes only `demographics`, `schedule`, `provider` and
`status` — there is no REST route that writes a chart document. See
`docs/oscar-emr-oauth-setup.md` for that WADL check.

The only way in is the DMS module's own Struts form, driven with a logged-in OSCAR session.

## Endpoint

```
POST /oscar/dms/addEditDocument.do
Content-Type: multipart/form-data
```

Struts mapping (`WEB-INF/struts-config.xml`): path `/dms/addEditDocument` →
`oscar.dms.actions.AddEditDocumentAction`, forwards `successAdd`/`failAdd` →
`/dms/documentReport.jsp`. Source form: `dms/addDocument.jsp` (line ~277).

**No CSRF filter.** `web.xml` registers none, so the request needs only the session cookie
(`JSESSIONID`) — which is why this works from a script running inside the physician's own
authenticated OSCAR page, and would not work from our server.

**Authorization:** the page is gated by `<security:oscarSec objectName="_edoc" rights="w">`.
A provider who can add a document by hand can add one this way; nobody else can.

## Fields

| Field | Required | Value for a patient-chart document |
|---|---|---|
| `function` | yes | `demographic` |
| `functionId` | yes | the patient's `demographicNo` |
| `functionid` | yes | same value again — the JSP posts **both** spellings |
| `docFile` | yes | the file part |
| `docType` | yes | one of `ctl_doctype` for module `demographic` (see below) |
| `docDesc` | yes | title shown in the chart; blank ⇒ `descmissing` error |
| `docCreator` | yes | provider number of the uploading provider |
| `observationDate` | yes | `yyyy-MM-dd` |
| `mode` | yes | `add` |
| `Submit` | yes | `Add` |
| `docClass` | no | from `ctl_doc_class` report classes |
| `docSubClass` | no | free text |
| `appointmentNo` | no | links the document to an appointment |
| `restrictToProgram` | no | checkbox |
| `curUser`, `parentAjaxId` | no | UI plumbing; safe to send empty |
| `docPublic` | no | only rendered when `function=provider` |

### Active `docType` values (module `demographic`)

`consult`, `econsult`, `insurance`, `lab`, `legal`, `oldchart`, `others`, `pathology`,
`photo`, `radiology`

`photo` is the right type for a patient-submitted picture of a complaint — staff already use
it that way (existing rows: "nose rash photo", "left side of face"). Use `others` for a form.

## What a successful add writes

- **File** → `DOCUMENT_DIR` = `/var/lib/OscarDocument/oscar/document/`, renamed with a
  `yyyyMMddHHmmss` prefix (e.g. `20260810120301OlyviaApt.pdf`).
- **`document`** row — `doctype`, `docdesc`, `docfilename`, `doccreator`, `contenttype`,
  `observationdate`, `status='A'`.
- **`ctl_document`** row — `module='demographic'`, `module_id=<demographicNo>`,
  `document_no=<new id>`, `status='A'`. **This row is what makes it appear in the patient's
  chart**; the `document` row alone is orphaned.

## Gotcha inherited from elsewhere

Files written into `DOCUMENT_DIR` must end up **owned by tomcat**, not merely world-readable —
OSCAR's viewer opens them read-write, so mode 0644 owned by another user still renders as a
broken image. This bit the SRFax bridge (see `[[reference-oscar-srfax-doc-perms]]`). Uploads
made through `addEditDocument.do` are written by Tomcat itself, so they are fine; this only
matters if a file is ever placed there out of band.
