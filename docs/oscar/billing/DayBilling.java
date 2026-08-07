package mymd.billing;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.Period;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Works out what to bill for one provider's day.
 *
 * Everything here is read-only — nothing in this class writes to OSCAR. Discovery, note selection,
 * redaction, health-card rules and diagnostic-code validation all happen before anything is
 * offered to the physician, and the actual claim is written by {@link BillingWriter}.
 *
 * It also runs standalone, which is how it gets debugged:
 *
 * <pre>
 *   java -cp /tmp/billbuild:&lt;war classpath&gt; mymd.billing.DayBilling \
 *        --provider 101 --date 2026-08-06 [--no-llm] [--verbose]
 * </pre>
 *
 * That path needs no Tomcat, no session and no browser, and it writes nothing whatever the flags.
 */
public class DayBilling {

    // ---------------------------------------------------------------- fee codes

    /**
     * The GP telehealth *visit* codes, one per MSP age band.
     *
     * The clinic's shorthand is "always 13437", but 13437 is banded 2-49: billing it for a
     * 70-year-old both under-bills and trips OSCAR's own age validation. The bands themselves are
     * read from ctl_billingservice_age_rules rather than hard-coded here, so an MSP change to the
     * boundaries is picked up without touching this file. This list only says which codes are in
     * the family.
     *
     * Consultation (134x6) and counselling (134x8) are deliberately absent — those are clinical
     * judgements about the nature of the visit, not something to infer from a note.
     */
    static final List<String> VISIT_FEE_CODES =
            Arrays.asList("13237", "13437", "13537", "13637", "13737", "13837");

    /** Appointment statuses that mean the visit happened. OSCAR appends 'S' when signed off. */
    private static final Set<String> DONE_STATUSES = new HashSet<String>(Arrays.asList("F", "FS"));

    /** OSCAR's placeholder for "no PHN recorded". */
    private static final String PLACEHOLDER_HIN = "0000000000";

    private static final int[] BC_PHN_WEIGHTS = { 2, 4, 8, 5, 10, 9, 7, 3 };

    /** Keeps one very long chart note from crowding out the rest of the sweep. */
    private static final int MAX_NOTE_CHARS = 12000;

    static final int MAX_DX_CANDIDATES = 60;

    // ---------------------------------------------------------------- discovery

    /**
     * Appointments for this provider on this date that have no claim yet.
     *
     * The LEFT JOIN is on appointment_no, which billing carries and indexes on this box, so the
     * match is exact rather than a same-day guess. Deleted claims (status 'D') do not count as
     * billed — OSCAR's own delete sets that, and a deleted claim is exactly the case where you
     * want the visit to show up again.
     *
     * This join is a convenience for the physician, not a safety guarantee. The guarantee against
     * double-billing is the unique key on mymd_billing_log; see BillingWriter.
     */
    public List<BillingCandidate> discover(Connection c, String providerNo, String serviceDate)
            throws SQLException {
        String sql =
                "SELECT a.appointment_no, a.demographic_no, a.provider_no, a.appointment_date, "
              + "       a.start_time, a.status, "
              + "       d.last_name, d.first_name, d.hin, d.hc_type, "
              + "       d.year_of_birth, d.month_of_birth, d.date_of_birth "
              + "FROM appointment a "
              + "JOIN demographic d ON d.demographic_no = a.demographic_no "
              + "LEFT JOIN billing b ON b.appointment_no = a.appointment_no AND b.status <> 'D' "
              + "WHERE a.appointment_date = ? "
              + "  AND a.provider_no = ? "
              + "  AND a.demographic_no <> 0 "
              + "  AND b.billing_no IS NULL "
              + "ORDER BY a.start_time";

        List<BillingCandidate> out = new ArrayList<BillingCandidate>();
        PreparedStatement ps = c.prepareStatement(sql);
        ps.setString(1, serviceDate);
        ps.setString(2, providerNo);
        ResultSet rs = ps.executeQuery();
        while (rs.next()) {
            String status = nz(rs.getString("status")).trim();
            // Cancelled, no-show and still-to-come appointments are not billable visits.
            if (!DONE_STATUSES.contains(status)) continue;

            BillingCandidate bc = new BillingCandidate();
            bc.appointmentNo = rs.getInt("appointment_no");
            bc.demographicNo = rs.getInt("demographic_no");
            bc.providerNo = nz(rs.getString("provider_no"));
            bc.serviceDate = serviceDate;
            bc.startTime = nz(rs.getString("start_time"));
            bc.apptStatus = status;
            bc.patientName = nz(rs.getString("last_name")) + ", " + nz(rs.getString("first_name"));
            bc.ageAtService = ageAt(rs.getString("year_of_birth"), rs.getString("month_of_birth"),
                    rs.getString("date_of_birth"), serviceDate);
            applyHealthCard(bc, rs.getString("hin"), rs.getString("hc_type"));
            out.add(bc);
        }
        rs.close();
        ps.close();
        return out;
    }

    // ---------------------------------------------------------------- notes

    /** The current version of every note attached to this appointment, newest first. */
    public void loadNote(Connection c, BillingCandidate bc) throws SQLException {
        // casemgmt_note is append-only: editing a note inserts another row with the same uuid.
        // Reading it without this grouping returns the physician's first draft, or several copies
        // of the same note. On this box 93 notes over 90 days span 84 uuids, so it happens.
        String sql =
                "SELECT n.note, n.signed, n.update_date "
              + "FROM casemgmt_note n "
              + "JOIN ( SELECT uuid, MAX(note_id) AS keep_id FROM casemgmt_note "
              + "       WHERE appointmentNo = ? GROUP BY uuid ) latest "
              + "  ON latest.keep_id = n.note_id "
              + "WHERE COALESCE(n.archived, 0) = 0 "
              + "ORDER BY n.update_date DESC";

        StringBuilder text = new StringBuilder();
        int count = 0;
        boolean allSigned = true;

        PreparedStatement ps = c.prepareStatement(sql);
        ps.setInt(1, bc.appointmentNo);
        ResultSet rs = ps.executeQuery();
        while (rs.next()) {
            String note = nz(rs.getString("note")).trim();
            if (note.isEmpty()) continue;
            count++;
            if (rs.getInt("signed") != 1) allSigned = false;
            if (text.length() > 0) text.append("\n--- note ").append(count).append(" ---\n");
            text.append(note);
        }
        rs.close();
        ps.close();

        bc.noteCount = count;
        bc.noteSigned = count > 0 && allSigned;

        String body = text.toString();
        if (body.length() > MAX_NOTE_CHARS) body = body.substring(0, MAX_NOTE_CHARS);
        // Redact here, on the box, while the name is still in hand. Sending the name along so the
        // app could strip it would defeat the point.
        body = redactPatientName(body, bc.patientName);
        bc.noteText = scrubIdentifiers(body);
    }

    /**
     * Replace the patient's name with [REDACTED].
     *
     * Port of src/lib/redact-patient-name.ts; the cases are pinned in
     * src/lib/redact-patient-name.test.ts. Matches "First Last", "Last, First" and "Last,First",
     * case-insensitively. A bare first or last name is deliberately left alone — on its own it is
     * far too likely to be the physician's own name or an ordinary word.
     */
    static String redactPatientName(String text, String fullName) {
        if (text == null || text.isEmpty()) return nz(text);
        String trimmed = nz(fullName).trim();
        // discover() builds the name as "Last, First"; accept either shape.
        trimmed = trimmed.replace(",", " ").trim();
        if (trimmed.isEmpty()) return text;

        String[] parts = trimmed.split("\\s+");
        if (parts.length == 0) return text;
        String first = parts[0];
        String last = parts[parts.length - 1];

        List<String> patterns = new ArrayList<String>();
        patterns.add(first + " " + last);
        if (parts.length >= 2) {
            patterns.add(last + ", " + first);
            patterns.add(last + "," + first);
        }
        if (parts.length == 1) patterns.add(first);

        String result = text;
        for (String p : patterns) {
            result = Pattern.compile(Pattern.quote(p), Pattern.CASE_INSENSITIVE)
                    .matcher(result).replaceAll("[REDACTED]");
        }
        return result;
    }

    private static final Pattern TEN_DIGITS = Pattern.compile("\\b\\d{10}\\b");
    private static final Pattern PHONE = Pattern.compile("\\b\\d{3}[-. ]\\d{3}[-. ]\\d{4}\\b");
    private static final Pattern EMAIL = Pattern.compile("[\\w.+-]+@[\\w-]+\\.[\\w.-]+");

    /** Notes are full of health numbers, phone numbers and email addresses. None of it is needed. */
    static String scrubIdentifiers(String text) {
        if (text == null) return "";
        String out = EMAIL.matcher(text).replaceAll("[EMAIL]");
        out = PHONE.matcher(out).replaceAll("[PHONE]");
        out = TEN_DIGITS.matcher(out).replaceAll("[ID]");
        return out;
    }

    // ---------------------------------------------------------------- health card

    static boolean isValidBcPhn(String phn) {
        if (phn == null || !phn.matches("\\d{10}") || phn.charAt(0) != '9') return false;
        int sum = 0;
        for (int i = 0; i < BC_PHN_WEIGHTS.length; i++) {
            sum += (phn.charAt(i + 1) - '0') * BC_PHN_WEIGHTS[i];
        }
        int r = sum % 11;
        // 0 and 1 cannot yield a single-digit check value, so no such PHN is issued.
        if (r == 0 || r == 1) return false;
        return (11 - r) == (phn.charAt(9) - '0');
    }

    static boolean isValidOnHin(String digits) {
        if (digits == null || !digits.matches("\\d{10}")) return false;
        int sum = 0;
        boolean dbl = false;
        for (int i = digits.length() - 1; i >= 0; i--) {
            int d = digits.charAt(i) - '0';
            if (dbl) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
            dbl = !dbl;
        }
        return sum % 10 == 0;
    }

    /**
     * Decide what the card on the chart means for a claim.
     *
     * Mirrors src/lib/billing/health-card.ts — keep the two in step.
     *
     * Only a BC card that passes its check digit sets hinOk. Ontario is prepared with the letters
     * split off (billingmaster.phn is varchar(10), so they physically cannot go on the claim) but
     * still needs a tick, as does every other province.
     *
     * A blank hc_type counts as BC: most charts here carry none, and this is a BC clinic. The
     * check digit still has to pass, so that default cannot let a non-BC number through.
     */
    static void applyHealthCard(BillingCandidate bc, String rawHin, String hcType) {
        String card = nz(rawHin).replaceAll("[\\s-]", "").toUpperCase();
        String t = nz(hcType).trim().toUpperCase();
        String province = "ON".equals(t) ? "ON" : (t.isEmpty() || "BC".equals(t)) ? "BC" : "OTHER";
        bc.province = province;

        if (card.isEmpty() || PLACEHOLDER_HIN.equals(card)) {
            bc.hinOk = false;
            bc.hinProblem = "No health card number on the chart";
            return;
        }

        if ("ON".equals(province)) {
            Matcher m = Pattern.compile("^(\\d{10})([A-Z]{0,2})$").matcher(card);
            if (!m.matches()) {
                bc.hinOk = false;
                bc.hinProblem = "Ontario card is not 10 digits plus an optional 2-letter version code";
                return;
            }
            bc.claimHin = m.group(1);
            bc.versionCode = m.group(2);
            bc.hinOk = false; // out of province: prepared, never auto-billed
            bc.hinProblem = isValidOnHin(bc.claimHin)
                    ? "Ontario card - out of province, confirm before billing"
                    : "Ontario card fails its check digit";
            return;
        }

        if ("OTHER".equals(province)) {
            if (card.matches("\\d{10}")) bc.claimHin = card;
            bc.hinOk = false;
            bc.hinProblem = "Out-of-province card - confirm before billing";
            return;
        }

        // BC. Never strip letters here: a BC PHN with a letter in it is a data-entry error, and
        // reshaping it into a plausible 10-digit number would file a claim against a stranger.
        if (card.matches(".*[A-Z].*")) {
            bc.hinOk = false;
            bc.hinProblem = "BC PHN contains letters - check the chart";
            return;
        }
        if (!isValidBcPhn(card)) {
            if (card.matches("\\d{10}")) bc.claimHin = card;
            bc.hinOk = false;
            bc.hinProblem = card.length() == 10
                    ? "BC PHN fails its check digit"
                    : "BC PHN is " + card.length() + " digits, expected 10";
            return;
        }
        bc.claimHin = card;
        bc.hinOk = true;
    }

    static int ageAt(String year, String month, String day, String serviceDate) {
        try {
            LocalDate dob = LocalDate.of(Integer.parseInt(year.trim()),
                    Integer.parseInt(month.trim()), Integer.parseInt(day.trim()));
            return Period.between(dob, LocalDate.parse(serviceDate)).getYears();
        } catch (Exception e) {
            return -1;
        }
    }

    // ---------------------------------------------------------------- fee code

    /**
     * The GP telehealth visit code for this age, straight out of OSCAR's own age-rule table.
     *
     * Returns null when the age is unknown or no band covers it, which makes the row need a tick
     * rather than silently billing the wrong band.
     */
    public String[] pickFeeCode(Connection c, int age) throws SQLException {
        if (age < 0) return null;
        StringBuilder in = new StringBuilder();
        for (int i = 0; i < VISIT_FEE_CODES.size(); i++) in.append(i == 0 ? "?" : ",?");
        String sql =
                "SELECT r.service_code, s.description "
              + "FROM ctl_billingservice_age_rules r "
              + "JOIN billingservice s ON s.service_code = r.service_code "
              + "WHERE r.service_code IN (" + in + ") AND ? BETWEEN r.minAge AND r.maxAge "
              + "LIMIT 1";
        PreparedStatement ps = c.prepareStatement(sql);
        int i = 1;
        for (String code : VISIT_FEE_CODES) ps.setString(i++, code);
        ps.setInt(i, age);
        ResultSet rs = ps.executeQuery();
        String[] out = null;
        if (rs.next()) out = new String[] { rs.getString(1), nz(rs.getString(2)) };
        rs.close();
        ps.close();
        return out;
    }

    // ---------------------------------------------------------------- dx codes

    /** A diagnostic code offered to the model. */
    public static class DxOption {
        public final String code;
        public final String description;
        public DxOption(String code, String description) { this.code = code; this.description = description; }
    }

    /**
     * Build the list the model must choose from.
     *
     * Order matters, because the list is truncated: the patient's own coded diagnoses first (both
     * the likeliest answer and what OSCAR's billing form itself offers), then codes this clinic
     * has billed before — MSP has already accepted those, which is the only real evidence
     * available that a code is billable here — then description matches on words from the note.
     */
    public List<DxOption> buildDxCandidates(Connection c, int demographicNo, String noteText)
            throws SQLException {
        Map<String, DxOption> out = new LinkedHashMap<String, DxOption>();

        addDx(out, c,
                "SELECT DISTINCT r.dxresearch_code, i.description FROM dxresearch r "
              + "LEFT JOIN icd9 i ON i.icd9 = r.dxresearch_code "
              + "WHERE r.demographic_no = ? AND r.status = 'A' AND r.coding_system = 'icd9'",
                new Object[] { demographicNo });

        addDx(out, c,
                "SELECT m.dx_code1, i.description FROM billingmaster m "
              + "JOIN icd9 i ON i.icd9 = m.dx_code1 "
              + "WHERE m.dx_code1 <> '' GROUP BY m.dx_code1, i.description "
              + "ORDER BY COUNT(*) DESC LIMIT 40",
                new Object[0]);

        for (String word : keywords(noteText)) {
            if (out.size() >= MAX_DX_CANDIDATES) break;
            addDx(out, c,
                    "SELECT icd9, description FROM icd9 WHERE description LIKE ? LIMIT 8",
                    new Object[] { "%" + word + "%" });
        }

        List<DxOption> list = new ArrayList<DxOption>(out.values());
        return list.size() > MAX_DX_CANDIDATES ? list.subList(0, MAX_DX_CANDIDATES) : list;
    }

    private void addDx(Map<String, DxOption> into, Connection c, String sql, Object[] args)
            throws SQLException {
        PreparedStatement ps = c.prepareStatement(sql);
        for (int i = 0; i < args.length; i++) ps.setObject(i + 1, args[i]);
        ResultSet rs = ps.executeQuery();
        while (rs.next() && into.size() < MAX_DX_CANDIDATES) {
            String code = nz(rs.getString(1)).trim();
            String desc = nz(rs.getString(2)).trim();
            if (code.isEmpty() || desc.isEmpty()) continue;
            if (!into.containsKey(code)) into.put(code, new DxOption(code, desc));
        }
        rs.close();
        ps.close();
    }

    private static final Set<String> STOPWORDS = new HashSet<String>(Arrays.asList(
            "patient", "history", "today", "denies", "reports", "normal", "review", "follow",
            "discussed", "advised", "continue", "started", "assessment", "subjective", "objective",
            "there", "which", "with", "this", "that", "from", "have", "been", "were", "will",
            "redacted", "email", "phone"));

    /** Words worth looking up in the code descriptions. Crude on purpose — it only builds a list. */
    static List<String> keywords(String noteText) {
        List<String> out = new ArrayList<String>();
        if (noteText == null) return out;
        Set<String> seen = new LinkedHashSet<String>();
        Matcher m = Pattern.compile("[A-Za-z]{4,}").matcher(noteText);
        while (m.find()) {
            String w = m.group().toLowerCase();
            if (STOPWORDS.contains(w)) continue;
            if (seen.add(w) && seen.size() <= 12) out.add(w);
        }
        return out;
    }

    /**
     * Check a code against OSCAR's own table.
     *
     * The app already constrains the model to an enumerated list, but this is the boundary between
     * a language model and a government claim, so the box checks rather than trusts. Returns the
     * description when the code is real, null when it is not.
     */
    public String validateDx(Connection c, String code) throws SQLException {
        if (code == null || code.trim().isEmpty()) return null;
        PreparedStatement ps = c.prepareStatement("SELECT description FROM icd9 WHERE icd9 = ? LIMIT 1");
        ps.setString(1, code.trim());
        ResultSet rs = ps.executeQuery();
        String desc = rs.next() ? rs.getString(1) : null;
        rs.close();
        ps.close();
        return desc;
    }

    // ---------------------------------------------------------------- classification

    /**
     * Decide whether this row bills on its own or waits for a tick.
     *
     * AUTO requires all four: a BC card that passes its check digit, a signed note, a fee code for
     * the patient's age, and a diagnostic code that exists in OSCAR. Anything else is prepared and
     * offered, never billed unattended.
     */
    public void classify(BillingCandidate bc) {
        if (bc.noteCount == 0) {
            bc.disposition = BillingCandidate.Disposition.BLOCKED;
            bc.reason = "No chart note for this visit";
            return;
        }
        if (bc.claimHin.isEmpty()) {
            bc.disposition = BillingCandidate.Disposition.BLOCKED;
            bc.reason = bc.hinProblem.isEmpty() ? "No usable health card number" : bc.hinProblem;
            return;
        }
        if (bc.feeCode.isEmpty()) {
            bc.disposition = BillingCandidate.Disposition.NEEDS_TICK;
            bc.reason = bc.ageAtService < 0
                    ? "Date of birth missing - cannot pick the age-banded fee code"
                    : "No fee code covers age " + bc.ageAtService;
            return;
        }
        if (!bc.hinOk) {
            bc.disposition = BillingCandidate.Disposition.NEEDS_TICK;
            bc.reason = bc.hinProblem;
            return;
        }
        if (!bc.noteSigned) {
            bc.disposition = BillingCandidate.Disposition.NEEDS_TICK;
            bc.reason = "Chart note is not signed";
            return;
        }
        if (bc.dxFinal.isEmpty()) {
            bc.disposition = BillingCandidate.Disposition.NEEDS_TICK;
            bc.reason = "No diagnostic code matched - enter one";
            return;
        }
        if ("low".equals(bc.dxConfidence)) {
            bc.disposition = BillingCandidate.Disposition.NEEDS_TICK;
            bc.reason = "Diagnostic code is a low-confidence match - check it";
            return;
        }
        bc.disposition = BillingCandidate.Disposition.AUTO;
        bc.reason = "";
    }

    /**
     * Run the whole read-side sweep: discover, read notes, code, classify.
     *
     * Writes nothing. The review screen and the standalone harness both call this.
     */
    public List<BillingCandidate> sweep(Connection c, String providerNo, String serviceDate,
                                        DxClient dx, String runId) throws SQLException {
        List<BillingCandidate> rows = discover(c, providerNo, serviceDate);
        for (BillingCandidate bc : rows) {
            loadNote(c, bc);

            String[] fee = pickFeeCode(c, bc.ageAtService);
            if (fee != null) { bc.feeCode = fee[0]; bc.feeDescription = fee[1]; }

            if (bc.noteCount > 0 && dx != null) {
                List<DxOption> options = buildDxCandidates(c, bc.demographicNo, bc.noteText);
                if (!options.isEmpty()) {
                    DxClient.Suggestion s = dx.suggest(runId, bc, options);
                    if (s != null && !s.code.isEmpty() && !"NONE".equals(s.code)) {
                        bc.dxProposed = s.code;
                        bc.dxConfidence = s.confidence;
                        bc.dxEvidence = s.evidence;
                        // The app's answer is re-checked against this box's own table before it
                        // can reach a claim.
                        String desc = validateDx(c, s.code);
                        if (desc != null) {
                            bc.dxFinal = s.code;
                            bc.dxDescription = desc;
                            bc.dxSource = "ai";
                        } else {
                            bc.reason = "Suggested code " + s.code + " is not in OSCAR's code list";
                        }
                    }
                }
            }
            classify(bc);
        }
        return rows;
    }

    // ---------------------------------------------------------------- harness

    static String nz(String s) { return s == null ? "" : s; }

    /**
     * Standalone dry run. Prints the decision table and writes nothing, whatever the flags.
     *
     * Put the build directory FIRST on the classpath or the classes already deployed under
     * WEB-INF/classes will shadow the ones you just compiled.
     */
    public static void main(String[] args) throws Exception {
        String provider = null, date = null;
        boolean noLlm = false, verbose = false, showNames = false;
        for (int i = 0; i < args.length; i++) {
            if ("--provider".equals(args[i]) && i + 1 < args.length) provider = args[++i];
            else if ("--date".equals(args[i]) && i + 1 < args.length) date = args[++i];
            else if ("--no-llm".equals(args[i])) noLlm = true;
            else if ("--verbose".equals(args[i])) verbose = true;
            else if ("--names".equals(args[i])) showNames = true;
        }
        if (provider == null || date == null) {
            System.err.println("usage: DayBilling --provider <no> --date <yyyy-MM-dd> "
                    + "[--no-llm] [--verbose] [--names]");
            System.exit(2);
        }

        Config cfg = Config.load();
        Class.forName("com.mysql.cj.jdbc.Driver");
        Connection c = DriverManager.getConnection(cfg.jdbcUrl, cfg.dbUser, cfg.dbPassword);

        DayBilling db = new DayBilling();
        DxClient dx = noLlm ? null : new DxClient(cfg);
        String runId = "dryrun-" + System.currentTimeMillis();

        List<BillingCandidate> rows = db.sweep(c, provider, date, dx, runId);

        System.out.println("Day billing dry run - provider " + provider + ", " + date
                + (noLlm ? "  [no LLM]" : "") + "   run " + runId);
        System.out.println("NOTHING IS WRITTEN BY THIS COMMAND.");
        System.out.println();
        System.out.printf("%-8s %-22s %-4s %-7s %-11s %-6s %-9s %s%n",
                "Appt", "Patient", "Age", "Fee", "PHN", "Dx", "State", "Reason");
        System.out.println(repeat('-', 110));

        int auto = 0, tick = 0, blocked = 0;
        for (BillingCandidate bc : rows) {
            switch (bc.disposition) {
                case AUTO: auto++; break;
                case NEEDS_TICK: tick++; break;
                default: blocked++; break;
            }
            System.out.printf("%-8d %-22s %-4s %-7s %-11s %-6s %-9s %s%n",
                    bc.appointmentNo,
                    showNames ? trunc(bc.patientName, 22) : initials(bc.patientName),
                    bc.ageAtService < 0 ? "?" : String.valueOf(bc.ageAtService),
                    bc.feeCode.isEmpty() ? "-" : bc.feeCode,
                    bc.claimHin.isEmpty() ? "-" : maskHin(bc.claimHin),
                    bc.dxFinal.isEmpty() ? "-" : bc.dxFinal,
                    bc.disposition,
                    bc.reason);
            if (verbose) {
                System.out.println("         notes=" + bc.noteCount + " signed=" + bc.noteSigned
                        + " province=" + bc.province + " status=" + bc.apptStatus
                        + " conf=" + bc.dxConfidence + " dxSrc=" + bc.dxSource);
            }
        }
        System.out.println();
        System.out.println("would auto-bill: " + auto + "   needs a tick: " + tick
                + "   not billable: " + blocked + "   total: " + rows.size());
        c.close();
    }

    /**
     * Initials only.
     *
     * The review screen shows full names — the physician has to know who they are billing. This is
     * the command-line harness, which gets run over and over while debugging and lands in terminal
     * scrollback and shell history, so it identifies a row by appointment number and shows no more
     * of the name than that. Pass --names when you genuinely need them.
     */
    static String initials(String lastCommaFirst) {
        StringBuilder sb = new StringBuilder();
        for (String part : nz(lastCommaFirst).split("[,\\s]+")) {
            if (!part.isEmpty()) sb.append(Character.toUpperCase(part.charAt(0))).append('.');
        }
        return sb.length() == 0 ? "?" : sb.toString();
    }

    /** Enough to recognise a row on screen, not enough to be a health number. */
    static String maskHin(String hin) {
        if (hin.length() < 10) return hin;
        return hin.substring(0, 3) + "****" + hin.substring(7);
    }

    private static String trunc(String s, int n) {
        return s.length() <= n ? s : s.substring(0, n - 1) + "…";
    }

    private static String repeat(char ch, int n) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) sb.append(ch);
        return sb.toString();
    }
}
