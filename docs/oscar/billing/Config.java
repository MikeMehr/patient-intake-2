package mymd.billing;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

/**
 * Settings for the day-billing tool.
 *
 * Lives at /var/lib/OscarDocument/oscar/mymd_billing.properties, mode 600, owned by tomcat —
 * outside the web root, so it cannot be served, matching where mymd_mail.properties sits.
 *
 * Read on every request rather than cached, so rotating the secret needs no Tomcat restart. If the
 * file cannot be read the tool fails closed: no URL, no secret, no AI suggestions, and every row
 * falls back to a diagnostic code the physician types.
 *
 * <pre>
 * healthassist.url = https://physician.health-assist.org
 * billing.secret   = &lt;shared secret, matches OSCAR_BILLING_BRIDGE_SECRET in the app&gt;
 * dryrun           = true
 * </pre>
 */
public class Config {

    public static final String PATH = "/var/lib/OscarDocument/oscar/mymd_billing.properties";

    /** Base URL of the Health Assist app. Empty disables AI suggestions. */
    public String appUrl = "";
    /** Shared secret sent as X-MyMD-Billing-Secret. Empty disables AI suggestions. */
    public String secret = "";
    /**
     * When true the commit path runs end to end and records exactly what it would have written,
     * but writes no claim. Defaults to TRUE: an unreadable or half-configured file must not be a
     * way to start billing for real.
     */
    public boolean dryRun = true;

    /** Only used by the standalone harness; inside Tomcat the connection comes from OSCAR. */
    public String jdbcUrl = "jdbc:mysql://localhost/oscar_db";
    public String dbUser = "oscar";
    public String dbPassword = "";

    public boolean aiEnabled() {
        return !appUrl.isEmpty() && !secret.isEmpty();
    }

    public static Config load() {
        Config c = new Config();
        Properties p = new Properties();
        InputStream in = null;
        try {
            in = new FileInputStream(PATH);
            p.load(in);
            c.appUrl = p.getProperty("healthassist.url", "").trim().replaceAll("/+$", "");
            c.secret = p.getProperty("billing.secret", "").trim();
            // Anything other than an explicit "false" leaves the safety on.
            c.dryRun = !"false".equalsIgnoreCase(p.getProperty("dryrun", "true").trim());
        } catch (IOException e) {
            // Fail closed, and say so where an operator will see it.
            System.err.println("[mymd.billing] cannot read " + PATH + " (" + e.getMessage()
                    + ") - AI suggestions disabled, dry run forced on");
            c.appUrl = "";
            c.secret = "";
            c.dryRun = true;
        } finally {
            closeQuietly(in);
        }
        loadDbCreds(c);
        return c;
    }

    /** Reuse OSCAR's own DB credentials so the harness needs no second copy of them. */
    private static void loadDbCreds(Config c) {
        File f = new File("/opt/tomcat9/webapps/oscar/WEB-INF/classes/oscar_mcmaster.properties");
        if (!f.canRead()) return;
        Properties p = new Properties();
        InputStream in = null;
        try {
            in = new FileInputStream(f);
            p.load(in);
            String name = p.getProperty("db_name", "oscar_db").trim();
            c.jdbcUrl = "jdbc:mysql://localhost/" + name;
            c.dbUser = p.getProperty("db_username", "oscar").trim();
            c.dbPassword = p.getProperty("db_password", "").trim();
        } catch (IOException ignored) {
            // Harness-only convenience; the JSP path never needs these.
        } finally {
            closeQuietly(in);
        }
    }

    private static void closeQuietly(InputStream in) {
        if (in != null) {
            try { in.close(); } catch (IOException ignored) { }
        }
    }
}
