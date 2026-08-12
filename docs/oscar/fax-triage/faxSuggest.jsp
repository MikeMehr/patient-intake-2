<%--
  MyMD: read an incoming fax and suggest how Incoming Docs should be filled in.

  Called by dms/incomingDocs.jsp (via mymd/aiPrefill.js) from the physician's own browser session.
  Reads the queued PDF off disk, sends it to Health Assist for OCR + AI, then resolves the
  identifiers that come back against THIS OSCAR's own tables.

  The AI never chooses a chart. It reports what it read on the page -- a name, a date of birth, a
  health number -- and the matching below decides whether that is good enough to preselect. Anything
  ambiguous comes back as candidates for the physician to click. Nothing here writes to a chart;
  the physician still presses Save on the normal OSCAR form.

  Fails soft, always: a missing config file, an unreachable app, a bad PDF or a model error all
  return {"reason":"..."} and the filing screen behaves exactly as it did before.

  Not in git's deploy path; a WAR redeploy wipes it. See docs/oscar/fax-triage-install.md.
--%>
<%@ page contentType="application/json; charset=UTF-8" trimDirectiveWhitespaces="true" %>
<%@ page import="java.io.*, java.sql.*, java.util.*, java.security.MessageDigest" %>
<%@ page import="java.net.HttpURLConnection, java.net.URL" %>
<%@ page import="org.oscarehr.util.DbConnectionFilter" %>
<%@ page import="oscar.dms.IncomingDocUtil" %>
<%@ page import="com.google.gson.Gson, com.google.gson.JsonObject, com.google.gson.JsonArray, com.google.gson.JsonParser, com.google.gson.JsonElement" %>
<%!
    static final String CONFIG_PATH = "/var/lib/OscarDocument/oscar/mymd_fax.properties";
    static final String ENDPOINT = "/api/emr/oscar/fax-triage";

    /** A demographic offered to the physician. */
    static class Demo {
        int no; String last, first, sex, dob, hin, mrp;
        String label() {
            return last + ", " + first + "  DOB " + dob + "  " + (sex == null ? "" : sex)
                 + (hin == null || hin.isEmpty() ? "" : "  PHN " + hin);
        }
    }

    static String nz(String s) { return s == null ? "" : s.trim(); }

    static String str(JsonObject o, String k) {
        if (o == null || !o.has(k) || o.get(k).isJsonNull()) return "";
        return nz(o.get(k).getAsString());
    }

    static JsonObject obj(JsonObject o, String k) {
        if (o == null || !o.has(k) || !o.get(k).isJsonObject()) return new JsonObject();
        return o.getAsJsonObject(k);
    }

    /** Opaque per-file handle. Sent off the box in place of the filename, which names the sender. */
    static String faxRef(String queueId, String dir, String name) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] d = md.digest((queueId + "|" + dir + "|" + name).getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 16; i++) sb.append(String.format("%02x", d[i]));
        return sb.toString();
    }

    static Demo readDemo(ResultSet rs) throws SQLException {
        Demo d = new Demo();
        d.no = rs.getInt(1); d.last = rs.getString(2); d.first = rs.getString(3);
        d.sex = rs.getString(4);
        d.dob = nz(rs.getString(5)) + "-" + nz(rs.getString(6)) + "-" + nz(rs.getString(7));
        d.hin = rs.getString(8);
        d.mrp = rs.getString(9);
        return d;
    }

    static final String DEMO_COLS =
        "SELECT demographic_no,last_name,first_name,sex,year_of_birth,month_of_birth,date_of_birth,hin,provider_no FROM demographic ";

    /** Same normalisation labImport.jsp uses: OSCAR stores the PHN digits-only. */
    static List<Demo> findByHin(Connection c, String hin) throws SQLException {
        List<Demo> out = new ArrayList<Demo>();
        if (nz(hin).isEmpty()) return out;
        PreparedStatement ps = c.prepareStatement(
            DEMO_COLS + "WHERE REPLACE(REPLACE(hin,' ',''),'-','') = ?");
        ps.setString(1, hin.replaceAll("[^0-9]", ""));
        ResultSet rs = ps.executeQuery();
        while (rs.next()) out.add(readDemo(rs));
        rs.close(); ps.close();
        return out;
    }

    /** dob is ISO yyyy-MM-dd; OSCAR keeps the three parts in separate columns. */
    static List<Demo> findByNameDob(Connection c, String last, String first, String dob) throws SQLException {
        List<Demo> out = new ArrayList<Demo>();
        if (nz(last).isEmpty() || nz(first).isEmpty() || nz(dob).length() != 10) return out;
        PreparedStatement ps = c.prepareStatement(
            DEMO_COLS + "WHERE LOWER(last_name)=LOWER(?) AND LOWER(first_name)=LOWER(?) "
            + "AND year_of_birth=? AND LPAD(month_of_birth,2,'0')=? AND LPAD(date_of_birth,2,'0')=?");
        ps.setString(1, last); ps.setString(2, first);
        ps.setString(3, dob.substring(0, 4));
        ps.setString(4, dob.substring(5, 7));
        ps.setString(5, dob.substring(8, 10));
        ResultSet rs = ps.executeQuery();
        while (rs.next()) out.add(readDemo(rs));
        rs.close(); ps.close();
        return out;
    }

    /**
     * Never auto-selected -- only ever offered for a click.
     *
     * The first name the fax gave is sorted to the top rather than used to filter: this clinic has
     * six charts surnamed TEST, and burying the obvious one alphabetically costs the physician the
     * time the feature was meant to save. Ranking is a hint; choosing is still theirs.
     */
    static List<Demo> findCandidates(Connection c, String last, String first) throws SQLException {
        List<Demo> out = new ArrayList<Demo>();
        if (nz(last).isEmpty()) return out;
        PreparedStatement ps = c.prepareStatement(
            DEMO_COLS + "WHERE LOWER(last_name)=LOWER(?) "
            + "ORDER BY (LOWER(first_name)=LOWER(?)) DESC, first_name LIMIT 8");
        ps.setString(2, nz(first));
        ps.setString(1, last);
        ResultSet rs = ps.executeQuery();
        while (rs.next()) out.add(readDemo(rs));
        rs.close(); ps.close();
        if (out.isEmpty() && !nz(first).isEmpty()) {
            PreparedStatement ps2 = c.prepareStatement(
                DEMO_COLS + "WHERE LOWER(last_name) LIKE LOWER(?) ORDER BY last_name, first_name LIMIT 8");
            ps2.setString(1, last + "%");
            ResultSet rs2 = ps2.executeQuery();
            while (rs2.next()) out.add(readDemo(rs2));
            rs2.close(); ps2.close();
        }
        return out;
    }

    static JsonObject providerRow(Connection c, String sql, String param) throws SQLException {
        PreparedStatement ps = c.prepareStatement(sql);
        ps.setString(1, param);
        ResultSet rs = ps.executeQuery();
        JsonObject found = null;
        int count = 0;
        while (rs.next()) {
            count++;
            if (count > 1) { found = null; break; }   // ambiguous: refuse rather than pick
            found = new JsonObject();
            found.addProperty("providerNo", rs.getString(1));
            found.addProperty("firstName", nz(rs.getString(2)));
            found.addProperty("lastName", nz(rs.getString(3)));
        }
        rs.close(); ps.close();
        return found;
    }
%><%
    response.setHeader("Cache-Control", "no-store");
    Gson gson = new Gson();
    JsonObject outJson = new JsonObject();

    String user = (String) session.getAttribute("user");
    if (user == null) {
        outJson.addProperty("reason", "no_session");
        out.print(gson.toJson(outJson));
        return;
    }

    String queueId = nz(request.getParameter("queueId"));
    String pdfDir  = nz(request.getParameter("pdfDir"));
    String pdfName = nz(request.getParameter("pdfName"));
    if (queueId.isEmpty()) queueId = "1";
    if (pdfDir.isEmpty()) pdfDir = "Fax";

    try {
        if (pdfName.isEmpty()) { outJson.addProperty("reason", "no_document"); out.print(gson.toJson(outJson)); return; }

        // --- config, fails closed ---------------------------------------------------------------
        Properties cfg = new Properties();
        File cfgFile = new File(CONFIG_PATH);
        if (!cfgFile.canRead()) { outJson.addProperty("reason", "not_configured"); out.print(gson.toJson(outJson)); return; }
        FileInputStream cfgIn = new FileInputStream(cfgFile);
        try { cfg.load(cfgIn); } finally { cfgIn.close(); }

        String baseUrl = nz(cfg.getProperty("healthassist.url"));
        String secret  = nz(cfg.getProperty("fax.secret"));
        boolean enabled = "true".equals(nz(cfg.getProperty("enabled")));
        if (!enabled || baseUrl.isEmpty() || secret.isEmpty()) {
            outJson.addProperty("reason", "disabled");
            out.print(gson.toJson(outJson));
            return;
        }

        // --- locate the PDF, confined to the queue directory -------------------------------------
        // pdfName arrives from the browser, so this check is load-bearing, not decorative.
        String dirPath = IncomingDocUtil.getIncomingDocumentFilePath(queueId, pdfDir);
        File dir = new File(dirPath).getCanonicalFile();
        File pdf = new File(dirPath, pdfName).getCanonicalFile();
        if (!pdf.getPath().startsWith(dir.getPath() + File.separator) || !pdf.isFile()) {
            outJson.addProperty("reason", "not_found");
            out.print(gson.toJson(outJson));
            return;
        }

        String ref = faxRef(queueId, pdfDir, pdfName);
        Connection conn = DbConnectionFilter.getThreadLocalDbConnection();

        // --- cache: one OCR+model call per physical fax ------------------------------------------
        String cached = null;
        PreparedStatement cps = conn.prepareStatement(
            "SELECT payload FROM mymd_fax_triage WHERE fax_ref=? AND payload IS NOT NULL");
        cps.setString(1, ref);
        ResultSet crs = cps.executeQuery();
        if (crs.next()) cached = crs.getString(1);
        crs.close(); cps.close();

        JsonObject ai;
        if (cached != null) {
            ai = JsonParser.parseString(cached).getAsJsonObject();
        } else {
            // --- the lists the model is allowed to choose from ------------------------------------
            JsonArray docTypes = new JsonArray();
            PreparedStatement ts = conn.prepareStatement(
                "SELECT doctype FROM ctl_doctype WHERE module='demographic' AND status<>'I' ORDER BY id");
            ResultSet trs = ts.executeQuery();
            while (trs.next()) docTypes.add(trs.getString(1));
            trs.close(); ts.close();

            // Consultant ReportA/B are one choice on the screen; offer the model the same one.
            JsonArray docClasses = new JsonArray();
            Set<String> seenClass = new LinkedHashSet<String>();
            PreparedStatement cs = conn.prepareStatement("SELECT DISTINCT reportclass FROM ctl_doc_class");
            ResultSet crs2 = cs.executeQuery();
            while (crs2.next()) {
                String rc = nz(crs2.getString(1));
                if (rc.equals("Consultant ReportA") || rc.equals("Consultant ReportB")) rc = "Consultant Report";
                if (!rc.isEmpty()) seenClass.add(rc);
            }
            crs2.close(); cs.close();
            for (String rc : seenClass) docClasses.add(rc);

            JsonArray provs = new JsonArray();
            PreparedStatement ps = conn.prepareStatement(
                "SELECT first_name,last_name,ohip_no FROM provider WHERE status='1' AND provider_no > 0");
            ResultSet prs = ps.executeQuery();
            while (prs.next()) {
                JsonObject p = new JsonObject();
                p.addProperty("name", (nz(prs.getString(1)) + " " + nz(prs.getString(2))).trim());
                p.addProperty("mspNumber", nz(prs.getString(3)));
                provs.add(p);
            }
            prs.close(); ps.close();

            // --- call Health Assist ---------------------------------------------------------------
            byte[] bytes = new byte[(int) pdf.length()];
            DataInputStream din = new DataInputStream(new FileInputStream(pdf));
            try { din.readFully(bytes); } finally { din.close(); }

            JsonObject req = new JsonObject();
            req.addProperty("faxRef", ref);
            req.addProperty("pdfBase64", Base64.getEncoder().encodeToString(bytes));
            req.addProperty("providerNo", user);
            req.add("docTypes", docTypes);
            req.add("docClasses", docClasses);
            req.add("knownProviders", provs);

            URL url = new URL(baseUrl.replaceAll("/+$", "") + ENDPOINT);
            HttpURLConnection http = (HttpURLConnection) url.openConnection();
            http.setRequestMethod("POST");
            http.setConnectTimeout(10000);
            // OCR polls Azure for up to 45s before the model even runs.
            http.setReadTimeout(150000);
            http.setDoOutput(true);
            http.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            http.setRequestProperty("x-mymd-fax-secret", secret);
            OutputStream os = http.getOutputStream();
            try { os.write(gson.toJson(req).getBytes("UTF-8")); } finally { os.close(); }

            int code = http.getResponseCode();
            InputStream is = (code >= 200 && code < 300) ? http.getInputStream() : http.getErrorStream();
            StringBuilder sb = new StringBuilder();
            if (is != null) {
                BufferedReader br = new BufferedReader(new InputStreamReader(is, "UTF-8"));
                String line;
                try { while ((line = br.readLine()) != null) sb.append(line); } finally { br.close(); }
            }
            http.disconnect();

            if (code < 200 || code >= 300) {
                PreparedStatement lg = conn.prepareStatement(
                    "INSERT INTO mymd_fax_triage (fax_ref,pdf_name,provider_no,reason) VALUES (?,?,?,?)");
                lg.setString(1, ref); lg.setString(2, pdfName); lg.setString(3, user);
                lg.setString(4, "http_" + code);
                try { lg.executeUpdate(); } catch (SQLException ignore) { /* duplicate ref */ }
                lg.close();
                outJson.addProperty("reason", "http_" + code);
                out.print(gson.toJson(outJson));
                return;
            }

            JsonElement parsed = JsonParser.parseString(sb.toString());
            ai = parsed.isJsonObject() ? parsed.getAsJsonObject() : new JsonObject();

            PreparedStatement ins = conn.prepareStatement(
                "INSERT INTO mymd_fax_triage (fax_ref,pdf_name,provider_no,reason,payload) VALUES (?,?,?,?,?)");
            ins.setString(1, ref); ins.setString(2, pdfName); ins.setString(3, user);
            ins.setString(4, str(ai, "reason"));
            ins.setString(5, sb.toString());
            try { ins.executeUpdate(); } catch (SQLException ignore) { /* raced another tab */ }
            ins.close();
        }

        // --- resolve the identifiers against THIS OSCAR ------------------------------------------
        JsonObject patientIn = obj(ai, "patient");
        String pLast = str(patientIn, "lastName");
        String pFirst = str(patientIn, "firstName");
        String pDob = str(patientIn, "dateOfBirth");
        String pPhn = str(patientIn, "phn");

        JsonObject patientOut = new JsonObject();
        JsonArray candidates = new JsonArray();
        Demo chosen = null;
        String matchBasis = "none";

        List<Demo> byHin = findByHin(conn, pPhn);
        if (byHin.size() == 1) {
            chosen = byHin.get(0); matchBasis = "phn";
        } else if (byHin.size() > 1) {
            for (Demo d : byHin) { JsonObject j = new JsonObject(); j.addProperty("demographicNo", d.no); j.addProperty("label", d.label()); candidates.add(j); }
        } else {
            List<Demo> byName = findByNameDob(conn, pLast, pFirst, pDob);
            if (byName.size() == 1) {
                chosen = byName.get(0); matchBasis = "name_dob";
            } else {
                List<Demo> cands = byName.isEmpty() ? findCandidates(conn, pLast, pFirst) : byName;
                for (Demo d : cands) { JsonObject j = new JsonObject(); j.addProperty("demographicNo", d.no); j.addProperty("label", d.label()); candidates.add(j); }
            }
        }

        patientOut.addProperty("matched", chosen != null);
        patientOut.addProperty("basis", matchBasis);
        patientOut.addProperty("readLastName", pLast);
        patientOut.addProperty("readFirstName", pFirst);
        patientOut.addProperty("readDob", pDob);
        patientOut.addProperty("readPhn", pPhn);
        if (chosen != null) {
            patientOut.addProperty("demographicNo", chosen.no);
            patientOut.addProperty("label", chosen.label());
            patientOut.addProperty("displayName", chosen.last + "," + chosen.first);
            patientOut.addProperty("mrpProviderNo", nz(chosen.mrp));
        }
        patientOut.add("candidates", candidates);

        // --- provider: the addressee if we can name them, else the chart's MRP -------------------
        JsonObject addressed = obj(ai, "addressedTo");
        String addrMsp = str(addressed, "mspNumber");
        String addrName = str(addressed, "name");

        JsonObject prov = null;
        String provSource = "none";
        if (!addrMsp.isEmpty()) {
            prov = providerRow(conn,
                "SELECT provider_no,first_name,last_name FROM provider WHERE ohip_no=? AND status='1'", addrMsp);
            if (prov != null) provSource = "addressee_msp";
        }
        if (prov == null && !addrName.isEmpty()) {
            // Surname only: "Dr. M. Mehraein", "Mehraein, Manucher" and "Dr Mehraein" all reduce to one word.
            String surname = "";
            String[] words = addrName.replaceAll("[^A-Za-z ,.'-]", " ").split("[ ,]+");
            for (String w : words) {
                String t = w.replaceAll("[.]", "");
                if (t.length() < 3) continue;
                if (t.equalsIgnoreCase("Dr") || t.equalsIgnoreCase("Doctor") || t.equalsIgnoreCase("Attention")) continue;
                if (t.length() > surname.length()) surname = t;
            }
            if (!surname.isEmpty()) {
                prov = providerRow(conn,
                    "SELECT provider_no,first_name,last_name FROM provider WHERE LOWER(last_name)=LOWER(?) AND status='1'", surname);
                if (prov != null) provSource = "addressee_name";
            }
        }
        if (prov == null && chosen != null && !nz(chosen.mrp).isEmpty()) {
            prov = providerRow(conn,
                "SELECT provider_no,first_name,last_name FROM provider WHERE provider_no=? AND status='1'", chosen.mrp);
            if (prov != null) provSource = "mrp";
        }
        JsonObject providerOut = new JsonObject();
        providerOut.addProperty("matched", prov != null);
        providerOut.addProperty("source", provSource);
        providerOut.addProperty("readName", addrName);
        if (prov != null) {
            providerOut.addProperty("providerNo", str(prov, "providerNo"));
            providerOut.addProperty("firstName", str(prov, "firstName"));
            providerOut.addProperty("lastName", str(prov, "lastName"));
        }

        JsonObject sug = new JsonObject();
        sug.addProperty("documentType", str(ai, "documentType"));
        sug.addProperty("documentClass", str(ai, "documentClass"));
        sug.addProperty("description", str(ai, "description"));
        sug.addProperty("observationDate", str(ai, "observationDate"));
        sug.addProperty("senderFacility", str(ai, "senderFacility"));
        sug.addProperty("confidence", str(ai, "confidence"));
        sug.addProperty("evidence", str(ai, "evidence"));

        outJson.addProperty("reason", cached != null ? "cached" : str(ai, "reason"));
        outJson.add("suggestion", sug);
        outJson.add("patient", patientOut);
        outJson.add("provider", providerOut);
        out.print(gson.toJson(outJson));

    } catch (Throwable t) {
        // A failure here must never take the filing screen with it.
        try {
            JsonObject err = new JsonObject();
            err.addProperty("reason", "error");
            out.print(gson.toJson(err));
        } catch (Exception ignore) { /* response already committed */ }
    }
%>
