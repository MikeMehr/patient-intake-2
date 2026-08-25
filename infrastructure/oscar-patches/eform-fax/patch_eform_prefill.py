"""Let the Health Assist transcription page open an eForm prefilled.

The transcription popup builds a fill-spec (see src/lib/oscar/eform-prefill.ts in the
patient-intake repo) and opens efmformadd_data.jsp?fid=N&demographic_no=D&ha_prefill=B,
where B is base64url(JSON): {v:1, fid, demographicNo, checks:[ids], fields:{id:value}}.
This patch injects a script that applies that spec once the form has loaded:

  - checks: real checkbox -> .checked = true; anything else (the box-style text
    inputs these forms use) -> value = 'X'
  - fields: set when empty, append when the form (oscarDB= substitution) already
    put something there

The spec carries element ids only - all clinical mapping lives in the app repo, so
iterating on WHAT gets filled never needs this patch re-run. The script is a strict
no-op when ha_prefill is absent, so saved instances (efmshowform_data.jsp?fdid=N)
and hand-opened blank forms behave exactly as before.

ha_prefill is attacker-influenceable data (anyone can craft a URL) landing in a
logged-in EMR page, so the script is deliberately incapable of anything beyond
ticking form fields: JSON.parse only, .value/.checked writes only - no eval, no
innerHTML, no element creation, no network - plus a size cap and a wrong-patient
guard (spec.demographicNo must match the demographic the form was opened for).

Run ON the OSCAR box:  sudo python3 patch_eform_prefill.py 3 7

form_html is a CRLF latin-1 blob edited via HEX/UNHEX so nothing is mangled in
transit. Every edit asserts it matches exactly once, and a hex backup of the
original is written before anything is changed.
"""

import os
import subprocess
import sys
import time

BACKUP_DIR = '/var/lib/OscarDocument/oscar/mymd_eform_backups'
STAMP = time.strftime('%Y%m%d%H%M%S')

# head - the head-close tag the script block is inserted before. fid 5 closes with
# </HEAD>; both forms here use lowercase (verified against live form_html 2026-08-24).
FORMS = {
    3: {'head': '</head>', 'title': 'lab requisition'},
    7: {'head': '</head>', 'title': 'imaging requisition'},
}

PREFILL_JS = r'''
<!-- MyMD Aug2026: apply the ha_prefill fill-spec from the Health Assist transcription page -->
<script type="text/javascript">
	function haPrefill() {
		function _qp(src, n) { var m = String(src).match(new RegExp("[?&]" + n + "=([^&]*)")); return m ? decodeURIComponent(m[1]) : ""; }
		var raw = _qp(window.location.search, "ha_prefill");
		if (!raw || raw.length > 8192) { return; }
		var spec;
		try {
			var b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
			while (b64.length % 4) { b64 += "="; }
			// atob yields a binary string; escape/decodeURIComponent turns it back into UTF-8 text.
			spec = JSON.parse(decodeURIComponent(escape(atob(b64))));
		} catch (e) { return; }
		if (!spec || spec.v !== 1) { return; }

		// Wrong-patient guard: the spec was built for one demographic. The add page
		// carries demographic_no in its URL; the form action carries efmdemographic_no.
		var demo = _qp(window.location.search, "demographic_no");
		if (!demo) {
			var forms = document.getElementsByTagName("form");
			for (var i = 0; i < forms.length && !demo; i++) { demo = _qp(forms[i].action, "efmdemographic_no"); }
		}
		if (!demo || String(spec.demographicNo) !== String(demo)) {
			alert("This prefilled requisition was prepared for a different patient - leaving the form blank.");
			return;
		}

		function el(id) {
			var e = document.getElementById(id);
			if (!e) { var byName = document.getElementsByName(id); e = byName.length ? byName[0] : null; }
			return e;
		}

		var checks = spec.checks || [];
		for (var c = 0; c < checks.length; c++) {
			var box = el(String(checks[c]));
			if (!box) { continue; }
			if (String(box.type).toLowerCase() === "checkbox") { box.checked = true; }
			else { box.value = "X"; }
		}
		var fields = spec.fields || {};
		for (var name in fields) {
			if (!Object.prototype.hasOwnProperty.call(fields, name)) { continue; }
			var value = String(fields[name]);
			var input = el(String(name));
			if (!input || !("value" in input)) { continue; }
			// oscarDB= substitution may already have filled something - append, never clobber.
			if (String(input.value).replace(/^\s+|\s+$/g, "") === "") { input.value = value; }
			else { input.value += (String(input.tagName).toLowerCase() === "textarea" ? "\n" : "; ") + value; }
		}

		// Mark the form dirty so OSCAR treats it as saveable. Not every eForm
		// defines these, so a missing one must not kill the fill.
		try { setFlag(); } catch (e) {}
		try { setDirtyFlag(); } catch (e) {}
	}
	// load, not DOMContentLoaded: the form's own startup scripts run first and
	// cannot overwrite what this fills in afterwards.
	if (window.addEventListener) { window.addEventListener("load", haPrefill, false); }
	else if (window.attachEvent) { window.attachEvent("onload", haPrefill); }
</script>

'''


def crlf(t):
    return t.replace('\r\n', '\n').replace('\n', '\r\n')


def mysql_scalar(sql):
    return subprocess.check_output(['mysql', 'oscar_db', '-N', '--raw', '-e', sql]).decode().strip()


def patch(fid):
    cfg = FORMS.get(fid)
    if cfg is None:
        raise SystemExit('fid %d is not configured - add its head tag to FORMS' % fid)

    hexs = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % fid)
    assert len(hexs) > 1000, 'form_html looks empty for fid %d' % fid
    s = bytes.fromhex(hexs).decode('latin-1')

    if 'haPrefill' in s:
        print('fid=%d already has the prefill script - skipped' % fid)
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, 'eform_fid%d_%s.hex' % (fid, STAMP))
    with open(backup, 'w') as fh:
        fh.write(hexs)

    old = cfg['head']
    n = s.count(old)
    assert n == 1, 'fid %d: expected 1 match, found %d for %r' % (fid, n, old)
    s = s.replace(old, crlf(PREFILL_JS) + old)

    blob = s.encode('latin-1')
    sqlfile = '/tmp/upd_fid%d_prefill.sql' % fid
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
