<!-- Script to allow linking to other Oscar pages for active patient -->

function onBodyLoad() {
	var re = new RegExp( "[?&]" + 'demographic_no' + "=([^&$]*)", "i" );
	var offset=window.opener.location.search.search(re);
	if(offset==-1){ 
	re = new RegExp( "[?&]" + 'demographicNo' + "=([^&$]*)", "i" );
	offset=window.opener.location.search.search(re);
  }
}

function doIFrameOnLoad() {
	var re = new RegExp( "[?&]" + 'demographic_no' + "=([^&$]*)", "i" );
	var offset=window.opener.location.search.search(re);
	if(offset==-1){ 
	re = new RegExp( "[?&]" + 'demographicNo' + "=([^&$]*)", "i" );
	offset=window.opener.location.search.search(re);
	}
	var demographic=RegExp.$1;
}

function Rx() {
window.open("../oscarRx/choosePatient.do?providerNo=&demographicNo="+RegExp.$1+"");
}

function allergy() {
window.open("../oscarRx/showAllergy.do?demographicNo="+RegExp.$1+"");
}

function prevention() {
window.open("../oscarPrevention/index.jsp?demographic_no="+RegExp.$1+"");
}

function tickler() {
window.open(" ../tickler/ticklerAdd.jsp?name=&chart_no=&bFirstDisp=false&demographic_no="+RegExp.$1+"&messageID=null&doctor_no=");
}

function diseaseRegistry() {
window.open("../oscarResearch/oscarDxResearch/setupDxResearch.do?demographicNo="+RegExp.$1+"&providerNo=&quickList=");
}

function message() {
window.open("../oscarMessenger/SendDemoMessage.do?demographic_no="+RegExp.$1+"");
}

function consult() {
window.open("../oscarEncounter/oscarConsultationRequest/ConsultationFormRequest.jsp?de="+RegExp.$1+"&teamVar=");
}

function eGFR() {
window.open("../oscarEncounter/oscarMeasurements/SetupDisplayHistory.do?type=EGFR");
}

function labGrid() {
window.open("../lab/CumulativeLabValues3.jsp?demographic_no="+RegExp.$1+"");
}

function labRow() {
window.open("../lab/CumulativeLabValues.jsp?demographic_no="+RegExp.$1+"");
}

function labs() {
window.open("../lab/DemographicLab.jsp?demographicNo="+RegExp.$1+"");
}

function HBPFlowsheet() {
window.open("../oscarEncounter/oscarMeasurements/TemplateFlowSheet.jsp?demographic_no="+RegExp.$1+"&template=hyptension");
}

function CHFFlowsheet() {
window.open("../oscarEncounter/oscarMeasurements/TemplateFlowSheet.jsp?demographic_no="+RegExp.$1+"&template=chf");
}

function DMFlowsheet() {
window.open("../oscarEncounter/oscarMeasurements/TemplateFlowSheet.jsp?demographic_no="+RegExp.$1+"&template=diab2");
}

function billing() {
window.open("../billing.do?billRegion=BC&billForm=DA&hotclick=&appointment_no=&demographic_name=&status=c&demographic_no="+RegExp.$1+"&providerview=&user_no=&apptProvider_no=&appointment_date=&start_time=12:0&bNewForm=1");
}

function documents_all() {
window.open("../dms/documentReport.jsp?function=demographic&functionid="+RegExp.$1+"&view=all");
}

function documents_consult() {
window.open("../dms/documentReport.jsp?function=demographic&functionid="+RegExp.$1+"&view=consult");
}