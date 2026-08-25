"""Let the Health Assist transcription page open a prefilled Consultation Request.

Companion to patch_eform_prefill.py, but for a stock JSP rather than a DB eForm:
oscarEncounter/oscarConsultationRequest/ConsultationFormRequest.jsp. The page is
opened as ConsultationFormRequest.jsp?de=D&ha_prefill=B where B is base64url(JSON):
{v:1, fid:0, demographicNo, checks:[], fields:{id:value}, selects:{id:choice}}.

  - fields: reasonForConsultation / clinicalInformation textareas - set when
    empty, append when something is already there
  - selects: urgency (matched by option VALUE: 2=Non-Urgent, 1=Urgent) and
    service (matched by case-insensitive option TEXT - the page builds the
    service list client-side, so the script retries briefly until options exist,
    and fires the select's onchange so the specialist list loads)

Same safety posture as the eForm patch: strict no-op without ha_prefill, size
cap, JSON.parse only, wrong-patient guard against the `de` param, and nothing
beyond .value/.checked/.selected writes.

Being a webapp file (not the database), a WAR redeploy WIPES this patch - re-run
after redeploys, like every other JSP patch in this directory.

Run ON the OSCAR box:  sudo python3 patch_consultation_prefill.py
"""

import os
import shutil
import time

JSP = '/opt/tomcat9/webapps/oscar/oscarEncounter/oscarConsultationRequest/ConsultationFormRequest.jsp'
WORK_DIR = '/opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/oscarEncounter/oscarConsultationRequest'
STAMP = time.strftime('%Y%m%d%H%M%S')

ANCHOR = '</body>'

PREFILL_JS = r'''
<!-- MyMD Aug2026: apply the ha_prefill fill-spec from the Health Assist transcription page -->
<script type="text/javascript">
(function () {
	function _qp(n) { var m = String(window.location.search).match(new RegExp("[?&]" + n + "=([^&]*)")); return m ? decodeURIComponent(m[1]) : ""; }

	function haApply(attempt) {
		var raw = _qp("ha_prefill");
		if (!raw || raw.length > 8192) { return; }
		var spec;
		try {
			var b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
			while (b64.length % 4) { b64 += "="; }
			spec = JSON.parse(decodeURIComponent(escape(atob(b64))));
		} catch (e) { return; }
		if (!spec || spec.v !== 1) { return; }

		var demoInput = document.getElementById("demographicNo");
		var demo = _qp("de") || (demoInput ? demoInput.value : "");
		if (!demo || String(spec.demographicNo) !== String(demo)) {
			alert("This prefilled consultation was prepared for a different patient - leaving the form blank.");
			return;
		}

		function el(id) {
			var e = document.getElementById(id);
			if (!e) { var byName = document.getElementsByName(id); e = byName.length ? byName[0] : null; }
			return e;
		}

		var selects = spec.selects || {};
		// The service list is built by the page's own scripts after load - wait for
		// it (up to ~6s) before applying anything, so a retry never double-appends.
		if (selects.service) {
			var serviceSel = el("service");
			if (serviceSel && serviceSel.options.length < 2 && attempt < 20) {
				setTimeout(function () { haApply(attempt + 1); }, 300);
				return;
			}
		}

		for (var name in selects) {
			if (!Object.prototype.hasOwnProperty.call(selects, name)) { continue; }
			var sel = el(String(name));
			if (!sel || !sel.options) { continue; }
			var want = String(selects[name]);
			var wantLower = want.toLowerCase();
			var hit = -1;
			for (var i = 0; i < sel.options.length && hit < 0; i++) {
				if (String(sel.options[i].value) === want) { hit = i; }
			}
			for (var j = 0; j < sel.options.length && hit < 0; j++) {
				if (String(sel.options[j].text).replace(/^\s+|\s+$/g, "").toLowerCase() === wantLower) { hit = j; }
			}
			for (var k = 0; k < sel.options.length && hit < 0; k++) {
				if (String(sel.options[k].text).toLowerCase().indexOf(wantLower) >= 0) { hit = k; }
			}
			if (hit < 0) { continue; }
			sel.selectedIndex = hit;
			// The service select's onchange loads the specialist list - fire it.
			try { if (sel.onchange) { sel.onchange(); } } catch (e) {}
		}

		var fields = spec.fields || {};
		for (var fname in fields) {
			if (!Object.prototype.hasOwnProperty.call(fields, fname)) { continue; }
			var input = el(String(fname));
			if (!input || !("value" in input)) { continue; }
			var value = String(fields[fname]);
			if (String(input.value).replace(/^\s+|\s+$/g, "") === "") { input.value = value; }
			else { input.value += (String(input.tagName).toLowerCase() === "textarea" ? "\n" : "; ") + value; }
		}
	}

	if (window.addEventListener) { window.addEventListener("load", function () { haApply(0); }, false); }
	else if (window.attachEvent) { window.attachEvent("onload", function () { haApply(0); }); }
})();
</script>

'''


def main():
    with open(JSP, 'r', encoding='latin-1', newline='') as fh:
        s = fh.read()

    if 'haApply' in s:
        print('ConsultationFormRequest.jsp already has the prefill script - skipped')
        return

    n = s.count(ANCHOR)
    assert n == 1, 'expected 1 match for %r, found %d' % (ANCHOR, n)

    backup = JSP + '.oscarbak.' + STAMP
    shutil.copy2(JSP, backup)

    s = s.replace(ANCHOR, PREFILL_JS + ANCHOR)
    with open(JSP, 'w', encoding='latin-1', newline='') as fh:
        fh.write(s)

    # Force a recompile - Tomcat picks the JSP change up without a restart once
    # the stale compiled copy is gone.
    removed = 0
    if os.path.isdir(WORK_DIR):
        for f in os.listdir(WORK_DIR):
            if f.startswith('ConsultationFormRequest_jsp'):
                os.remove(os.path.join(WORK_DIR, f))
                removed += 1
    print('patched %s (backup %s), removed %d compiled file(s)' % (JSP, backup, removed))


if __name__ == '__main__':
    main()
