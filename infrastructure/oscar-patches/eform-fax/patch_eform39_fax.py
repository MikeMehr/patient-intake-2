"""Add a "Fax to MRI Central" button to the LM MRI Requisition eForm (fid=39).

The button saves the requisition (hidden iframe, so the doctor stays on the form) and
then opens eform/faxEformSend.jsp, where the destination and any chart documents to
send with it are confirmed. Destination defaults to MRI Central Intake 1-866-588-6955,
the number printed at the top of the form.

Also makes the print rule for .DoNotPrint !important. Without it the two
"CHECKLIST items required / not needed" banners print and fax on page 2, overlapping
each other in red and green: the document has no doctype, so it renders in quirks mode
where the class selector .show matches the form's own .Show rule, and that rule sits
later in source order than the print block.

form_html is a CRLF blob edited via HEX/UNHEX so nothing is mangled in transit.
"""

import subprocess
import time

FID = 39
STAMP = time.strftime('%Y%m%d%H%M%S')


def mysql_scalar(sql):
    return subprocess.check_output(['mysql', 'oscar_db', '-N', '--raw', '-e', sql]).decode().strip()


hexs = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % FID)
assert len(hexs) > 1000, 'form_html looks empty'
s = bytes.fromhex(hexs).decode('latin-1')

with open('/tmp/eform_fid%d_%s.hex' % (FID, STAMP), 'w') as fh:
    fh.write(hexs)


def crlf(t):
    return t.replace('\r\n', '\n').replace('\n', '\r\n')


FAX_JS = crlf(r'''
<!-- MyMD Aug2026: fax the saved requisition, plus any chart documents, to MRI Central -->
<script type="text/javascript">
	// Lower Mainland MRI Central Intake, the number printed at the top of this form
	var MRI_CENTRAL_FAX = "8665886955";

	function faxMRIReq() {
		var ovr = document.getElementById("fax_override");
		var manual = ovr ? ovr.value.replace(/[^0-9]/g, "") : "";
		if (manual.length == 11 && manual.charAt(0) == "1") { manual = manual.substring(1); }
		var dest = MRI_CENTRAL_FAX;
		if (manual.length == 10) {
			dest = manual;
		} else if (manual.length > 0) {
			alert("The fax number box has " + manual.length + " digits - enter a full 10-digit number, or clear it to fax MRI Central.");
			return;
		}

		// The same test the form uses for the page 2 checklist, so the fax window opens
		// on the right default instead of asking a question already answered here.
		var exam = document.getElementById("ExamRequested");
		var needChecklist = /\b(knee|knees|hip|hips|lumbar|l\-sp|l\-spine)\b/i.test(exam ? exam.value : "");

		function _qp(src, n) { var m = String(src).match(new RegExp("[?&]" + n + "=([^&]*)")); return m ? decodeURIComponent(m[1]) : ""; }
		var f = document.FormName;
		// The page URL carries these while the form is being created. Once it is saved it
		// is viewed as efmshowform_data.jsp?fdid=N and neither is in the URL - but OSCAR
		// always rewrites the form action to addEForm.do?efmfid=..&efmdemographic_no=..
		var demo = _qp(window.location.search, "demographic_no") || _qp(f.action, "efmdemographic_no");
		var theFid = _qp(window.location.search, "fid") || _qp(f.action, "efmfid");
		if (!demo || !theFid) { alert("Cannot tell which patient or form this is - open the form from the chart and try again."); return; }

		// origin + directory of this page: building the base off href would break on
		// any query string that contains a slash.
		var url = window.location.origin + window.location.pathname.replace(/[^\/]*$/, "")
			+ "faxEformSend.jsp?demographicNo=" + encodeURIComponent(demo)
			+ "&fid=" + encodeURIComponent(theFid)
			+ "&faxNumber=" + encodeURIComponent(dest)
			+ "&label=" + encodeURIComponent("MRI requisition")
			+ "&pageChoice=1&defaultPages=" + (needChecklist ? "all" : "1");

		// Opened HERE, on the click. Waiting until the save finishes means calling
		// window.open from an async callback, which the browser blocks outright - that
		// is exactly what happened the first time this button shipped.
		var win = window.open("", "faxEformSend", "width=780,height=800,scrollbars=yes,resizable=yes");
		if (!win) { alert("Your browser blocked the fax window. Allow pop-ups for this site, then click Fax to MRI Central again."); return; }
		function say(msg) { try { win.document.body.innerHTML = msg; } catch (e) {} }
		try {
			win.document.write("<html><body style=\"font:14px sans-serif;padding:24px;color:#333\">Saving the requisition...</body></html>");
			win.document.close();
		} catch (e) {}

		var btn = document.getElementById("FaxButton");
		if (btn) { btn.disabled = true; btn.value = "Saving..."; }
		function restore() { if (btn) { btn.disabled = false; btn.value = "Fax to MRI Central"; } }

		var ifr = document.getElementById("faxSaveFrame");
		if (!ifr) {
			ifr = document.createElement("iframe");
			ifr.name = "faxSaveFrame"; ifr.id = "faxSaveFrame"; ifr.style.display = "none";
			document.body.appendChild(ifr);
		}
		var prevTarget = f.target;
		var submitted = false, done = false;
		var timer = setTimeout(function () {
			if (done) { return; }
			done = true;
			restore();
			say("<span style=\"font:14px sans-serif;color:#8a1616\">The requisition did not finish saving, so there is nothing to fax yet. Close this window and try again.</span>");
		}, 20000);
		ifr.onload = function () {
			// fires once the requisition is in the chart - only then is there a saved
			// copy for the fax page to render
			if (!submitted || done) { return; }
			done = true;
			clearTimeout(timer);
			f.target = prevTarget;
			restore();
			try { win.location.replace(url); } catch (e) { window.open(url, "faxEformSend"); }
		};
		setFlag();
		try { releaseDirtyFlag(); } catch (e) {}
		f.target = "faxSaveFrame";
		submitted = true;
		f.submit();
	}
</script>

</head>''')

FAX_BUTTON = crlf('''
		<span style="border-left:1px solid #99b8d1; margin-left:6px; padding-left:8px;">
			<input value="Fax to MRI Central" name="FaxButton" id="FaxButton" type="button" style="background-color:#c6f0c6; font-weight:bold;" onClick="faxMRIReq();" title="Save this requisition, then choose the destination and any documents to send with it">
			<span style="font-size:11px;">or fax #: <input id="fax_override" size="11" type="text" placeholder="10-digit"></span>
		</span>''')

PRINT_BTN = ('\t\t<input value="Print pgs 1+2 & Submit" name="PrintSubmitButton2" id="PrintSubmitButton2"'
             ' type="button" onClick="printSubmit();" title="Required for Lumbar Spine, Knee, Hip MRI">')

edits = [
    # 1. the fax function, immediately before </head>
    ('</head>', FAX_JS),
    # 2. the button, at the end of the existing submit/print bar
    (PRINT_BTN, PRINT_BTN + FAX_BUTTON),
    # 3. stop .DoNotPrint elements leaking into print/fax when JS or .Show has shown them
    ('.DoNotPrint {display: none;}', '.DoNotPrint {display: none !important;}'),
]

for old, new in edits:
    n = s.count(old)
    assert n == 1, 'expected 1 match, found %d for %r' % (n, old[:60])
    s = s.replace(old, new)

blob = s.encode('latin-1')
with open('/tmp/upd_fid%d.sql' % FID, 'w') as fh:
    fh.write("UPDATE eform SET form_html=UNHEX('%s') WHERE fid=%d;\n" % (blob.hex(), FID))

subprocess.check_call('mysql oscar_db < /tmp/upd_fid%d.sql' % FID, shell=True)

after = mysql_scalar('SELECT HEX(form_html) FROM eform WHERE fid=%d' % FID)
assert after.lower() == blob.hex().lower(), 'written blob does not match - CHECK THE FORM'
print('fid=%d updated, %d -> %d bytes, hex backup /tmp/eform_fid%d_%s.hex'
      % (FID, len(hexs) // 2, len(blob), FID, STAMP))
