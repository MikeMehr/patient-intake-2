package mymd.billing;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletRequestWrapper;
import javax.servlet.http.HttpServletResponse;

/**
 * Writes one MSP claim, by driving OSCAR's own billing actions in process.
 *
 * <h3>Why replay rather than INSERT</h3>
 *
 * A BC claim is not one row. OSCAR's flow is three Struts actions sharing a BillingSessionBean:
 *
 * <pre>
 *   /billing.do                      BillingAction.fillBean()      builds the session bean
 *   /billing/CA/BC/CreateBilling.do  BillingCreateBillingAction    validates (age bands, dx list,
 *                                                                  service-code rules, last-billed)
 *   /billing/CA/BC/SaveBilling.do    BillingSaveBillingAction      saveBill() -> billing +
 *                                                                  billingmaster + archive
 * </pre>
 *
 * Replaying those gives every side effect OSCAR performs, every validation MSP requires, and
 * whatever an OSCAR upgrade changes about either — none of which could be kept correct by hand.
 * In particular {@code BillingCreateBillingAction.validateServiceCodeList} is what enforces the
 * telehealth age bands, so a mis-picked fee code is refused here rather than by MSP six weeks on.
 *
 * The dispatch is in-process, not an HTTP call to ourselves: same session, same thread-local
 * connection, no second login, no self-signed-certificate problem, no CSRF token to forge.
 *
 * <h3>What guarantees no double claim</h3>
 *
 * Not the "unbilled" query on the review screen — that is a convenience and it is racy. The
 * guarantee is the unique key on mymd_billing_log(appointment_no, service_date, fee_code). The log
 * row is written BEFORE the claim; a duplicate hits the constraint, nothing is dispatched, and the
 * row reports ALREADY BILLED. Double-clicking cannot produce a second claim.
 *
 * <h3>Unverified until the capture is done</h3>
 *
 * The parameter names below come from billingBC.jsp's Struts properties and the form bean's
 * setters, but the exact VALUES OSCAR sends for a real 13437 have not been captured yet. Until
 * that is done and diffed, {@link Config#dryRun} stays true and this class writes no claim — it
 * records what it would have sent. See docs/oscar/day-billing-install.md, "Verify before billing".
 */
public class BillingWriter {

    private final Config cfg;

    public BillingWriter(Config cfg) {
        this.cfg = cfg;
    }

    /** Outcome of one attempted claim. */
    public static class Result {
        public final String decision;   // BILLED | DRYRUN | DUPLICATE | ERROR
        public final int billingNo;     // -1 when none was created
        public final String detail;
        Result(String decision, int billingNo, String detail) {
            this.decision = decision;
            this.billingNo = billingNo;
            this.detail = detail;
        }
    }

    /**
     * Supplies synthesised parameters to a Struts action without touching the real request.
     *
     * Struts reads the claim entirely through getParameter/getParameterValues/getParameterMap, so
     * overriding those three is enough to make the action believe a physician submitted the form.
     * The wrapped request keeps the real session, so BillingSessionBean, the logged-in provider and
     * the security context are all the genuine ones.
     */
    static class ParamRequest extends HttpServletRequestWrapper {
        private final Map<String, String[]> params;

        ParamRequest(HttpServletRequest real, Map<String, String> values) {
            super(real);
            this.params = new HashMap<String, String[]>();
            for (Map.Entry<String, String> e : values.entrySet()) {
                this.params.put(e.getKey(), new String[] { e.getValue() == null ? "" : e.getValue() });
            }
        }

        @Override public String getMethod() { return "POST"; }
        @Override public String getParameter(String name) {
            String[] v = params.get(name);
            return v == null || v.length == 0 ? null : v[0];
        }
        @Override public String[] getParameterValues(String name) { return params.get(name); }
        @Override public Map<String, String[]> getParameterMap() {
            return Collections.unmodifiableMap(params);
        }
        @Override public java.util.Enumeration<String> getParameterNames() {
            return Collections.enumeration(params.keySet());
        }
    }

    /**
     * Parameters for /billing.do — the step that builds the session bean from the appointment.
     * Mirrors the link billingBC.jsp itself builds (see its billing.do hrefs).
     */
    static Map<String, String> beanParams(BillingCandidate bc, String creator) {
        Map<String, String> p = new LinkedHashMap<String, String>();
        p.put("billRegion", "BC");
        p.put("billForm", "GP");
        p.put("hotclick", "");
        p.put("appointment_no", String.valueOf(bc.appointmentNo));
        p.put("demographic_no", String.valueOf(bc.demographicNo));
        p.put("demographic_name", bc.patientName);
        p.put("user_no", creator);
        p.put("apptProvider_no", bc.providerNo);
        p.put("providerview", bc.providerNo);
        p.put("appointment_date", bc.serviceDate);
        p.put("status", bc.apptStatus);
        p.put("start_time", bc.startTime);
        p.put("bNewForm", "1");
        p.put("billType", "MSP");
        return p;
    }

    /**
     * Parameters for /billing/CA/BC/CreateBilling.do.
     *
     * Names are the Struts property names on BillingCreateBillingForm, read off billingBC.jsp.
     * Only the fields this clinic's virtual visits actually use are set; everything else is left
     * to the form's own defaults rather than guessed at.
     */
    static Map<String, String> claimParams(BillingCandidate bc, String serviceLocation) {
        Map<String, String> p = new LinkedHashMap<String, String>();
        // The fee code travels in xml_other1, NOT in `service`.
        //
        // billingBC.jsp's fee-code checkboxes are only a picker: ticking one runs JS that copies
        // the code into the xml_other1 text box (`myform.xml_other1.value = svcCode`), and that box
        // is what the form actually submits. BillingCreateBillingAction never reads the form's
        // `service` array at all -- it passes a hardcoded `new String[0]` to
        // BillingBillingManager.getDups2 and builds the bill items from xml_other1/2/3 alone.
        //
        // Sending `service` therefore left the item list empty, and BillingSaveBillingAction
        // iterates that list to write the claim: zero items, zero rows, and it still forwards to
        // "success". That is the silent "OSCAR reported no error but no claim was created" -- the
        // appointment gets flipped to Billed with nothing behind it.
        p.put("xml_other1", bc.feeCode);
        // getDups2 substitutes "1" when the unit is blank, but be explicit rather than lean on it.
        p.put("xml_other1_unit", "1");
        p.put("xml_diagnostic_detail1", bc.dxFinal);
        p.put("xml_diagnostic_detail2", "");
        p.put("xml_diagnostic_detail3", "");
        p.put("xml_vdate", bc.serviceDate);
        p.put("xml_appointment_date", bc.serviceDate);
        p.put("xml_provider", bc.providerNo);
        // Service location: 'V' (exclusively virtual) is this clinic's default, set by the
        // `visittype` property in oscar_mcmaster.properties.
        p.put("xml_visittype", serviceLocation);
        p.put("xml_billtype", "MSP");
        p.put("submissionCode", "0");
        p.put("afterHours", "0");
        p.put("dependent", "00");
        return p;
    }

    /**
     * Attempt one claim.
     *
     * The log row goes in first and is the idempotency guard; a constraint violation means this
     * appointment already has a claim for this code and today's date, and nothing is dispatched.
     */
    public Result write(HttpServletRequest request, HttpServletResponse response,
                        Connection c, BillingCandidate bc, String runId, String operator) {
        long logId;
        try {
            logId = insertLogRow(c, bc, runId, operator);
        } catch (SQLIntegrityConstraintViolationException dup) {
            return new Result("DUPLICATE", -1, "A claim for this visit and fee code already exists");
        } catch (SQLException e) {
            return new Result("ERROR", -1, "Could not record the billing attempt: " + e.getMessage());
        }

        if (cfg.dryRun) {
            String detail = "DRY RUN - would send " + claimParams(bc, serviceLocation()).toString();
            updateLogRow(c, logId, "DRYRUN", -1, truncate(detail, 500));
            return new Result("DRYRUN", -1, detail);
        }

        try {
            // 1. Build the session bean from the appointment.
            dispatch(request, response, "/billing.do", beanParams(bc, operator));
            // 2. Validate. OSCAR's own MSP rules run here, including the fee-code age bands.
            dispatch(request, response, "/billing/CA/BC/CreateBilling.do",
                    claimParams(bc, serviceLocation()));
            // 3. Write.
            //
            // `submit` is not optional. BillingSaveBillingAction line 199 does
            // form.getSubmit().equals("Another Bill") with no null check, so dispatching this
            // with an empty parameter map throws NPE *after* it has already flipped the
            // appointment to Billed -- leaving a visit marked billed with no claim behind it.
            // BillingSaveBillingForm has exactly one property, so this is the whole payload; the
            // rest of the claim is read from BillingSessionBean.
            //
            // "Save Bill" is the plain save. The other two buttons on billingCreated.jsp are
            // "Another Bill" (re-opens the form) and "Save & Print Receipt" (private billing).
            Map<String, String> save = new LinkedHashMap<String, String>();
            save.put("submit", "Save Bill");
            dispatch(request, response, "/billing/CA/BC/SaveBilling.do", save);

            // Confirm by reading the claim back rather than by parsing the forwarded HTML — the
            // only thing that actually proves a row exists is the row.
            int billingNo = findBilling(c, bc);
            if (billingNo < 0) {
                String undo = restoreAppointmentStatus(c, bc);
                updateLogRow(c, logId, "ERROR", -1, "No claim appeared after SaveBilling. " + undo);
                return new Result("ERROR", -1,
                        "OSCAR reported no error but no claim was created - check catalina.out");
            }
            updateLogRow(c, logId, "BILLED", billingNo, "");
            return new Result("BILLED", billingNo, "");
        } catch (Exception e) {
            String undo = restoreAppointmentStatus(c, bc);
            updateLogRow(c, logId, "ERROR", -1, truncate(e + ". " + undo, 500));
            return new Result("ERROR", -1, String.valueOf(e));
        }
    }

    /**
     * Put the appointment back the way it was when no claim was created.
     *
     * SaveBilling flips the appointment to Billed before it finishes writing, and the three
     * dispatched actions each manage their own connection, so none of this can be wrapped in one
     * transaction. A failure after that flip therefore leaves a visit marked Billed with nothing
     * behind it -- and because Billed is not a billable status, the sweep never shows it again.
     * It does not resurface, it does not error, it simply never gets paid.
     *
     * That happened to three visits before this existed. Guarded on the claim genuinely being
     * absent, so a successful claim can never be un-marked.
     */
    private String restoreAppointmentStatus(Connection c, BillingCandidate bc) {
        try {
            if (findBilling(c, bc) >= 0) return "claim exists; status left alone";
            PreparedStatement ps = c.prepareStatement(
                    "UPDATE appointment SET status = ? WHERE appointment_no = ? AND status <> ?");
            ps.setString(1, bc.apptStatus);
            ps.setInt(2, bc.appointmentNo);
            ps.setString(3, bc.apptStatus);
            int n = ps.executeUpdate();
            ps.close();
            return n > 0 ? "appointment status restored to " + bc.apptStatus : "status unchanged";
        } catch (SQLException e) {
            // Worth shouting about: the visit is now stranded and only the log says so.
            System.err.println("[mymd.billing] could not restore appointment " + bc.appointmentNo
                    + " to " + bc.apptStatus + ": " + e);
            return "COULD NOT restore appointment status - visit may be stranded as Billed";
        }
    }

    private void dispatch(HttpServletRequest request, HttpServletResponse response,
                          String path, Map<String, String> params) throws Exception {
        ParamRequest wrapped = new ParamRequest(request, params);
        // include(), not forward(): forward() would commit the response and end the page.
        request.getRequestDispatcher(path).include(wrapped, new SwallowingResponse(response));
    }

    /** The actions render pages we do not want; this drops their output on the floor. */
    static class SwallowingResponse extends javax.servlet.http.HttpServletResponseWrapper {
        private final java.io.PrintWriter writer =
                new java.io.PrintWriter(new java.io.StringWriter());
        SwallowingResponse(HttpServletResponse real) { super(real); }
        @Override public java.io.PrintWriter getWriter() { return writer; }
        @Override public javax.servlet.ServletOutputStream getOutputStream() {
            return new javax.servlet.ServletOutputStream() {
                @Override public void write(int b) { }
                @Override public boolean isReady() { return true; }
                @Override public void setWriteListener(javax.servlet.WriteListener l) { }
            };
        }
    }

    /**
     * The value the service-location dropdown submits — the whole "V|Virtual Care" string, not "V".
     *
     * billingBC.jsp defaults this field straight from the `visittype` property (see its lines
     * ~894-901), and OSCAR then truncates the same string two different ways: billing.visittype is
     * char(2) so it stores "V|", and billingmaster.service_location is char(1) so it stores "V".
     * A captured claim shows exactly that. Passing "V" here would have written "V" into a column
     * that should hold "V|" — invisible on screen, wrong in the claim.
     *
     * Read from the property rather than hard-coded so it follows the clinic's own configuration.
     */
    private String serviceLocation() {
        try {
            String v = oscar.OscarProperties.getInstance().getProperty("visittype");
            if (v != null && !v.trim().isEmpty()) return v.trim();
        } catch (Throwable t) {
            // Outside Tomcat (or if the property is unset) fall through to the clinic's default.
        }
        return "V|Virtual Care";
    }

    /** The claim OSCAR just created for this appointment, or -1. */
    private int findBilling(Connection c, BillingCandidate bc) throws SQLException {
        PreparedStatement ps = c.prepareStatement(
                "SELECT billing_no FROM billing WHERE appointment_no = ? AND status <> 'D' "
              + "ORDER BY billing_no DESC LIMIT 1");
        ps.setInt(1, bc.appointmentNo);
        ResultSet rs = ps.executeQuery();
        int no = rs.next() ? rs.getInt(1) : -1;
        rs.close();
        ps.close();
        return no;
    }

    /**
     * Record the attempt. Codes and identifiers only — never the note text or the evidence quote.
     */
    private long insertLogRow(Connection c, BillingCandidate bc, String runId, String operator)
            throws SQLException {
        PreparedStatement ps = c.prepareStatement(
                "INSERT INTO mymd_billing_log (run_id, appointment_no, demographic_no, provider_no, "
              + "service_date, fee_code, dx_proposed, dx_final, dx_source, confidence, "
              + "hin_province, hin_normalized, decision, claim_marker, operator, created_at) "
              // claim_marker=1 takes the double-billing guard up front, before the claim is
              // attempted, so a crash mid-write leaves it held and someone has to look.
              + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',1,?,NOW())",
                PreparedStatement.RETURN_GENERATED_KEYS);
        ps.setString(1, runId);
        ps.setInt(2, bc.appointmentNo);
        ps.setInt(3, bc.demographicNo);
        ps.setString(4, bc.providerNo);
        ps.setString(5, bc.serviceDate);
        ps.setString(6, bc.feeCode);
        ps.setString(7, bc.dxProposed);
        ps.setString(8, bc.dxFinal);
        ps.setString(9, bc.dxSource);
        ps.setString(10, bc.dxConfidence);
        ps.setString(11, bc.province);
        ps.setInt(12, "ON".equals(bc.province) && !bc.versionCode.isEmpty() ? 1 : 0);
        ps.setString(13, operator);
        ps.executeUpdate();
        ResultSet keys = ps.getGeneratedKeys();
        long id = keys.next() ? keys.getLong(1) : -1;
        keys.close();
        ps.close();
        return id;
    }

    private void updateLogRow(Connection c, long id, String decision, int billingNo, String detail) {
        try {
            // Release the guard when we know no claim was created, so the visit can be retried.
            // Only BILLED (and a crashed PENDING) keep it. A dry run that held the key would
            // block the very visit it was rehearsing; a failed attempt would block its own retry.
            boolean claimExists = "BILLED".equals(decision);
            PreparedStatement ps = c.prepareStatement(
                    "UPDATE mymd_billing_log SET decision=?, billing_no=?, detail=?, "
                  + "claim_marker=" + (claimExists ? "1" : "NULL") + " WHERE id=?");
            ps.setString(1, decision);
            if (billingNo < 0) ps.setNull(2, java.sql.Types.INTEGER); else ps.setInt(2, billingNo);
            ps.setString(3, detail);
            ps.setLong(4, id);
            ps.executeUpdate();
            ps.close();
        } catch (SQLException e) {
            // The claim is what matters; a lost log update must not undo it. Say so loudly though,
            // because the log is the rollback key.
            System.err.println("[mymd.billing] FAILED to update billing log row " + id + ": " + e);
        }
    }

    private static String truncate(String s, int n) {
        if (s == null) return "";
        return s.length() <= n ? s : s.substring(0, n);
    }
}
