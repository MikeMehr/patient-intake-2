/*
 * MyMD: fill OSCAR's Incoming Docs form from an AI reading of the fax on screen.
 *
 * Runs on page load, asks mymd/faxSuggest.jsp what the fax says, and fills the boxes. Every field
 * it touches is tinted and captioned, and the tint clears the moment you edit it.
 *
 * It drives the page's OWN functions and fields rather than reimplementing them -- addflagprovider()
 * for the provider, the same hidden inputs the demographic autocomplete sets for the patient -- so
 * checkDocument() validation and the Save button gating keep working exactly as before.
 *
 * Nothing here files anything. The physician still presses Save & Next.
 *
 * Not in git's deploy path; a WAR redeploy wipes it. See docs/oscar/fax-triage-install.md.
 */
(function () {
  "use strict";

  var TINT = "#fff6d5";
  var banner, statusLine;

  function byId(id) { return document.getElementById(id); }

  /** OSCAR sets these to the string "undefined" when a chart has no MRP. */
  function usable(v) {
    return v !== null && v !== undefined && v !== "" && v !== "undefined" && v !== "null";
  }

  function tint(el) {
    if (!el) return;
    el.style.backgroundColor = TINT;
    var clear = function () {
      el.style.backgroundColor = "";
      el.removeEventListener("input", clear);
      el.removeEventListener("change", clear);
    };
    el.addEventListener("input", clear);
    el.addEventListener("change", clear);
  }

  function setText(el, value) {
    if (!el || !usable(value)) return false;
    el.value = value;
    tint(el);
    return true;
  }

  /** Match an option by value first, then by visible text. Both are case-insensitive. */
  function setSelect(el, value) {
    if (!el || !usable(value)) return false;
    var want = String(value).toLowerCase();
    var i, opt;
    for (i = 0; i < el.options.length; i++) {
      opt = el.options[i];
      if (String(opt.value).toLowerCase() === want) { el.selectedIndex = i; tint(el); return true; }
    }
    for (i = 0; i < el.options.length; i++) {
      opt = el.options[i];
      if (String(opt.text).trim().toLowerCase() === want) { el.selectedIndex = i; tint(el); return true; }
    }
    return false;
  }

  function enableSave() {
    var s = byId("save");
    if (!s) return;
    s.disabled = false;
    s.removeAttribute("disabled");
  }

  /** Mirrors what the demographic autocomplete's itemSelectEvent handler does. */
  function applyPatient(p) {
    if (!p || !p.matched) return false;
    var demofind = byId("demofind");
    var box = byId("autocompletedemo");
    if (!demofind) return false;
    demofind.value = p.demographicNo;
    var last = byId("lastdemographic_no");
    if (last) last.value = p.demographicNo;
    if (box) { box.value = p.displayName || p.label || ""; tint(box); }
    if (usable(p.mrpProviderNo)) {
      var mrpNo = byId("MRPNo");
      if (mrpNo) mrpNo.value = p.mrpProviderNo;
    }
    enableSave();
    return true;
  }

  function applyProvider(pr) {
    if (!pr || !pr.matched || !usable(pr.providerNo)) return false;
    if (typeof window.addflagprovider !== "function") return false;
    // Don't double-add if the page already flagged someone.
    var existing = document.getElementsByName("flagproviders");
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i].value) === String(pr.providerNo)) return true;
    }
    window.addflagprovider(pr.firstName || "", pr.lastName || "", pr.providerNo);
    return true;
  }

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.setAttribute("style", css);
    if (text !== undefined) e.appendChild(document.createTextNode(text));
    return e;
  }

  function ensureBanner() {
    if (banner) return banner;
    var form = byId("forms_");
    if (!form || !form.parentNode) return null;
    banner = el("div", "margin:4px 0;padding:6px 8px;border:1px solid #d9c37a;background:" + TINT +
                       ";font-size:11px;line-height:1.5;max-width:360px;");
    statusLine = el("div", "font-weight:bold;", "AI is reading this fax…");
    banner.appendChild(statusLine);
    form.parentNode.insertBefore(banner, form);
    return banner;
  }

  function say(text) {
    if (!ensureBanner()) return;
    statusLine.innerHTML = "";
    statusLine.appendChild(document.createTextNode(text));
  }

  function addLine(text, css) {
    if (!ensureBanner()) return;
    banner.appendChild(el("div", css || "font-weight:normal;color:#444;", text));
  }

  /** Candidates are click-to-apply; nothing is preselected. */
  function addCandidates(list) {
    if (!ensureBanner() || !list || !list.length) return;
    addLine("Possible patients — click to choose:", "font-weight:normal;color:#444;margin-top:4px;");
    var wrap = el("div", "margin-top:2px;");
    list.forEach(function (c) {
      var a = el("a", "display:block;color:#0a58ca;text-decoration:underline;cursor:pointer;padding:1px 0;", c.label);
      a.onclick = function () {
        applyPatient({ matched: true, demographicNo: c.demographicNo, label: c.label, displayName: c.label });
        say("Patient chosen by hand. Check the rest before saving.");
        return false;
      };
      wrap.appendChild(a);
    });
    banner.appendChild(wrap);
  }

  function render(data) {
    var s = data.suggestion || {};
    var filled = [];

    if (setSelect(byId("docType"), s.documentType)) filled.push("type");
    if (setSelect(byId("docClass"), s.documentClass)) filled.push("class");
    if (setText(byId("docDesc_0"), s.description)) filled.push("description");
    if (setText(byId("observationDate"), s.observationDate)) filled.push("date");
    if (applyPatient(data.patient)) filled.push("patient");
    if (applyProvider(data.provider)) filled.push("provider");

    if (!filled.length) {
      say("AI could not read anything usable from this fax.");
    } else {
      say("AI suggestion — check before saving.");
      addLine("Filled: " + filled.join(", ") + ".");
    }

    if (data.patient && !data.patient.matched) {
      var read = [data.patient.readLastName, data.patient.readFirstName].filter(Boolean).join(", ");
      if (read || data.patient.readPhn) {
        addLine("Read on the fax: " + (read || "(no name)") +
                (data.patient.readDob ? "  DOB " + data.patient.readDob : "") +
                (data.patient.readPhn ? "  PHN " + data.patient.readPhn : "") +
                " — no confident chart match.", "font-weight:normal;color:#8a4b00;");
      } else {
        addLine("No patient identified on this fax.", "font-weight:normal;color:#8a4b00;");
      }
      addCandidates(data.patient.candidates);
    }

    if (data.provider && !data.provider.matched) {
      addLine("No provider matched — flag one by hand.", "font-weight:normal;color:#8a4b00;");
    }
    if (s.senderFacility) addLine("From: " + s.senderFacility);
    if (s.evidence) addLine("“" + s.evidence + "”", "font-weight:normal;color:#666;font-style:italic;");
    if (s.confidence) addLine("Confidence: " + s.confidence);
  }

  function run() {
    var form = document.forms.PdfInfoForm;
    var pdfName = form && form.pdfName ? form.pdfName.value : "";
    var pdfDir = form && form.pdfDir ? form.pdfDir.value : "Fax";
    var queueEl = byId("queueList");
    var queueId = queueEl ? queueEl.value : "1";
    if (!pdfName) return;                       // nothing on screen to read

    ensureBanner();

    var params = "queueId=" + encodeURIComponent(queueId) +
                 "&pdfDir=" + encodeURIComponent(pdfDir) +
                 "&pdfName=" + encodeURIComponent(pdfName);

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "../mymd/faxSuggest.jsp", true);
    xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status !== 200) { say("AI suggestion unavailable."); return; }
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { say("AI suggestion unavailable."); return; }

      if (data.reason === "disabled" || data.reason === "not_configured") {
        if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
        banner = null;
        return;                                  // switched off: leave the screen untouched
      }
      if (data.reason === "no_text") { say("This fax scanned too poorly to read."); return; }
      if (!data.suggestion) { say("AI suggestion unavailable."); return; }
      render(data);
    };
    xhr.send(params);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(run, 0);
  } else {
    document.addEventListener("DOMContentLoaded", run);
  }
})();
