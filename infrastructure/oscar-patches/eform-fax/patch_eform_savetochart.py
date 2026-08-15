"""Add a "Save to chart" button to a requisition eForm.

The button saves the form (hidden iframe, so the doctor stays on it) and then POSTs to
eform/saveEformToChart.jsp, which renders the saved copy to PDF and files it into the
patient's Documents under the `requisition` doctype. That is the folder: OSCAR has no
folders, so Documents -> View: requisition is as close as it gets.

Deliberately has NO popup. window.open() from an async callback is blocked outright by
the browser - that is what broke the fax button the first time it shipped - and there is
nothing to ask the user here, so fetch() from the save iframe's onload is the right tool
and sidesteps the trap entirely.

Run ON the OSCAR box:  sudo python3 patch_eform_savetochart.py <fid> [<fid> ...]

form_html is a CRLF blob edited via HEX/UNHEX so nothing is mangled in transit. Every
edit asserts it matches exactly once, and a hex backup of the original is written before
anything is changed.
"""

import os
import subprocess
import sys
import time

BACKUP_DIR = '/var/lib/OscarDocument/oscar/mymd_eform_backups'
STAMP = time.strftime('%Y%m%d%H%M%S')

# Per-form facts that cannot be guessed. Verified against the live form_html:
#   head    - fid 5 closes its head with </HEAD>, the others with </head>
#   anchor  - the button the Save button is appended after; must appear exactly once
#   pages   - JS expression returning "1" for page-1-only, "" for the whole form.
#             fid 39 reuses the form's own checklist test so the filed copy matches
#             what gets faxed. Everything else files the whole form; the trailing blank
#             page wkhtmltopdf leaves is trimmed server-side.
#   form    - the <form> element's name. Nearly every eForm uses FormName, but fid 7
#             calls its form MedicalImagingForm, and document.FormName would be
#             undefined there.
#
# fid 16 is only patchable after restore_eform16_html.py has put its HTML back; its
# form_html was NULL from a misfiled 2026-06-17 upload.
DEFAULT_FORM = 'FormName'

FORMS = {
    39: {
        'head': '</head>',
        'anchor': ('<input value="Fax to MRI Central" name="FaxButton" id="FaxButton" type="button"'
                   ' style="background-color:#c6f0c6; font-weight:bold;" onClick="faxMRIReq();"'
                   ' title="Save this requisition, then choose the destination and any documents to send with it">'),
        'pages': ('(/\\b(knee|knees|hip|hips|lumbar|l\\-sp|l\\-spine)\\b/i.test('
                  '(document.getElementById("ExamRequested") || {value: ""}).value) ? "" : "1")'),
        'title': 'MRI requisition',
    },
    5: {
        'head': '</HEAD>',
        'anchor': ('<input value="Fax" name="FaxButton" id="FaxButton" type="button"'
                   ' style="background-color:#c6f0c6; font-weight:bold;" onClick="faxBrookeUS();">'),
        'pages': '""',
        'title': 'ultrasound requisition',
    },
    11: {
        'head': '</head>',
        'anchor': '<input value="Print and Submit" name="PrintSubmitButton" type="button" onClick="printSubmit();">',
        'pages': '""',
        'title': 'bone density requisition',
    },
    3: {
        'head': '</head>',
        'anchor': '<input value="Email to Patient" name="EmailButton" id="EmailButton" type="button" onclick="emailLabReq();">',
        'pages': '""',
        'title': 'lab requisition',
    },
    4: {
        'head': '</head>',
        'anchor': ('<input value="Print & Submit" name="PrintSubmitButton" id="PrintSubmitButton" type="button"'
                   ' onclick="formPrint();releaseDirtyFlag();setTimeout(\'SubmitButton.click()\',1000);">'),
        'pages': '""',
        'title': 'X-ray requisition',
    },
    6: {
        'head': '</head>',
        'anchor': '<input value="Print and Submit" name="PrintSubmitButton" type="button" onClick="addSubject(); printSubmit();">',
        'pages': '""',
        'title': 'imaging requisition',
    },
    7: {
        'head': '</head>',
        'anchor': '<input value="Print and Submit" name="PrintSubmitButton" type="button" onClick="printSubmit()">',
        'pages': '""',
        'title': 'imaging requisition',
        'form': 'MedicalImagingForm',
    },
    16: {
        # Same submit bar as fid 4 and 70, byte for byte.
        'head': '</head>',
        'anchor': ('<input value="Print & Submit" name="PrintSubmitButton" id="PrintSubmitButton" type="button"'
                   ' onclick="formPrint();releaseDirtyFlag();setTimeout(\'SubmitButton.click()\',1000);">'),
        'pages': '""',
        'title': 'imaging requisition',
    },
    33: {
        'head': '</head>',
        'anchor': ('<input value="Print & Submit" name="PrintSubmitButton" id="PrintSubmitButton" type="button"'
                   ' onclick="document.FormName.subject.value = subject.value += ExamRequestedText.value; printSubmit();">'),
        'pages': '""',
        'title': 'imaging requisition',
    },
    70: {
        'head': '</head>',
        'anchor': ('<input value="Print and Submit" name="PrintSubmitButton" id="PrintSubmitButton" type="button"'
                   ' onclick="formPrint();releaseDirtyFlag();setTimeout(\'SubmitButton.click()\',1000);">'),
        'pages': '""',
        'title': 'imaging requisition',
    },
    74: {
        'head': '</head>',
        'anchor': ('<input value="Fax" name="FaxButton" id="FaxButton" type="button"'
                   ' style="background-color:#c6f0c6; font-weight:bold;" onclick="faxHSATReq();">'),
        'pages': '""',
        'title': 'sleep study requisition',
    },
    # Coverage requests rather than requisitions: saveEformToChart.jsp files these under
    # `insurance`, so the request lands next to the decision that comes back by fax.
    52: {
        'head': '</head>',
        'anchor': ('<input value="Fax to MHSUC" name="FaxButton" id="FaxButton" type="button"'
                   ' style="background-color:#c6f0c6; font-weight:bold;" onclick="faxPlanG();">'),
        'pages': '""',
        'title': 'Plan G request',
    },
    62: {
        'head': '</head>',
        'anchor': ('<input value="Fax to PharmaCare" name="FaxButton" id="FaxButton" type="button"'
                   ' style="background-color:#c6f0c6; font-weight:bold;" onClick="faxSpecialAuthority();">'),
        'pages': '""',
        'title': 'Special Authority request',
    },
}


def crlf(t):
    return t.replace('\r\n', '\n').replace('\n', '\r\n')


def mysql_scalar(sql):
    return subprocess.check_output(['mysql', 'oscar_db', '-N', '--raw', '-e', sql]).decode().strip()


def save_js(cfg):
    return crlf(r'''
<!-- MyMD Aug2026: file this saved requisition into the patient's Documents -->
<script type="text/javascript">
	function _saveChartPages() { return %(pages)s; }

	function saveReqToChart() {
		function _qp(src, n) { var m = String(src).match(new RegExp("[?&]" + n + "=([^&]*)")); return m ? decodeURIComponent(m[1]) : ""; }
		// On the add page the form carries its own name. Once saved, EForm.setAction()
		// renames it to saveEForm (keeping id where the form has one, which some of
		// these do not), so resolve every way before giving up.
		var f = document.%(form)s || document.saveEForm || document.getElementById("%(form)s");
		if (!f) { alert("Cannot find this form on the page."); return; }
		// The page URL carries these while the form is being created. Once it is saved it
		// is viewed as efmshowform_data.jsp?fdid=N and neither is in the URL - but OSCAR
		// always rewrites the form action to addEForm.do?efmfid=..&efmdemographic_no=..
		var demo = _qp(window.location.search, "demographic_no") || _qp(f.action, "efmdemographic_no");
		var theFid = _qp(window.location.search, "fid") || _qp(f.action, "efmfid");
		if (!demo || !theFid) { alert("Cannot tell which patient or form this is - open the form from the chart and try again."); return; }

		var btn = document.getElementById("SaveChartButton");
		function restore() { if (btn) { btn.disabled = false; btn.value = "Save to chart"; } }
		if (btn) { btn.disabled = true; btn.value = "Saving..."; }

		var ifr = document.getElementById("chartSaveFrame");
		if (!ifr) {
			ifr = document.createElement("iframe");
			ifr.name = "chartSaveFrame"; ifr.id = "chartSaveFrame"; ifr.style.display = "none";
			document.body.appendChild(ifr);
		}
		var prevTarget = f.target;
		var submitted = false, done = false;
		var timer = setTimeout(function () {
			if (done) { return; }
			done = true;
			restore();
			alert("The form did not finish saving, so there is nothing to file yet. Try again.");
		}, 20000);

		ifr.onload = function () {
			// fires once the requisition is in the chart - only then is there a saved
			// copy for saveEformToChart.jsp to render
			if (!submitted || done) { return; }
			done = true;
			clearTimeout(timer);
			f.target = prevTarget;

			// Best effort: file the copy the save just produced rather than "the newest
			// one", so two tabs of this form for the same patient cannot file the wrong
			// one. Falls back to newest-saved server-side when this is not readable.
			var fdid = "";
			try { fdid = _qp(ifr.contentWindow.location.search, "fdid"); } catch (e) {}

			var pg = _saveChartPages();
			var body = "demographicNo=" + encodeURIComponent(demo)
				+ "&fid=" + encodeURIComponent(theFid)
				+ (pg ? "&pages=" + encodeURIComponent(pg) : "")
				+ (fdid ? "&fdid=" + encodeURIComponent(fdid) : "");

			// fetch() from an async callback is fine. window.open() from one is NOT -
			// the browser blocks it outright. That is why this button has no popup.
			fetch(window.location.origin + window.location.pathname.replace(/[^\/]*$/, "") + "saveEformToChart.jsp", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: body
			})
				.then(function (r) { return r.text(); })
				.then(function (t) {
					if (t.indexOf("SUCCESS") === 0) {
						// A check mark goes in as the JS escape below, never as a literal: form_html is a
						// latin-1 byte blob and anything outside latin-1 cannot be
						// written back into it.
						if (btn) { btn.value = "Saved to chart \u2713"; btn.disabled = true; }
					} else if (t.indexOf("EXISTS") === 0) {
						if (btn) { btn.value = "Already in chart"; btn.disabled = true; }
					} else {
						restore();
						alert(t);
					}
				})
				.catch(function (e) { restore(); alert("Save to chart failed: " + e); });
		};

		// setFlag is OSCAR's submit flag. Not every eForm defines it - fid 5 does not -
		// and an uncaught ReferenceError here would kill the save before it started.
		try { setFlag(); } catch (e) {}
		try { releaseDirtyFlag(); } catch (e) {}
		f.target = "chartSaveFrame";
		submitted = true;
		f.submit();
	}
</script>

%(head)s''' % cfg)


def save_button(cfg):
    return crlf('''
		<input value="Save to chart" name="SaveChartButton" id="SaveChartButton" type="button"'''
                ''' style="background-color:#dce9f7; font-weight:bold;" onClick="saveReqToChart();"'''
                ''' title="Save this %(title)s into the patient\'s Documents, so it can be faxed later'''
                ''' without downloading it first">''' % cfg)


def patch(fid):
    cfg = FORMS.get(fid)
    if cfg is None:
        raise SystemExit('fid %d is not configured - add its head tag, anchor and pages rule to FORMS' % fid)
    cfg = dict(cfg)
    cfg.setdefault('form', DEFAULT_FORM)

    hexs = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % fid)
    assert len(hexs) > 1000, 'form_html looks empty for fid %d' % fid
    s = bytes.fromhex(hexs).decode('latin-1')

    if 'saveReqToChart' in s:
        print('fid=%d already has the Save to chart button - skipped' % fid)
        return

    # The backup goes somewhere that survives a reboot. /tmp does not, and the hex blob
    # is the only way back if an edit turns out to be wrong.
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'eform_fid%d_%s.hex' % (fid, STAMP))
    with open(backup, 'w') as fh:
        fh.write(hexs)

    edits = [
        (cfg['head'], save_js(cfg)),                          # the function, before </head>
        (cfg['anchor'], cfg['anchor'] + save_button(cfg)),    # the button, after the anchor
    ]
    for old, new in edits:
        n = s.count(old)
        assert n == 1, 'fid %d: expected 1 match, found %d for %r' % (fid, n, old[:70])
        s = s.replace(old, new)

    blob = s.encode('latin-1')
    sqlfile = '/tmp/upd_fid%d_savechart.sql' % fid
    with open(sqlfile, 'w') as fh:
        fh.write("UPDATE eform SET form_html=UNHEX('%s') WHERE fid=%d;\n" % (blob.hex(), fid))
    subprocess.check_call('mysql oscar_db < %s' % sqlfile, shell=True)

    after = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % fid)
    assert after.lower() == blob.hex().lower(), 'fid %d: written blob does not match - CHECK THE FORM' % fid
    print('fid=%d updated, %d -> %d bytes, hex backup %s' % (fid, len(hexs) // 2, len(blob), backup))


if __name__ == '__main__':
    fids = [int(a) for a in sys.argv[1:]] or sorted(FORMS)
    for fid in fids:
        patch(fid)
