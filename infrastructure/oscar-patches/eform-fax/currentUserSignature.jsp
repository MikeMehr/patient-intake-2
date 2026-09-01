<%--
  Custom endpoint: the logged-in provider's signature line, exactly as the
  prescription module prints it.

  oscarRx/Preview2.jsp puts providerExt.signature on the Rx signature line (falling
  back to "First Last" from the provider table when the row is missing or blank).
  Referral eForms that carry a Signature field fetch this so the same text lands on
  their signature line - one place (providerExt.signature) controls both, and
  blanking it there blanks both.

  No parameters. Returns the signature as plain text; empty body when not logged in
  or nothing is configured. Deliberately session-only: the signature belongs to the
  caller, so there is no provider_no parameter to ask for anybody else's.

  Repo copy: infrastructure/oscar-patches/eform-fax/currentUserSignature.jsp
  Deploy: /opt/tomcat9/webapps/oscar/eform/currentUserSignature.jsp
  (Wiped by a WAR redeploy, like the other eform/ JSPs - re-copy after.)
--%><%@ page import="java.sql.*" %><%@
 page import="oscar.OscarProperties" %><%@
 page trimDirectiveWhitespaces="true" contentType="text/plain;charset=UTF-8" %><%
Object userObj = session.getAttribute("user");
if (userObj == null) { return; }
String providerNo = String.valueOf(userObj);

final String DB_URL  = "jdbc:mysql://127.0.0.1:3306/oscar_db?useSSL=false";
final String DB_USER = OscarProperties.getInstance().getProperty("db_username", "oscar");
final String DB_PW   = OscarProperties.getInstance().getProperty("db_password", "");

String sig = null;
Connection c = null;
try {
    c = DriverManager.getConnection(DB_URL, DB_USER, DB_PW);
    PreparedStatement ps = c.prepareStatement("SELECT signature FROM providerExt WHERE provider_no=?");
    ps.setString(1, providerNo);
    ResultSet rs = ps.executeQuery();
    if (rs.next()) sig = rs.getString(1);
    rs.close(); ps.close();
    if (sig == null || sig.trim().length() == 0) {
        // same fallback Preview2.jsp uses when there is no providerExt row
        PreparedStatement ps2 = c.prepareStatement("SELECT CONCAT(first_name, ' ', last_name) FROM provider WHERE provider_no=?");
        ps2.setString(1, providerNo);
        ResultSet rs2 = ps2.executeQuery();
        if (rs2.next()) sig = rs2.getString(1);
        rs2.close(); ps2.close();
    }
} catch (Exception e) {
    sig = null;
} finally {
    if (c != null) try { c.close(); } catch (Exception ig) {}
}
if (sig != null) out.print(sig.trim());
%>
