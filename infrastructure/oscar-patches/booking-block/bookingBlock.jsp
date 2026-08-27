<%--
  mymd/bookingBlock.jsp — same-origin proxy for the Master Chart's
  "Block online booking" button (injected into demographiceditdemographic.jsp by
  patch_booking_block_button.py).

  Proxies to the Health Assist app's /api/emr/oscar/booking-block endpoint so the
  shared secret stays on this box, in
  /var/lib/OscarDocument/oscar/mymd_booking_block.properties (tomcat:tomcat 600):

      app_base=https://physician.health-assist.org
      clinic_slug=mymd
      secret=<same value as the app's OSCAR_BOOKING_BLOCK_SECRET env var>

  Requests:
      GET  ?action=status&demographic_no=N            → {"blocked":true|false}
      POST ?action=block|unblock&demographic_no=N     → {"blocked":true|false}

  Only a logged-in OSCAR session may call it; the logged-in provider_no is passed
  along for the app's audit column.
--%>
<%@ page import="java.io.BufferedReader" %>
<%@ page import="java.io.File" %>
<%@ page import="java.io.FileInputStream" %>
<%@ page import="java.io.InputStream" %>
<%@ page import="java.io.InputStreamReader" %>
<%@ page import="java.io.OutputStream" %>
<%@ page import="java.net.HttpURLConnection" %>
<%@ page import="java.net.URL" %>
<%@ page import="java.util.Properties" %>
<%@ page import="org.oscarehr.util.LoggedInInfo" %>
<%@ page contentType="application/json;charset=UTF-8" %>
<%!
    private static final String PROPS_PATH = "/var/lib/OscarDocument/oscar/mymd_booking_block.properties";

    private Properties loadBlockProps() throws Exception {
        Properties p = new Properties();
        InputStream in = new FileInputStream(new File(PROPS_PATH));
        try { p.load(in); } finally { in.close(); }
        return p;
    }

    private String appCall(String method, String urlStr, String secret, String jsonBody) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(15000);
        conn.setRequestProperty("x-booking-block-secret", secret);
        conn.setRequestProperty("Accept", "application/json");
        if (jsonBody != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json");
            OutputStream os = conn.getOutputStream();
            try { os.write(jsonBody.getBytes("UTF-8")); } finally { os.close(); }
        }
        int code = conn.getResponseCode();
        InputStream in = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
        StringBuilder sb = new StringBuilder();
        if (in != null) {
            BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            try {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            } finally { r.close(); }
        }
        if (code < 200 || code >= 300) throw new Exception("app returned HTTP " + code + ": " + sb);
        return sb.toString();
    }
%>
<%
    LoggedInInfo loggedInInfo = LoggedInInfo.getLoggedInInfoFromSession(request);
    if (loggedInInfo == null) {
        response.setStatus(403);
        out.print("{\"error\":\"not logged in\"}");
        return;
    }

    String demoNo = request.getParameter("demographic_no");
    String action = request.getParameter("action");
    if (demoNo == null || !demoNo.matches("\\d{1,10}") ||
        action == null || !action.matches("status|block|unblock")) {
        response.setStatus(400);
        out.print("{\"error\":\"bad request\"}");
        return;
    }
    // Toggles must be POSTs — a GET that flips state invites accidental prefetch flips.
    if (!"status".equals(action) && !"POST".equalsIgnoreCase(request.getMethod())) {
        response.setStatus(405);
        out.print("{\"error\":\"toggle requires POST\"}");
        return;
    }

    try {
        Properties p = loadBlockProps();
        String base = p.getProperty("app_base", "").trim().replaceAll("/+$", "");
        String slug = p.getProperty("clinic_slug", "").trim();
        String secret = p.getProperty("secret", "").trim();
        if (base.isEmpty() || slug.isEmpty() || secret.isEmpty()) {
            throw new Exception("incomplete " + PROPS_PATH);
        }

        String result;
        if ("status".equals(action)) {
            result = appCall("GET",
                base + "/api/emr/oscar/booking-block?clinicSlug=" + java.net.URLEncoder.encode(slug, "UTF-8")
                     + "&demographicNo=" + demoNo,
                secret, null);
        } else {
            String providerNo = String.valueOf(loggedInInfo.getLoggedInProviderNo())
                .replaceAll("[^0-9A-Za-z_-]", "");
            String json = "{\"clinicSlug\":\"" + slug.replace("\\", "").replace("\"", "")
                + "\",\"demographicNo\":\"" + demoNo
                + "\",\"blocked\":" + ("block".equals(action))
                + ",\"providerNo\":\"" + providerNo + "\"}";
            result = appCall("POST", base + "/api/emr/oscar/booking-block", secret, json);
        }
        out.print(result);
    } catch (Exception e) {
        org.oscarehr.util.MiscUtils.getLogger().error("bookingBlock.jsp failed", e);
        response.setStatus(502);
        out.print("{\"error\":\"upstream\"}");
    }
%>
