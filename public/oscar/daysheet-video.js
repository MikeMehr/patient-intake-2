/*
 * Health Assist AI — video-visit button for the OSCAR day sheet.
 *
 * Installed on the OSCAR server with a single line before </body> of
 * provider/appointmentprovideradminday.jsp:
 *
 *   <script src="https://physician.health-assist.org/oscar/daysheet-video.js" defer></script>
 *
 * See docs/oscar/daysheet-video-install.md for the install and the post-WAR-redeploy checklist.
 *
 * What it does: puts a 🎥 beside every patient on the day sheet. Clicking it opens the Health
 * Assist video console for that appointment, creating the room on demand — so it works for
 * appointments typed straight into OSCAR, not just ones booked online.
 *
 * DIFFERENCE FROM echart-transcribe.js, which is deliberate and should not be "made
 * consistent": that one needs window.opener to post the finished note back to OSCAR, so it must
 * NOT pass noopener. This flow sends nothing back — the provider just lands in a video room —
 * so it DOES pass noopener, which is the safer default. Changing either to match the other
 * breaks one of them.
 */
(function () {
  "use strict";

  var APP_ORIGIN = "https://physician.health-assist.org";
  var LAUNCH_PATH = "/launch/oscar-video";
  var WINDOW_NAME = "healthassistVideo";
  var MARKER_CLASS = "haVideoBtn";

  /*
   * Verified on oscar.mymdonline.ca (provider/appointmentprovideradminday.jsp, the patient-name
   * link at ~line 2632): every booked appointment renders as
   *
   *   <a class="apptLink" href=# onClick="popupPage(790,801,
   *      '/oscar/appointment/appointmentcontrol.jsp?appointment_no=123&provider_no=101&...
   *       &demographic_no=456&displaymode=edit&dboperation=search');return false;" ...>NAME</a>
   *
   * so a single anchor carries both ids we need. Empty slots use a different link
   * (demographic_no=0, ~line 2542), and the regex below requires a non-zero demographic, so
   * they are skipped without needing to special-case them.
   */
  var APPT_LINK_SELECTOR = "a.apptLink";
  var APPT_NO_RE = /[?&]appointment_no=(\d+)/;
  var DEMO_NO_RE = /[?&]demographic_no=(\d+)/;

  function idsFor(link) {
    // The ids live in the onClick attribute, not href (href is literally "#"). Read the raw
    // attribute rather than link.onclick, whose function source is browser-dependent.
    var src = link.getAttribute("onClick") || link.getAttribute("onclick") || "";
    var appt = APPT_NO_RE.exec(src);
    var demo = DEMO_NO_RE.exec(src);
    if (!appt) return null;
    // demographic_no=0 marks a free slot with no patient — nothing to open a visit for.
    if (demo && demo[1] === "0") return null;
    return { apptNo: appt[1], demoNo: demo ? demo[1] : "" };
  }

  function openVideo(ids) {
    var url =
      APP_ORIGIN +
      LAUNCH_PATH +
      "?oscarApptNo=" +
      encodeURIComponent(ids.apptNo) +
      (ids.demoNo ? "&demographicNo=" + encodeURIComponent(ids.demoNo) : "");

    var width = 1180;
    var height = 920;
    var features =
      "width=" + width +
      ",height=" + height +
      ",left=" + Math.max(0, Math.floor((screen.width - width) / 2)) +
      ",top=" + Math.max(0, Math.floor((screen.height - height) / 2)) +
      ",resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=yes,status=no,noopener";

    var win = window.open(url, WINDOW_NAME, features);
    if (!win) {
      window.alert(
        "Your browser blocked the Health Assist video window.\n\n" +
          "Allow pop-ups for this site, then click the video icon again.",
      );
    }
  }

  function decorate(link) {
    // The day sheet re-renders on status changes, so guard against doubling up.
    if (link.nextSibling && link.nextSibling.className === MARKER_CLASS) return;

    var ids = idsFor(link);
    if (!ids) return;

    var btn = document.createElement("a");
    btn.className = MARKER_CLASS;
    btn.href = "#";
    btn.textContent = "🎥";
    btn.title = "Start a video visit with this patient";
    btn.style.cssText = "margin-left:4px;text-decoration:none;cursor:pointer;font-size:11px";
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      openVideo(ids);
      return false;
    };

    link.parentNode.insertBefore(btn, link.nextSibling);
  }

  function addButtons() {
    var links = document.querySelectorAll(APPT_LINK_SELECTOR);
    for (var i = 0; i < links.length; i++) decorate(links[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addButtons);
  } else {
    addButtons();
  }

  /*
   * The day sheet rewrites rows in place when an appointment status changes, which drops our
   * buttons. Re-decorating on mutation is cheaper and more reliable than hooking OSCAR's own
   * refresh, and decorate() is idempotent so repeats are free.
   */
  if (typeof MutationObserver === "function") {
    var scheduled = false;
    new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function () {
        scheduled = false;
        addButtons();
      }, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
