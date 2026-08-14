"""Let the Edit Appointment window move an appointment to another provider's schedule.

Stock OSCAR can only do this with Cut + Paste into the other day sheet: the edit
form shows the appointment's provider in the window title only, and
appointmentupdatearecord.jsp never writes provider_no back.

Two edits:
  editappointment.jsp        - a "Provider" dropdown above the read-only "Doctor"
                               (which is the patient's MRP, a different thing),
                               plus a confirm on submit when it was changed.
  appointmentupdatearecord.jsp - honour the new field, validated, on normal update.
"""

import shutil
import time

WEBAPP = '/opt/tomcat9/webapps/oscar/appointment/'
STAMP = time.strftime('%Y%m%d%H%M%S')


def patch(name, edits):
    p = WEBAPP + name
    s = open(p, encoding='utf-8').read()
    for old, new in edits:
        n = s.count(old)
        assert n == 1, '%s: expected 1 match, found %d for %r' % (name, n, old[:70])
        s = s.replace(old, new)
    bak = p + '.oscarbak.' + STAMP
    shutil.copy2(p, bak)
    open(p, 'w', encoding='utf-8').write(s)
    print('patched', name, '(backup:', bak + ')')


# ── editappointment.jsp ────────────────────────────────────────────────────

DOCTOR_ROW_OLD = '''        <tr>
            <td>
                <bean:message key="Appointment.formDoctor" />:
            </td>
            <td>
                <input type="text" readonly name="doctorNo" id="mrp"
                       value="<%=StringEscapeUtils.escapeHtml(providerBean.getProperty(doctorNo==null?"":doctorNo,""))%>">
            </td>
        </tr>'''

DOCTOR_ROW_NEW = '''        <tr>
            <td>
                Provider:
            </td>
            <td>
<%
    // MyMD: the appointment's OWN provider - i.e. whose day sheet it sits on.
    // (The read-only "Doctor" field below is the patient's family doctor/MRP,
    // which is a different thing and is not what moves an appointment.) Stock
    // OSCAR can only move an appointment between schedules with Cut + Paste;
    // this dropdown does it in place. Written back by appointmentupdatearecord.jsp.
    String apptProviderNo = request.getParameter("appt_provider_no");
    if (StringUtils.isBlank(apptProviderNo)) {
        // On the patient-search round trip the form comes back with
        // bFirstDisp=false and `appt` null, so re-read the appointment rather
        // than falling back to a blank - a blank would read as "no provider".
        Appointment apptForProvider = bFirstDisp ? appt : appointmentDao.find(Integer.parseInt(appointment_no));
        apptProviderNo = apptForProvider == null ? "" : StringUtils.trimToEmpty(apptForProvider.getProviderNo());
    }
    List<ProviderData> apptProviderChoices = new ArrayList<ProviderData>();
    boolean currentProviderListed = false;
    for (ProviderData pdRow : providerDao.findAllOrderByLastName()) {
        if (!"1".equals(pdRow.getStatus())) continue;                                  // inactive
        if (!"doctor".equals(pdRow.getProviderType())) continue;                       // only doctors keep a day sheet here
        if ("999998".equals(pdRow.getId()) || "-1".equals(pdRow.getId())) continue;    // OSCAR's built-in accounts
        apptProviderChoices.add(pdRow);
        if (pdRow.getId().equals(apptProviderNo)) currentProviderListed = true;
    }
%>
                <select name="appt_provider_no" id="appt_provider_no"
                        data-original="<%=Encode.forHtmlAttribute(apptProviderNo)%>"
                        title="Whose day sheet this appointment is on. Changing it moves the appointment to that provider's schedule.">
<%  // Never drop the provider the appointment is actually on, even when it is
    // not one of the choices above - silently re-pointing it on save would be worse.
    if (!currentProviderListed) { %>
                    <option value="<%=Encode.forHtmlAttribute(apptProviderNo)%>" selected="selected"><%=Encode.forHtml(providerBean.getProperty(apptProviderNo, apptProviderNo))%></option>
<%  }
    for (ProviderData pdRow : apptProviderChoices) { %>
                    <option value="<%=Encode.forHtmlAttribute(pdRow.getId())%>"<%=pdRow.getId().equals(apptProviderNo)?" selected=\\"selected\\"":""%>><%=Encode.forHtml(StringUtils.trimToEmpty(pdRow.getLastName()) + ", " + StringUtils.trimToEmpty(pdRow.getFirstName()))%></option>
<%  } %>
                </select>
            </td>
        </tr>
        <tr>
            <td>
                <bean:message key="Appointment.formDoctor" />:
            </td>
            <td>
                <input type="text" readonly name="doctorNo" id="mrp"
                       title="The patient's family doctor (MRP) - read only. Use Provider above to move this appointment to another schedule."
                       value="<%=StringEscapeUtils.escapeHtml(providerBean.getProperty(doctorNo==null?"":doctorNo,""))%>">
            </td>
        </tr>'''

ONSUB_OLD = '''function onSub() {
  if( saveTemp==1 ) {'''

ONSUB_NEW = '''// MyMD: the Provider dropdown moves this appointment onto someone else's day
// sheet, where the booking doctor will not see it again. Easy to hit by
// accident, so confirm it - and say what does not travel with it.
function confirmProviderMove() {
  var sel = document.getElementById('appt_provider_no');
  if( !sel || sel.value == sel.getAttribute('data-original') ) return true;
  var name = sel.options[sel.selectedIndex].text.replace(/^\\s+|\\s+$/g, '');
  return confirm("Move this appointment to " + name + "'s schedule?\\n\\n"
    + "It leaves the current provider's day sheet. Any billing already created stays with the original provider.");
}

function onSub() {
  if( saveTemp!=1 && !confirmProviderMove() ) {
    return false;
  }
  if( saveTemp==1 ) {'''

patch('editappointment.jsp', [(DOCTOR_ROW_OLD, DOCTOR_ROW_NEW), (ONSUB_OLD, ONSUB_NEW)])


# ── appointmentupdatearecord.jsp ───────────────────────────────────────────

IMPORT_OLD = '<%@page import="org.oscarehr.common.dao.OscarAppointmentDao" %>'
IMPORT_NEW = ('<%@page import="org.oscarehr.common.dao.OscarAppointmentDao" %>\n'
              '<%@page import="org.oscarehr.common.dao.ProviderDataDao" %>\n'
              '<%@page import="org.oscarehr.common.model.ProviderData" %>')

MERGE_OLD = '''			String rc = request.getParameter("reasonCode");
			if(!StringUtils.isEmpty(rc)) {
				appt.setReasonCode(Integer.parseInt(rc));
			}'''

MERGE_NEW = '''			String rc = request.getParameter("reasonCode");
			if(!StringUtils.isEmpty(rc)) {
				appt.setReasonCode(Integer.parseInt(rc));
			}

			// MyMD: move the appointment to another provider's schedule when the
			// edit form's Provider dropdown was changed. Absent or blank is
			// ignored, so every other caller of this page behaves as before, and
			// the value is checked against the provider table so a tampered form
			// cannot park an appointment on a provider_no that does not exist.
			String newProviderNo = StringUtils.trimToEmpty(request.getParameter("appt_provider_no"));
			if(!newProviderNo.isEmpty() && !newProviderNo.equals(appt.getProviderNo())) {
				ProviderDataDao providerDataDao = SpringUtils.getBean(ProviderDataDao.class);
				ProviderData newProvider = providerDataDao.findByProviderNo(newProviderNo);
				if(newProvider != null) {
					appt.setProviderNo(newProviderNo);
				}
			}'''

patch('appointmentupdatearecord.jsp', [(IMPORT_OLD, IMPORT_NEW), (MERGE_OLD, MERGE_NEW)])
