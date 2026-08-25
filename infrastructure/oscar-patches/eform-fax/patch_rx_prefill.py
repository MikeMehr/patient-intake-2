"""Let the Health Assist transcription page stage dictated prescriptions in Rx3.

Companion to patch_eform_prefill.py / patch_consultation_prefill.py, targeting
oscarRx/SearchDrug3.jsp. The Rx module is opened as
choosePatient.do?providerNo=&demographicNo=D&ha_prefill=B (struts FORWARD keeps
the query string), where B is base64url(JSON):
{v:1, fid:0, demographicNo, checks:[], fields:{}, rx:[{search,strength,sig,quantity,repeats}]}.

For each rx item, sequentially, the injected script replays exactly what a human
autocomplete pick does:

  1. POST searchDrug.do?method=jsonSearch (query=<search>) -> {results:[{name,id,isInactive}]}
  2. CONFIDENT-MATCH GATE: auto-add only a non-inactive result whose name contains
     every word of the dictated drug name AND every digit group of the dictated
     strength. (The drug search has historically returned wrong drugs outside
     category 13 / generic-name search - a fuzzy auto-pick is not acceptable.)
  3. Ajax.Updater('rxText', WriteScript.do?parameterValue=createNewRx, evalScripts)
     with our own randomId - identical to the page's own myHandler - then fill
     instructions_<rand> + parseIntr(), quantity_<rand> + updateQty(),
     repeats_<rand>, and updateCurrentInteractions().

Items that fail the gate (or whose search errors) are NOT added: the first one is
seeded into the search box and an amber banner lists every unmatched item with
its dictated sig, built with createTextNode only. The physician adds those by
hand from the real autocomplete, then reviews and prints/saves as usual -
nothing is ever signed or saved by this script.

SAFETY EXCEPTION: unlike the sibling prefill scripts, this one performs network
calls - two FIXED same-origin OSCAR endpoints, all params URL-encoded, replaying
what a human click does in the physician's own session. Spec data is never
eval'd or innerHTML'd. The custom-drug path (newCustomDrug) is deliberately
never used: it bypasses allergy/interaction checking.

Other guards match the siblings: strict no-op without ha_prefill, <=8KB param,
JSON.parse of base64url only, wrong-patient guard (spec.demographicNo vs the URL
demographicNo / the page's session-rendered hidden demographicNo input).

Being a webapp JSP, a WAR redeploy WIPES this patch - re-run after redeploys.

Run ON the OSCAR box:  sudo python3 patch_rx_prefill.py
"""

import os
import shutil
import time

JSP = '/opt/tomcat9/webapps/oscar/oscarRx/SearchDrug3.jsp'
WORK_DIR = '/opt/tomcat9/work/Catalina/localhost/oscar/org/apache/jsp/oscarRx'
STAMP = time.strftime('%Y%m%d%H%M%S')

ANCHOR = '</body>'

PREFILL_JS = r'''
<!-- MyMD Aug2026: stage dictated prescriptions from the Health Assist transcription page -->
<script type="text/javascript">
(function () {
	function _qp(n) { var m = String(window.location.search).match(new RegExp("[?&]" + n + "=([^&]*)")); return m ? decodeURIComponent(m[1]) : ""; }
	function _norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^\s+|\s+$/g, ""); }
	function _text(s) { return document.createTextNode(String(s)); }

	var demo = "";
	var manual = [];

	function pickConfident(results, item) {
		if (!results || !results.length) { return null; }
		var nameTokens = _norm(item.search).split(" ");
		var digitGroups = String(item.strength || "").match(/\d+(?:\.\d+)?/g) || [];
		for (var i = 0; i < results.length; i++) {
			var r = results[i];
			if (!r || !r.name) { continue; }
			if (r.isInactive === true || r.isInactive === "true") { continue; }
			var candidate = _norm(r.name);
			var ok = true;
			for (var t = 0; t < nameTokens.length && ok; t++) {
				if (nameTokens[t] && candidate.indexOf(nameTokens[t]) < 0) { ok = false; }
			}
			for (var d = 0; d < digitGroups.length && ok; d++) {
				if (candidate.indexOf(digitGroups[d]) < 0) { ok = false; }
			}
			if (ok) { return r; }
		}
		return null;
	}

	function fillRow(item, rand) {
		try {
			var instr = $('instructions_' + rand);
			if (instr && item.sig) { instr.value = item.sig; try { parseIntr(instr); } catch (e) {} }
			var q = $('quantity_' + rand);
			if (q && item.quantity) { q.value = item.quantity; try { updateQty(q); } catch (e) {} }
			var rep = $('repeats_' + rand);
			if (rep && item.repeats) { rep.value = item.repeats; }
			try { updateCurrentInteractions(); } catch (e) {}
		} catch (e) {}
		// The row's deferred init (or a late updateQty response) can still clobber
		// the quantity - re-assert it once after everything has settled.
		setTimeout(function () {
			try {
				var q2 = $('quantity_' + rand);
				if (q2 && item.quantity && q2.value !== item.quantity) {
					q2.value = item.quantity;
					try { updateQty(q2); } catch (e) {}
				}
			} catch (e) {}
		}, 1500);
	}

	function addDrug(item, match, next) {
		var rand = Math.floor(Math.random() * 1000000000);
		new Ajax.Updater('rxText', '/oscar/oscarRx/WriteScript.do?parameterValue=createNewRx', {
			method: 'get', evalScripts: true, insertion: Insertion.Bottom,
			parameters: 'demographicNo=' + encodeURIComponent(demo)
				+ '&drugId=' + encodeURIComponent(match.id)
				+ '&text=' + encodeURIComponent(match.name)
				+ '&randomId=' + rand,
			onComplete: function () {
				// Prototype evaluates the fragment's own inline scripts on a deferred
				// setTimeout AFTER this callback; filling immediately gets reset by the
				// row's init (seen live: quantity stomped back to 0). Fill after they run.
				setTimeout(function () { fillRow(item, rand); next(); }, 500);
			}
		});
	}

	function processNext(items, i) {
		if (i >= items.length) { finish(); return; }
		var item = items[i];
		if (!item || !item.search) { processNext(items, i + 1); return; }
		new Ajax.Request('/oscar/oscarRx/searchDrug.do?method=jsonSearch', {
			method: 'post',
			parameters: 'query=' + encodeURIComponent(item.search),
			onSuccess: function (t) {
				var match = null;
				try { match = pickConfident(JSON.parse(t.responseText).results, item); } catch (e) {}
				if (match) { addDrug(item, match, function () { processNext(items, i + 1); }); }
				else { manual.push(item); processNext(items, i + 1); }
			},
			onFailure: function () { manual.push(item); processNext(items, i + 1); }
		});
	}

	function finish() {
		if (!manual.length) { return; }
		var search = $('searchString');
		if (search) { search.value = manual[0].search; }
		var box = document.createElement('div');
		box.style.cssText = 'margin:8px 0;padding:8px 12px;border:2px solid #d97706;background:#fffbeb;font-family:sans-serif;font-size:13px;';
		var head = document.createElement('div');
		head.style.fontWeight = 'bold';
		head.appendChild(_text('Dictated but not auto-added - search and add manually:'));
		box.appendChild(head);
		for (var i = 0; i < manual.length; i++) {
			var m = manual[i];
			var line = document.createElement('div');
			line.appendChild(_text(
				m.search + (m.strength ? ' ' + m.strength : '') + ' - ' + (m.sig || '')
				+ (m.quantity ? ', qty ' + m.quantity : '') + ', repeats ' + (m.repeats || '0')));
			box.appendChild(line);
		}
		var rxText = $('rxText');
		if (rxText && rxText.parentNode) { rxText.parentNode.insertBefore(box, rxText); }
		else { document.body.insertBefore(box, document.body.firstChild); }
	}

	function haRx() {
		var raw = _qp("ha_prefill");
		if (!raw || raw.length > 8192) { return; }
		var spec;
		try {
			var b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
			while (b64.length % 4) { b64 += "="; }
			spec = JSON.parse(decodeURIComponent(escape(atob(b64))));
		} catch (e) { return; }
		if (!spec || spec.v !== 1 || !spec.rx || !spec.rx.length || !spec.rx.slice) { return; }

		demo = _qp("demographicNo");
		if (!demo) {
			var hidden = document.getElementsByName("demographicNo");
			if (hidden.length) { demo = hidden[0].value; }
		}
		if (!demo || String(spec.demographicNo) !== String(demo)) {
			alert("These prefilled prescriptions were prepared for a different patient - leaving the Rx pad untouched.");
			return;
		}
		processNext(spec.rx.slice(0, 10), 0);
	}

	function waitReady(attempt) {
		if (window.Ajax && window.$ && $('searchString') && $('rxText')) { haRx(); return; }
		if (attempt < 20) { setTimeout(function () { waitReady(attempt + 1); }, 300); }
	}

	if (window.addEventListener) { window.addEventListener("load", function () { waitReady(0); }, false); }
	else if (window.attachEvent) { window.attachEvent("onload", function () { waitReady(0); }); }
})();
</script>

'''


def main():
    with open(JSP, 'r', encoding='latin-1', newline='') as fh:
        s = fh.read()

    if 'haRx' in s:
        print('SearchDrug3.jsp already has the Rx prefill script - skipped')
        return

    n = s.count(ANCHOR)
    assert n == 1, 'expected 1 match for %r, found %d' % (ANCHOR, n)

    backup = JSP + '.oscarbak.' + STAMP
    shutil.copy2(JSP, backup)

    s = s.replace(ANCHOR, PREFILL_JS + ANCHOR)
    with open(JSP, 'w', encoding='latin-1', newline='') as fh:
        fh.write(s)

    removed = 0
    if os.path.isdir(WORK_DIR):
        for f in os.listdir(WORK_DIR):
            if f.startswith('SearchDrug3_jsp'):
                os.remove(os.path.join(WORK_DIR, f))
                removed += 1
    print('patched %s (backup %s), removed %d compiled file(s)' % (JSP, backup, removed))


if __name__ == '__main__':
    main()
