/*
 * Health Assist AI — "Transcribe" button for the OSCAR eChart encounter window.
 *
 * Installed on the OSCAR server with a single line before </body> of the
 * encounter JSP:
 *
 *   <script src="https://physician.health-assist.org/oscar/echart-transcribe.js" defer></script>
 *
 * See docs/oscar/echart-transcribe-install.md for the install and the
 * post-WAR-redeploy checklist.
 *
 * What it does:
 *   1. Adds a Transcribe button to the encounter toolbar.
 *   2. Opens the Health Assist transcription page in a popup, carrying the
 *      current demographic number.
 *   3. Receives the finished note back via postMessage and APPENDS it to the
 *      encounter note textarea.
 *
 * It deliberately does NOT save the encounter. The physician reviews the text
 * and clicks OSCAR's own Save, so OSCAR remains the system of record and no
 * OSCAR write API is involved.
 */
(function () {
  "use strict";

  var APP_ORIGIN = "https://physician.health-assist.org";
  var LAUNCH_PATH = "/launch/oscar";
  var MAX_TEXT = 200000;
  var WINDOW_NAME = "healthassistTranscribe";

  // ── Current patient ───────────────────────────────────────────────────
  // Verified on oscar.mymdonline.ca (newEncounterLayout.jsp): the page defines
  // a JS global `demographicNo`, and `caseManagementEntryForm` carries a
  // demographicNo field. Other builds vary, so keep the fallback chain.
  function currentDemographicNo() {
    var form = document.forms["caseManagementEntryForm"];
    var el =
      (form && (form.demographicNo || form.demographic_no)) ||
      document.getElementById("demographicNo") ||
      document.querySelector('input[name="demographic_no"],input[name="demographicNo"]');
    if (el && el.value) return String(el.value).trim();
    if (typeof window.demographicNo === "string" && /^\d+$/.test(window.demographicNo)) {
      return window.demographicNo;
    }
    var m =
      /[?&]demographicNo=(\d+)/.exec(window.location.search) ||
      /[?&]demographic_no=(\d+)/.exec(window.location.search);
    return m ? m[1] : "";
  }

  // ── The encounter note field ──────────────────────────────────────────
  // Verified on oscar.mymdonline.ca: the eChart creates ONE note editor at a
  // time with a dynamic id "caseNote_note<noteId>", and keeps that id in the
  // JS global `caseNote` (see js/newCaseManagementView.js.jsp). The plain
  // "caseNote_note" id is the older CaseManagementEntry.jsp form.
  function noteTextarea() {
    if (typeof window.caseNote === "string" && window.caseNote) {
      var active = document.getElementById(window.caseNote);
      if (active && active.tagName === "TEXTAREA") return active;
    }
    var dyn = document.querySelector('textarea[id^="caseNote_note"]');
    if (dyn) return dyn;
    var form = document.forms["caseManagementEntryForm"];
    return (
      document.getElementById("caseNote_note") ||
      document.querySelector('textarea[name="caseNote_note"]') ||
      (form && form.querySelector ? form.querySelector("textarea") : null) ||
      null
    );
  }

  // ── Launch ────────────────────────────────────────────────────────────
  var popup = null;

  function openTranscribe() {
    var demo = currentDemographicNo();
    if (!demo) {
      window.alert("Could not determine which patient this chart is for.");
      return;
    }

    // Reuse the named window so a second click focuses the existing session
    // instead of orphaning a half-finished dictation.
    if (popup && !popup.closed) {
      popup.focus();
      return;
    }

    var url =
      APP_ORIGIN +
      LAUNCH_PATH +
      "?demographicNo=" +
      encodeURIComponent(demo) +
      "&origin=" +
      encodeURIComponent(window.location.origin);

    var width = 1180;
    var height = 920;
    var features =
      "width=" + width +
      ",height=" + height +
      ",left=" + Math.max(0, Math.floor((screen.width - width) / 2)) +
      ",top=" + Math.max(0, Math.floor((screen.height - height) / 2)) +
      ",resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=yes,status=no";

    // NOTE: no "noopener". window.opener is what carries the finished note
    // back to this page; adding noopener silently breaks the whole feature.
    popup = window.open(url, WINDOW_NAME, features);

    if (!popup) {
      window.alert(
        "Your browser blocked the Health Assist window.\n\n" +
          "Allow pop-ups for this site, then click Transcribe again.",
      );
    }
  }

  // ── Button ────────────────────────────────────────────────────────────
  // The eChart header (newEncounterHeader.jsp) renders a "Next Appt:" link
  // with an inline font-size of 14.3px. The button sits right beside it, and
  // both are drawn ~20% smaller than the header default per Dr. Mehraein's
  // preference (button ≈10px, Next Appt 14.3px → 11.4px).
  function findNextApptLink() {
    var header = document.getElementById("header");
    if (!header) return null;
    var links = header.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
      if (/next\s*appt/i.test(links[i].textContent || "")) return links[i];
    }
    return null;
  }

  function openDocumentsPage() {
    // Regular named window (not the transcription popup) — the Documents
    // dashboard is a full page for sending photo/document requests to
    // patients. Reusing the name focuses an already-open window.
    //
    // Routed through /launch/oscar (the SameSite=Strict bounce) exactly like
    // Transcribe: opening /org/documents directly is a cross-site navigation,
    // so the session cookie would be withheld and a logged-in doctor would
    // still land on the org login page.
    var win = window.open(APP_ORIGIN + LAUNCH_PATH + "?target=documents", "healthassistDocs");
    if (!win) {
      window.alert(
        "Your browser blocked the Health Assist window.\n\n" +
          "Allow pop-ups for this site, then click Request Docs again.",
      );
    }
  }

  function makeHeaderButton(id, label, title, background, onClick) {
    var btn = document.createElement("button");
    btn.id = id;
    btn.type = "button";
    btn.textContent = label;
    btn.title = title;
    btn.style.cssText =
      "margin:0 0 0 6px;padding:2px 8px;cursor:pointer;font:10px sans-serif;" +
      "border:1px solid " + background + ";background:" + background + ";color:#fff;" +
      "border-radius:4px;vertical-align:middle";
    btn.onclick = onClick;
    return btn;
  }

  function addButton() {
    if (document.getElementById("haTranscribeBtn")) return;

    var transcribeBtn = makeHeaderButton(
      "haTranscribeBtn",
      "Transcribe",
      "Dictate this encounter with Health Assist AI",
      "#047857",
      openTranscribe,
    );
    var docsBtn = makeHeaderButton(
      "haRequestDocsBtn",
      "Request Docs",
      "Request photos or documents from the patient via Health Assist",
      "#1d4ed8",
      openDocumentsPage,
    );

    var nextAppt = findNextApptLink();
    if (nextAppt) {
      // Shrink the Next Appt link by ~20% (inline 14.3px → 11.4px), then put
      // the buttons immediately after it on the same line.
      nextAppt.style.fontSize = "11.4px";
      var span = nextAppt.querySelector("span");
      if (span) span.style.fontSize = "11.4px";
      nextAppt.parentNode.insertBefore(docsBtn, nextAppt.nextSibling);
      nextAppt.parentNode.insertBefore(transcribeBtn, docsBtn);
      return;
    }

    // Fallbacks for layouts without the Next Appt header link.
    var host =
      document.getElementById("header") ||
      document.getElementById("encounterToolbar") ||
      document.querySelector(".EncounterTitleBar") ||
      document.getElementById("topBar");
    if (host) {
      host.appendChild(transcribeBtn);
      host.appendChild(docsBtn);
    } else {
      transcribeBtn.style.cssText += ";position:fixed;top:6px;right:8px;z-index:99999";
      docsBtn.style.cssText += ";position:fixed;top:6px;right:90px;z-index:99999";
      document.body.appendChild(transcribeBtn);
      document.body.appendChild(docsBtn);
    }
  }

  // ── Receive the finished note ─────────────────────────────────────────
  window.addEventListener(
    "message",
    function (event) {
      // Pin the sender. Without this any page could inject text into a chart.
      if (event.origin !== APP_ORIGIN) return;

      var data = event.data;
      if (!data || data.source !== "healthassist") return;
      if (data.type !== "healthassist.soap.insert") return;
      if (typeof data.text !== "string" || !data.text) return;
      if (data.text.length > MAX_TEXT) return;

      // Wrong-patient guard: the doctor may have navigated this window to a
      // different chart while dictating. Never paste a note into the wrong one.
      var demo = currentDemographicNo();
      if (String(data.demographicNo || "") !== String(demo)) {
        window.alert(
          "This note was dictated for a different patient than the chart now open.\n\n" +
            "Nothing was inserted.",
        );
        return;
      }

      var ta = noteTextarea();
      if (!ta) {
        window.alert(
          "No encounter note is open in this chart.\n\n" +
            "Open (or start) a note in the eChart, then click Send to OSCAR note again — " +
            "or use Copy SOAP and paste it in.",
        );
        return;
      }

      // Insert ABOVE any existing content, never replace. OSCAR's Rx module
      // writes prescriptions into the open note before the doctor dictates, so
      // prepending keeps the SOAP (Subjective/Objective/Assessment/Plan) on
      // top and the prescription below the plan — the order Dr. Mehraein
      // wants. Anything already typed in the note survives, just lower down.
      var existing = ta.value;
      ta.value = data.text + "\n" + (existing && existing.trim() ? "\n" + existing : "");

      // Let OSCAR's dirty-tracking / autosave notice the change.
      try {
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (e) {}
      try {
        ta.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {}

      // The note was inserted at the top, so show the top.
      ta.focus();
      try {
        ta.selectionStart = ta.selectionEnd = 0;
      } catch (e) {}
      ta.scrollTop = 0;

      // Acknowledge, so the popup knows the text actually landed. Without this
      // it would mark the note exported even when nothing was inserted.
      try {
        event.source.postMessage(
          {
            source: "oscar",
            type: "healthassist.soap.ack",
            requestId: data.requestId,
          },
          event.origin,
        );
      } catch (e) {}
    },
    false,
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addButton);
  } else {
    addButton();
  }
})();
