package mymd.billing;

/**
 * One appointment on the day being billed, with everything the sweep decided about it.
 *
 * Flows unchanged from discovery through the review screen to the commit step, so what the
 * physician approved is what gets written.
 */
public class BillingCandidate {

    /** What the sweep decided to do with this row. */
    public enum Disposition {
        /** BC card, valid check digit, signed note, code matched. Billed without asking. */
        AUTO,
        /** Prepared, but the physician has to tick it: out of province, unsigned, no code match. */
        NEEDS_TICK,
        /** Cannot be billed at all — no note, or no health card. Checkbox is disabled. */
        BLOCKED
    }

    public int appointmentNo;
    public int demographicNo;
    public String providerNo = "";
    /** yyyy-MM-dd, the service date. */
    public String serviceDate = "";
    public String startTime = "";
    /** Shown on the review screen only. Never sent off the box. */
    public String patientName = "";
    public int ageAtService = -1;
    public String apptStatus = "";

    /** Health card as it will appear on the claim: 10 digits, or "" when unusable. */
    public String claimHin = "";
    /** Ontario version code, kept rather than discarded. */
    public String versionCode = "";
    /** BC | ON | OTHER */
    public String province = "";
    public boolean hinOk;
    public String hinProblem = "";

    /** Fee code chosen for this patient's age. */
    public String feeCode = "";
    public String feeDescription = "";

    /** How many current-version notes were found for this appointment. */
    public int noteCount;
    public boolean noteSigned;
    /** Redacted note text sent for coding. Never written to a log. */
    public String noteText = "";

    /** The code the model chose, before validation. */
    public String dxProposed = "";
    /** The code that will actually be billed. Empty means the physician must type one. */
    public String dxFinal = "";
    /** ai | manual | dxresearch | none */
    public String dxSource = "none";
    public String dxConfidence = "";
    public String dxDescription = "";
    /** Short quote from the note supporting the code. Screen only — never logged. */
    public String dxEvidence = "";

    public Disposition disposition = Disposition.BLOCKED;
    /** Why it is not AUTO. Shown verbatim to the physician. */
    public String reason = "";

    /** Set after the commit step. */
    public String outcome = "";
    public int billingNo = -1;

    public boolean billable() {
        return disposition != Disposition.BLOCKED;
    }

    /** Pre-ticked on the review screen. Only clean rows start ticked. */
    public boolean preTicked() {
        return disposition == Disposition.AUTO;
    }
}
