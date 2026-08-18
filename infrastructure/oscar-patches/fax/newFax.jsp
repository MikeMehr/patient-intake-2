<%--
  The Send Fax page. Not stock OSCAR.

  Faxes a PDF - uploaded from disk, and/or picked from a patient's chart Documents -
  by writing it into DOCUMENT_DIR and queueing a row in `faxes`; srfax_bridge.py drains
  status='SENT' AND jobId IS NULL every 30s.

  Params: docNo         - a single chart document, pre-ticked (kept for the Fax button in
                          dms/MultiPageDocDisplay.jsp and dms/saveAnnotatedDocument.jsp)
          docNos         - CSV of chart documents to pre-tick (from the Documents list)
          demographicNo  - whose chart to offer; resolved from docNo when not given

  Opened from the scheduler nav there is no patient, so it stays upload-only.

  Repo copy: infrastructure/oscar-patches/fax/newFax.jsp
--%>
<%@ page import="java.util.*,java.io.*,java.sql.*,java.sql.Connection,java.sql.PreparedStatement,java.sql.DriverManager,org.apache.commons.fileupload.servlet.ServletFileUpload,org.apache.commons.fileupload.disk.DiskFileItemFactory,org.apache.commons.fileupload.FileItem,org.oscarehr.util.LoggedInInfo,org.oscarehr.util.SpringUtils,org.oscarehr.managers.SecurityInfoManager,org.oscarehr.common.dao.DocumentDao,org.oscarehr.common.dao.DemographicDao,org.oscarehr.common.model.Demographic,org.owasp.encoder.Encode,oscar.OscarProperties,org.apache.pdfbox.pdmodel.PDDocument,org.apache.pdfbox.pdmodel.PDPage,org.apache.pdfbox.pdmodel.PDPageContentStream,org.apache.pdfbox.pdmodel.common.PDRectangle,org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject,org.apache.pdfbox.multipdf.PDFMergerUtility,com.itextpdf.text.Document,com.itextpdf.text.Paragraph,com.itextpdf.text.Chunk,com.itextpdf.text.Font,com.itextpdf.text.PageSize,com.itextpdf.text.pdf.PdfWriter" contentType="text/html;charset=UTF-8" %>
<%!
  // Address book stored as TSV (group <tab> name <tab> 10-digit-fax) outside the web root.
  static final String AB_FILE = "/var/lib/OscarDocument/oscar/fax_addressbook.tsv";
  static final Object AB_LOCK = new Object();

  // A 20-document fax of large scans can exhaust the heap long before the assembled-size
  // check at the end of the merge, so the sources are capped as they are read too.
  static final long MAX_UPLOAD_BYTES   = 25L * 1024 * 1024;
  static final long MAX_REQUEST_BYTES  = 30L * 1024 * 1024;
  static final long MAX_SOURCE_BYTES   = 40L * 1024 * 1024;
  static final long MAX_ASSEMBLED_BYTES = 20L * 1024 * 1024;
  static final int  MAX_DOCS = 20;

  static List<String[]> readAddressBook(){
    List<String[]> rows = new ArrayList<String[]>();
    File f = new File(AB_FILE);
    if(!f.exists()) return rows;
    BufferedReader br=null;
    try{
      br=new BufferedReader(new InputStreamReader(new FileInputStream(f),"UTF-8"));
      String line;
      while((line=br.readLine())!=null){
        if(line.trim().isEmpty()) continue;
        String[] p=line.split("\t",-1);
        if(p.length>=3) rows.add(new String[]{p[0],p[1],p[2]});
      }
    }catch(Exception e){}
    finally{ if(br!=null) try{br.close();}catch(Exception e){} }
    Collections.sort(rows,new Comparator<String[]>(){
      public int compare(String[] a,String[] b){
        int c=a[0].compareToIgnoreCase(b[0]); if(c!=0) return c;
        return a[1].compareToIgnoreCase(b[1]);
      }
    });
    return rows;
  }

  static void appendContact(String group,String name,String fax) throws Exception {
    synchronized(AB_LOCK){
      Writer w=null;
      try{
        w=new OutputStreamWriter(new FileOutputStream(AB_FILE,true),"UTF-8");
        w.write(group.replace("\t"," ").replace("\n"," ")+"\t"+name.replace("\t"," ").replace("\n"," ")+"\t"+fax+"\n");
      } finally { if(w!=null) w.close(); }
    }
  }

  static String esc(String s){ if(s==null) return ""; return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;"); }

  static String docDir(){
    String dir=OscarProperties.getInstance().getProperty("DOCUMENT_DIR","/var/lib/OscarDocument/oscar/document");
    if(!dir.endsWith("/")) dir+="/";
    return dir;
  }

  // Every chart document goes through DocumentDao.findByDemographicId, which is already
  // scoped through ctl_document and already excludes status='D'. This replaces the old
  // readChartDoc(), which looked a raw id up with getDocument(docNo) and no scoping at
  // all: any logged-in provider could fax any document in the instance by guessing a
  // number, including one belonging to another patient.
  // Fully-qualified: the bare "Document" on this page is com.itextpdf.text.Document.
  static LinkedHashMap<String,org.oscarehr.common.model.Document> chartDocsById(String demographicNo){
    LinkedHashMap<String,org.oscarehr.common.model.Document> m =
        new LinkedHashMap<String,org.oscarehr.common.model.Document>();
    if(demographicNo==null || !demographicNo.matches("[0-9]+")) return m;
    try{
      DocumentDao dao=SpringUtils.getBean(DocumentDao.class);
      List<org.oscarehr.common.model.Document> list=dao.findByDemographicId(demographicNo);
      if(list==null) return m;
      // Newest first. Observation date is what a clinician thinks of as the document's
      // date; fall back to the upload time when it was never set.
      Collections.sort(list,new Comparator<org.oscarehr.common.model.Document>(){
        public int compare(org.oscarehr.common.model.Document a,org.oscarehr.common.model.Document b){
          java.util.Date da=a.getObservationdate()!=null?a.getObservationdate():a.getUpdatedatetime();
          java.util.Date db=b.getObservationdate()!=null?b.getObservationdate():b.getUpdatedatetime();
          if(da==null && db==null) return 0;
          if(da==null) return 1;
          if(db==null) return -1;
          return db.compareTo(da);
        }
      });
      for(org.oscarehr.common.model.Document d:list) m.put(String.valueOf(d.getDocumentNo()),d);
    }catch(Exception e){}
    return m;
  }

  static boolean faxable(org.oscarehr.common.model.Document d){
    String ct=d.getContenttype()==null?"":d.getContenttype().toLowerCase();
    return ct.startsWith("application/pdf") || ct.startsWith("image/");
  }

  // Basename only, so a crafted docfilename cannot walk out of the document dir.
  static File chartFile(org.oscarehr.common.model.Document d) throws Exception {
    if(d.getDocfilename()==null || d.getDocfilename().trim().length()==0)
      throw new Exception("\""+d.getDocdesc()+"\" has no file on disk");
    File f=new File(docDir(), new File(d.getDocfilename()).getName());
    if(!f.isFile()) throw new Exception("The file for \""+d.getDocdesc()+"\" is missing from the document store");
    return f;
  }

  static byte[] readAll(File f) throws Exception {
    ByteArrayOutputStream bo=new ByteArrayOutputStream();
    InputStream in=null;
    try{
      in=new FileInputStream(f);
      byte[] buf=new byte[8192]; int n;
      while((n=in.read(buf))>0) bo.write(buf,0,n);
    } finally { if(in!=null) try{in.close();}catch(Exception ig){} }
    return bo.toByteArray();
  }

  // The merge is PDFBox throughout, with iText kept only for the cover page. iText 5's
  // PdfCopy cannot take a JPEG at all, and the picker offers images; it also throws on
  // AcroForm and tagged-PDF conflicts, which inbound SRFax scans and lab exports produce.
  static void appendPdf(PDDocument merged, byte[] pdf) throws Exception {
    PDDocument src=PDDocument.load(pdf);
    try{ new PDFMergerUtility().appendDocument(merged,src); } finally { src.close(); }
  }

  // One image, one page, scaled to fit inside a half-inch margin, never upscaled.
  static void appendImagePage(PDDocument merged, File img) throws Exception {
    PDPage ip=new PDPage(PDRectangle.LETTER);
    merged.addPage(ip);
    PDImageXObject x=PDImageXObject.createFromFile(img.getAbsolutePath(),merged);
    float mw=PDRectangle.LETTER.getWidth()-72f, mh=PDRectangle.LETTER.getHeight()-72f;
    float sc=Math.min(mw/x.getWidth(), mh/x.getHeight());
    if(sc>1f) sc=1f;
    float iw=x.getWidth()*sc, ih=x.getHeight()*sc;
    PDPageContentStream cs=new PDPageContentStream(merged,ip);
    try{ cs.drawImage(x,(PDRectangle.LETTER.getWidth()-iw)/2f,(PDRectangle.LETTER.getHeight()-ih)/2f,iw,ih); }
    finally{ cs.close(); }
  }

  // Build a one-page fax cover sheet PDF (To + From + date, MyMD Telehealth letterhead).
  static Paragraph coverRow(String label,String value,Font lF,Font vF){
    Paragraph p=new Paragraph(); p.setSpacingAfter(10f);
    p.add(new Chunk(label+"  ",lF));
    p.add(new Chunk(value==null?"":value,vF));
    return p;
  }
  static byte[] buildCoverPage(String toName,String toFax,String fromName,String message) throws Exception {
    if(toName==null || toName.trim().length()==0) toName="(see fax number below)";
    if(fromName==null || fromName.trim().length()==0) fromName="—";
    Document doc=new Document(PageSize.LETTER,72,72,72,72);
    ByteArrayOutputStream baos=new ByteArrayOutputStream();
    PdfWriter.getInstance(doc,baos);
    doc.open();
    Font hF=new Font(Font.FontFamily.HELVETICA,22,Font.BOLD);
    Font sF=new Font(Font.FontFamily.HELVETICA,11);
    Font tF=new Font(Font.FontFamily.HELVETICA,16,Font.BOLD);
    Font lF=new Font(Font.FontFamily.HELVETICA,13,Font.BOLD);
    Font vF=new Font(Font.FontFamily.HELVETICA,13);
    doc.add(new Paragraph("MyMD Telehealth",hF));
    Paragraph cfax=new Paragraph("Fax: 604-628-3830",sF); cfax.setSpacingAfter(28f); doc.add(cfax);
    Paragraph title=new Paragraph("FAX COVER SHEET",tF); title.setSpacingAfter(22f); doc.add(title);
    doc.add(coverRow("Date:",new java.text.SimpleDateFormat("MMMM d, yyyy").format(new java.util.Date()),lF,vF));
    doc.add(coverRow("To:",toName,lF,vF));
    doc.add(coverRow("Fax:",toFax,lF,vF));
    doc.add(coverRow("From:",fromName,lF,vF));
    doc.add(coverRow("Clinic Fax:","604-628-3830",lF,vF));
    if(message!=null && message.trim().length()>0){
      Paragraph ml=new Paragraph("Message:",lF); ml.setSpacingBefore(16f); ml.setSpacingAfter(6f); doc.add(ml);
      Paragraph mb=new Paragraph(); mb.setLeading(16f);
      String[] lines=message.replace("\r","").split("\n",-1);
      for(int i=0;i<lines.length;i++){ mb.add(new Chunk(lines[i],vF)); if(i<lines.length-1) mb.add(Chunk.NEWLINE); }
      doc.add(mb);
    }
    doc.close();
    return baos.toByteArray();
  }
%>
<%
LoggedInInfo loggedInInfo=LoggedInInfo.getLoggedInInfoFromSession(request);
String msg="", faxNumber="";
if(loggedInInfo==null){response.sendRedirect("../logout.jsp"); return;}
String providerNo=loggedInInfo.getLoggedInProviderNo();

// Gated per-feature rather than per-page: without _edoc a provider can still fax a file
// from disk, they just cannot reach into a chart.
boolean canReadChart=false;
try{
  // SpringUtils.getBean is declared <T> T getBean(Class<?>) - T is not tied to the
  // argument, so it only infers from an assignment target. Chain the call and it
  // silently becomes Object and will not compile.
  SecurityInfoManager sim=SpringUtils.getBean(SecurityInfoManager.class);
  canReadChart=sim.hasPrivilege(loggedInInfo,"_edoc","r",null);
}catch(Exception e){}

String demographicNo="";
Set<String> preTicked=new LinkedHashSet<String>();

if(ServletFileUpload.isMultipartContent(request)){
  try{
    DiskFileItemFactory factory=new DiskFileItemFactory();
    ServletFileUpload upload=new ServletFileUpload(factory);
    upload.setFileSizeMax(MAX_UPLOAD_BYTES);
    upload.setSizeMax(MAX_REQUEST_BYTES);
    List<FileItem> items=upload.parseRequest(request);
    FileItem pdf=null; boolean coverPage=false; String toName=""; String coverMsg="";
    List<String> docIds=new ArrayList<String>();
    for(FileItem it:items){
      if(it.isFormField() && "faxNumber".equals(it.getFieldName())) faxNumber=it.getString().replaceAll("[^0-9]","");
      else if(it.isFormField() && "coverPage".equals(it.getFieldName())) coverPage=true;
      else if(it.isFormField() && "toName".equals(it.getFieldName())) toName=it.getString("UTF-8");
      else if(it.isFormField() && "coverMsg".equals(it.getFieldName())) coverMsg=it.getString("UTF-8");
      else if(it.isFormField() && "demographicNo".equals(it.getFieldName())) demographicNo=it.getString().replaceAll("[^0-9]","");
      else if(it.isFormField() && "docNos".equals(it.getFieldName())){
        String v=it.getString().replaceAll("[^0-9]","");
        if(v.length()>0 && !docIds.contains(v)) docIds.add(v);
      }
      else if(!it.isFormField() && "pdfFile".equals(it.getFieldName())) pdf=it;
    }
    preTicked.addAll(docIds);
    boolean wantCover = coverPage || (coverMsg!=null && coverMsg.trim().length()>0);

    // faxes.destination is varchar(11) and this MySQL has no strict mode, so a 12-digit
    // typo used to truncate silently and the fax went somewhere else.
    if(faxNumber.length()==11 && faxNumber.startsWith("1")) faxNumber=faxNumber.substring(1);
    if(faxNumber.length()!=10) throw new Exception("Fax number must be 10 digits");

    if(docIds.size()>MAX_DOCS) throw new Exception("Fax at most "+MAX_DOCS+" chart documents at a time");
    if(!docIds.isEmpty() && !canReadChart) throw new Exception("You do not have permission to fax chart documents");
    if(!docIds.isEmpty() && demographicNo.length()==0) throw new Exception("No patient - reopen this page from the patient's chart");

    byte[] uploadBytes=null;
    if(pdf!=null && pdf.getSize()>0) uploadBytes=pdf.get();
    if(uploadBytes==null && docIds.isEmpty()) throw new Exception("Choose a PDF to upload, or tick at least one document");

    LinkedHashMap<String,org.oscarehr.common.model.Document> byId=chartDocsById(demographicNo);

    File tmp=File.createTempFile("faxout_",".pdf");
    int numPages; long srcBytes=0;
    try{
      PDDocument merged=new PDDocument();
      try{
        if(wantCover){
          appendPdf(merged, buildCoverPage(toName, faxNumber, loggedInInfo.getLoggedInProvider().getFormattedName(), coverMsg));
        }
        if(uploadBytes!=null){ srcBytes+=uploadBytes.length; appendPdf(merged, uploadBytes); }
        for(String id:docIds){
          org.oscarehr.common.model.Document d=byId.get(id);
          // Not in this patient's chart, or soft-deleted: refuse, never send.
          if(d==null) throw new Exception("Document "+id+" is not in this patient's chart");
          if(!faxable(d)) throw new Exception("\""+d.getDocdesc()+"\" is a "+d.getContenttype()+" - only PDFs and images can be faxed");
          File src=chartFile(d);
          srcBytes+=src.length();
          if(srcBytes>MAX_SOURCE_BYTES) throw new Exception("Those documents total more than "+(MAX_SOURCE_BYTES/1024/1024)+" MB - send fewer at a time");
          if(d.getContenttype().toLowerCase().startsWith("application/pdf")) appendPdf(merged, readAll(src));
          else appendImagePage(merged, src);
        }
        numPages=merged.getNumberOfPages();
        if(numPages==0) throw new Exception("Nothing to fax");
        merged.save(tmp);
      } finally { merged.close(); }

      if(tmp.length()>MAX_ASSEMBLED_BYTES)
        throw new Exception("The assembled fax is over "+(MAX_ASSEMBLED_BYTES/1024/1024)+" MB - send fewer documents");

      String filename="manualfax_"+System.currentTimeMillis()+".pdf";
      File outFile=new File(docDir()+filename);
      FileOutputStream fos=new FileOutputStream(outFile);
      try{ fos.write(readAll(tmp)); } finally { fos.close(); }

      Class.forName("com.mysql.cj.jdbc.Driver");
      // Credentials come from OSCAR's own config rather than being copied in here: this
      // file sits in the web root and is kept in the repo, and it should not be a second
      // place the database password has to be changed.
      Connection c=DriverManager.getConnection("jdbc:mysql://127.0.0.1:3306/oscar_db?useSSL=false",
          OscarProperties.getInstance().getProperty("db_username","oscar"),
          OscarProperties.getInstance().getProperty("db_password",""));
      // demographicNo used to be left NULL here, so manual faxes could not be tied back
      // to a patient even when they came straight out of a chart.
      PreparedStatement ps=c.prepareStatement("INSERT INTO faxes (filename,faxline,destination,status,numPages,stamp,user,oscarUser,demographicNo) VALUES (?,?,?,'SENT',?,NOW(),?,?,?)");
      ps.setString(1,filename); ps.setString(2,"6046283830"); ps.setString(3,faxNumber);
      ps.setInt(4,numPages);
      ps.setString(5,loggedInInfo.getLoggedInProvider().getFormattedName());
      ps.setString(6,providerNo);
      if(demographicNo.length()>0) ps.setInt(7,Integer.parseInt(demographicNo)); else ps.setNull(7,java.sql.Types.INTEGER);
      ps.executeUpdate(); ps.close(); c.close();
    } finally { try{ tmp.delete(); }catch(Exception ig){} }

    msg="<div style='color:green;padding:10px;background:#efe;border:1px solid #090'>Fax queued to "+esc(faxNumber)
       +" &mdash; "+numPages+" page"+(numPages==1?"":"s")
       +(docIds.isEmpty()?"":", including "+docIds.size()+" chart document"+(docIds.size()==1?"":"s"))
       +(wantCover?", with a cover page":"")
       +". It will send within 30 seconds.</div>";
    preTicked.clear();
  } catch(Exception e){
    // e.getMessage() can carry a filename that came out of the database.
    msg="<div style='color:red;padding:10px;background:#fee;border:1px solid #900'>Error: "+Encode.forHtml(String.valueOf(e.getMessage()))+"</div>";
  }
} else if("addContact".equals(request.getParameter("action"))){
  try{
    String cname=request.getParameter("cname")==null?"":request.getParameter("cname").trim();
    String cgroup=request.getParameter("cgroup")==null?"":request.getParameter("cgroup").trim();
    String cfax=request.getParameter("cfax")==null?"":request.getParameter("cfax").replaceAll("[^0-9]","");
    if(cname.isEmpty()) throw new Exception("Contact name is required");
    if(cfax.length()==11 && cfax.startsWith("1")) cfax=cfax.substring(1);
    if(cfax.length()!=10) throw new Exception("Fax number must be 10 digits");
    boolean ok=false; for(String[] r:readAddressBook()){ if(r[0].equals(cgroup)){ ok=true; break; } }
    if(!ok) throw new Exception("Please choose an existing group");
    appendContact(cgroup,cname,cfax);
    msg="<div style='color:green;padding:10px;background:#efe;border:1px solid #090'>Added &quot;"+esc(cname)+"&quot; ("+cfax+") to "+esc(cgroup)+".</div>";
  } catch(Exception e){ msg="<div style='color:red;padding:10px;background:#fee;border:1px solid #900'>Error: "+Encode.forHtml(String.valueOf(e.getMessage()))+"</div>"; }
}

// ---- which chart is being offered ----
if(demographicNo.length()==0){
  String q=request.getParameter("demographicNo");
  if(q!=null && q.matches("[0-9]{1,9}")) demographicNo=q;
}
if(preTicked.isEmpty()){
  String one=request.getParameter("docNo");
  if(one!=null && one.matches("[0-9]{1,9}")) preTicked.add(one);
  String many=request.getParameter("docNos");
  if(many!=null){
    for(String t:many.split(",")){
      t=t.trim();
      if(t.matches("[0-9]{1,9}") && preTicked.size()<MAX_DOCS) preTicked.add(t);
    }
  }
}
// Opened straight from the document viewer, which knows the document but not the chart.
if(demographicNo.length()==0 && !preTicked.isEmpty() && canReadChart){
  try{
    DocumentDao ddao=SpringUtils.getBean(DocumentDao.class);
    Demographic dm=ddao.getDemoFromDocNo(preTicked.iterator().next());
    if(dm!=null) demographicNo=String.valueOf(dm.getDemographicNo());
  }catch(Exception e){}
}

LinkedHashMap<String,org.oscarehr.common.model.Document> chartDocs =
    canReadChart ? chartDocsById(demographicNo) : new LinkedHashMap<String,org.oscarehr.common.model.Document>();
String patientName="";
if(demographicNo.length()>0){
  try{
    DemographicDao demoDao=SpringUtils.getBean(DemographicDao.class);
    Demographic dm=demoDao.getDemographicById(Integer.parseInt(demographicNo));
    if(dm!=null) patientName=dm.getLastName()+", "+dm.getFirstName();
  }catch(Exception e){}
  if(patientName.length()==0) patientName="#"+demographicNo;
}

List<String[]> ab=readAddressBook();
StringBuilder opts=new StringBuilder();
String curG=null;
TreeSet<String> groups=new TreeSet<String>(String.CASE_INSENSITIVE_ORDER);
for(String[] r:ab) groups.add(r[0]);
for(String[] r:ab){
  if(!r[0].equals(curG)){
    if(curG!=null) opts.append("    </optgroup>\n");
    opts.append("    <optgroup label=\""+esc(r[0])+"\">\n");
    curG=r[0];
  }
  String disp=r[1].length()==0?("("+r[2]+")"):r[1];
  opts.append("      <option value=\""+esc(r[2])+"\">"+esc(disp)+"</option>\n");
}
if(curG!=null) opts.append("    </optgroup>\n");
StringBuilder grpOpts=new StringBuilder();
for(String g:groups) grpOpts.append("<option value=\""+esc(g)+"\">"+esc(g)+"</option>");
java.text.SimpleDateFormat dfmt=new java.text.SimpleDateFormat("yyyy-MM-dd");
%>
<html><head><title>New Fax</title><style>body{font-family:sans-serif;max-width:640px;margin:30px auto;padding:20px}label{display:block;margin:12px 0 4px;font-weight:bold}input[type=text],input[type=file],select,textarea{width:100%;padding:6px;font-size:14px;box-sizing:border-box}textarea{font-family:sans-serif;resize:vertical}button{margin-top:16px;padding:10px 20px;background:#336;color:#fff;border:0;border-radius:4px;cursor:pointer;font-size:14px}button:hover{background:#558}details{margin-top:24px;border:1px solid #ddd;border-radius:4px;padding:8px 12px}summary{cursor:pointer;font-weight:bold;color:#336}#abChosen{margin:6px 0 4px;color:#336;font-size:13px;min-height:18px}.hint{font-weight:normal;color:#888;font-size:12px}.chk{font-weight:normal;margin-top:14px}.chk input{width:auto;margin-right:6px;vertical-align:middle}
#docwrap{max-height:260px;overflow-y:auto;border:1px solid #ccd;border-radius:4px;margin-top:6px}
#docwrap table{border-collapse:collapse;width:100%;font-size:13px}
#docwrap th{position:sticky;top:0;background:#eef;text-align:left;padding:5px 6px;font-size:12px;border-bottom:1px solid #ccd}
#docwrap td{padding:5px 6px;border-bottom:1px solid #eee;vertical-align:top}
#docwrap tr.off{color:#999}
#docwrap input[type=checkbox]{width:auto}
#docwrap .type{color:#888;font-size:11px}
.patient{background:#eef;border:1px solid #99c;border-radius:4px;padding:6px 8px;margin-top:4px;font-size:13px}
</style></head>
<body>
<h2>Send a New Fax</h2>
<%= msg %>
<form method="POST" enctype="multipart/form-data">
  <input type="hidden" name="toName" />
<% if(demographicNo.length()>0){ %>
  <input type="hidden" name="demographicNo" value="<%= esc(demographicNo) %>" />
<% } %>
  <label>Address Book <span class="hint">(<%= ab.size() %> contacts — type to search, click to fill the number below)</span></label>
  <input type="text" id="abSearch" placeholder="Search by name, hospital, lab, doctor…" autocomplete="off" oninput="abFilter()" style="margin-bottom:6px" />
  <select id="abSelect" size="10" onchange="abPick()" onkeyup="if(event.key==='Enter')abPick()">
<%= opts.toString() %>
  </select>
  <div id="abChosen"></div>
  <label>Destination Fax Number (10 digits, North America only)</label>
  <input type="text" name="faxNumber" placeholder="604-398-6518 or (604) 398-6518 or 6043986518" oninput="this.setCustomValidity('');var t=document.getElementsByName('toName');if(t.length)t[0].value=''" value="<%= esc(faxNumber) %>" required />

  <label>PDF File to Fax <span class="hint">(optional if you tick documents below)</span></label>
  <input type="file" name="pdfFile" accept="application/pdf" />
  <%-- Detected-sender banner: filled by faxDestSuggest.jsp when a PDF is chosen. Fails soft:
       if that endpoint is missing or errors, this div simply never shows. --%>
  <div id="destSuggest" style="display:none;margin:8px 0 0;padding:8px 10px;border:1px solid #99c;background:#eef;border-radius:4px;font-size:13px"></div>

<% if(demographicNo.length()>0 && canReadChart){ %>
  <label>Documents from this patient's chart</label>
  <div class="patient">&#128100; <b><%= esc(patientName) %></b></div>
  <% if(chartDocs.isEmpty()){ %>
    <div class="hint" style="margin-top:6px">This chart has no documents.</div>
  <% } else { %>
  <input type="text" id="filter" placeholder="Filter by description or type" oninput="applyFilter()" style="margin-top:6px" />
  <span class="hint">Ticked documents are faxed after the uploaded file, in the order shown.</span>
  <div id="docwrap">
    <table>
      <tr><th style="width:24px"></th><th style="width:88px">Date</th><th>Description</th><th style="width:52px">View</th></tr>
<%    for(Map.Entry<String,org.oscarehr.common.model.Document> en : chartDocs.entrySet()){
        org.oscarehr.common.model.Document d=en.getValue();
        boolean ok=faxable(d);
        java.util.Date dt=d.getObservationdate()!=null?d.getObservationdate():d.getUpdatedatetime();
        String dateStr=dt==null?"":dfmt.format(dt);
        String desc=d.getDocdesc()==null?("Document "+en.getKey()):d.getDocdesc();
        String dtype=d.getDoctype()==null?"":d.getDoctype();
        String ct=d.getContenttype()==null?"":d.getContenttype();
        String hay=(desc+" "+dtype+" "+dateStr).toLowerCase();
%>
      <tr class="<%= ok?"":"off" %>" data-hay="<%= Encode.forHtmlAttribute(hay) %>">
        <td><% if(ok){ %><input type="checkbox" class="docbox" name="docNos" value="<%= Encode.forHtmlAttribute(en.getKey()) %>"<%= preTicked.contains(en.getKey())?" checked":"" %>><% } %></td>
        <td><%= Encode.forHtml(dateStr) %></td>
        <td><%= Encode.forHtml(desc) %>
            <div class="type"><%= Encode.forHtml(dtype) %><%= ok?"":" - cannot be faxed ("+Encode.forHtml(ct)+")" %></div></td>
        <td><a href="../dms/ManageDocument.do?method=display&amp;doc_no=<%= Encode.forUriComponent(en.getKey()) %>&amp;providerNo=<%= Encode.forUriComponent(providerNo) %>" target="_blank">view</a></td>
      </tr>
<%    } %>
    </table>
  </div>
  <% } %>
<% } else { %>
  <div class="hint" style="margin-top:8px">Opened without a patient, so only an uploaded file can be sent.
    To fax documents out of a chart, tick them in the patient's Documents list and use <b>Fax Selected</b>.</div>
<% } %>

  <label class="chk"><input type="checkbox" name="coverPage" value="1" id="coverChk" onchange="toggleCover()" />Include a fax cover page (MyMD Telehealth letterhead, To/From, date)</label>
  <div id="coverMsgWrap" style="display:none">
    <label>Message / comments to recipient <span class="hint">(printed on the cover page)</span></label>
    <textarea name="coverMsg" rows="4" placeholder="Optional note to the recipient…"></textarea>
  </div>
  <button type="submit">Send Fax</button>
</form>

<details>
  <summary>➕ Add a contact to the address book</summary>
  <p class="hint">Saves a new fax number into one of the existing groups. Everyone sees it the next time the page loads.</p>
  <form method="POST">
    <input type="hidden" name="action" value="addContact" />
    <label>Contact Name</label>
    <input type="text" name="cname" placeholder="e.g. Dr. Jane Smith / Burnaby Hospital - Lab" required />
    <label>Group</label>
    <select name="cgroup" required><%= grpOpts.toString() %></select>
    <label>Fax Number (10 digits)</label>
    <input type="text" name="cfax" placeholder="6045551234" required />
    <button type="submit">Add Contact</button>
  </form>
</details>

<p style="color:#666;font-size:12px;margin-top:24px">Faxes are sent via SRFax account 430688 from your clinic number 604-628-3830. Status appears in Admin → Faxes → Manage Faxes.</p>
<script>
function abFilter(){
  var q=document.getElementById('abSearch').value.toLowerCase().trim();
  var d=q.replace(/[^0-9]/g,'');
  var sel=document.getElementById('abSelect');
  for(var g=0;g<sel.children.length;g++){
    var og=sel.children[g], vis=false;
    for(var i=0;i<og.children.length;i++){
      var o=og.children[i];
      var hit = q==='' || o.text.toLowerCase().indexOf(q)>-1 || og.label.toLowerCase().indexOf(q)>-1 || (d!=='' && o.value.indexOf(d)>-1);
      o.style.display = hit ? '' : 'none';
      if(hit) vis=true;
    }
    og.style.display = vis ? '' : 'none';
  }
}
function applyFilter(){
  var q=document.getElementById('filter').value.toLowerCase().trim();
  var rows=document.querySelectorAll('#docwrap tr[data-hay]');
  for(var i=0;i<rows.length;i++){
    rows[i].style.display = (q==='' || rows[i].getAttribute('data-hay').indexOf(q)>-1) ? '' : 'none';
  }
}
function toggleCover(){
  var on=document.getElementById('coverChk').checked;
  document.getElementById('coverMsgWrap').style.display = on ? '' : 'none';
}
function abPick(){
  var sel=document.getElementById('abSelect');
  if(sel.selectedIndex<0) return;
  var o=sel.options[sel.selectedIndex];
  if(!o || !o.value) return;
  document.getElementsByName('faxNumber')[0].value=o.value;
  var t=document.getElementsByName('toName'); if(t.length) t[0].value=o.text;
  document.getElementById('abChosen').textContent='✓ Selected: '+o.text+'  —  '+o.value;
}

// ---- detected sender: read the chosen PDF and suggest who to fax back to ----
// Calls faxDestSuggest.jsp (same dir). Only ever SUGGESTS - nothing here submits the form,
// and any error just leaves the page exactly as it was.
var dsSeq=0, dsAbort=null;
function dsBox(){ return document.getElementById('destSuggest'); }
function dsClear(){ var b=dsBox(); b.style.display='none'; b.innerHTML=''; }
function dsStart(body,isForm){
  var seq=++dsSeq;
  if(dsAbort){ try{dsAbort.abort();}catch(e){} }
  dsAbort=(typeof AbortController!=='undefined')?new AbortController():null;
  var b=dsBox();
  b.style.display=''; b.style.background='#eef'; b.style.borderColor='#99c'; b.style.color='#336';
  b.textContent='🔍 Reading PDF…';
  // Scanned faxes have no text layer and go through OCR, which takes a while.
  var slowTimer=window.setTimeout(function(){
    if(seq===dsSeq) b.textContent='🔍 Reading PDF… (scanned fax — running OCR, up to a minute)';
  },6000);
  var opts={method:'POST',body:body};
  if(isForm) opts.headers={'Content-Type':'application/x-www-form-urlencoded'};
  if(dsAbort) opts.signal=dsAbort.signal;
  fetch('faxDestSuggest.jsp',opts).then(function(r){return r.json();}).then(function(j){
    window.clearTimeout(slowTimer);
    if(seq===dsSeq) dsRender(j);
  }).catch(function(){
    window.clearTimeout(slowTimer);
    if(seq===dsSeq) dsClear();
  });
}
function dsMuted(text){
  var b=dsBox();
  b.style.display=''; b.style.background='#f4f4f4'; b.style.borderColor='#ccc'; b.style.color='#888';
  b.textContent=text;
  var seq=dsSeq;
  window.setTimeout(function(){ if(seq===dsSeq) dsClear(); },8000);
}
function dsOpenPreview(b64){
  var bin=atob(b64), arr=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  // A blob URL, because Chrome blocks data: URLs as top-level navigations.
  var url=URL.createObjectURL(new Blob([arr],{type:'image/png'}));
  window.open(url,'_blank');
  window.setTimeout(function(){ try{URL.revokeObjectURL(url);}catch(e){} },60000);
}
function dsRender(j){
  if(j && (j.reason==='no_number' || j.reason==='no_text_no_ocr')){
    dsMuted('No sender fax number detected in this PDF.');
    return;
  }
  if(!j || j.reason || !j.faxNumber){ dsClear(); return; }
  var b=dsBox();
  var warn=!j.senderName || j.source==='ocr-name';
  b.style.display='';
  b.style.background=warn?'#fff6e6':'#eef';
  b.style.borderColor=warn?'#d90':'#99c';
  b.style.color='#333';
  b.innerHTML='';
  // Everything below came off a fax - textContent only, never markup.
  var head=document.createElement('div');
  head.style.fontWeight='bold';
  var t='📠 ';
  if(j.source==='ocr-name'){
    t+='Sender looks like: '+j.senderName+' — '+j.faxNumberFormatted
      +' (matched by name from the address book; number NOT read off the page)';
  } else if(j.senderName){
    t+='Detected sender: '+j.senderName+(j.senderGroup?' ('+j.senderGroup+')':'')+' — '+j.faxNumberFormatted;
    if(j.page>0) t+=', found on page '+j.page;
  } else {
    t+='Detected sender fax: '+j.faxNumberFormatted+' — not in the address book';
    if(j.page>0) t+=', found on page '+j.page;
  }
  var fx=document.getElementsByName('faxNumber')[0];
  var cur=fx.value.replace(/[^0-9]/g,'');
  if(cur.length===11&&cur.charAt(0)==='1') cur=cur.substring(1);
  var differs=cur.length>0 && cur!==j.faxNumber;
  if(differs) t+=' (differs from the destination currently entered)';
  head.textContent=t;
  b.appendChild(head);
  if(j.alsoListedAs && j.alsoListedAs.length){
    var names=[];
    for(var i=0;i<j.alsoListedAs.length;i++) names.push(j.alsoListedAs[i].name+' ('+j.alsoListedAs[i].group+')');
    var al=document.createElement('div');
    al.style.marginTop='4px';
    al.textContent='Also listed as: '+names.join(', ');
    b.appendChild(al);
  }
  if(j.senderFacility && j.senderFacility.toLowerCase()!==(j.senderName||'').toLowerCase()){
    var pr=document.createElement('div');
    pr.style.marginTop='4px'; pr.style.color='#666';
    pr.textContent='Page reads: '+j.senderFacility;
    b.appendChild(pr);
  }
  var row=document.createElement('div');
  row.style.marginTop='6px';
  var btn=document.createElement('button');
  btn.type='button';
  btn.style.margin='0'; btn.style.padding='6px 12px';
  function fill(){
    fx.value=j.faxNumber;
    fx.setCustomValidity('');
    var tn=document.getElementsByName('toName'); if(tn.length) tn[0].value=j.senderName||'';
    document.getElementById('abChosen').textContent='✓ Selected: '+(j.senderName||j.faxNumberFormatted)+'  —  '+j.faxNumber;
    btn.textContent='✓ Filled — click to re-apply';
  }
  btn.textContent='Use this number';
  btn.onclick=fill;
  row.appendChild(btn);
  b.appendChild(row);
  // Auto-fill ONLY an empty destination; a number someone already typed is never touched.
  if(cur.length===0) fill();
  if(j.previewPng){
    var wrap=document.createElement('div');
    wrap.style.marginTop='6px';
    var img=document.createElement('img');
    img.src='data:image/png;base64,'+j.previewPng;
    img.style.maxHeight='140px'; img.style.maxWidth='100%'; img.style.display='block';
    img.style.border='1px solid #99c'; img.style.cursor='zoom-in';
    img.title='Click to enlarge';
    img.onclick=function(){ dsOpenPreview(j.previewPng); };
    wrap.appendChild(img);
    var cap=document.createElement('div');
    cap.style.color='#888'; cap.style.fontSize='11px';
    cap.textContent='page '+j.page+' of '+j.pageCount+' — click to enlarge';
    wrap.appendChild(cap);
    b.appendChild(wrap);
  }
}
function dsFromDoc(docNo){
  var demoEl=document.getElementsByName('demographicNo');
  var demo=demoEl.length?demoEl[0].value:'';
  if(!demo){ dsClear(); return; }
  dsStart('docNo='+encodeURIComponent(docNo)+'&demographicNo='+encodeURIComponent(demo),true);
}
function dsFromDocs(){
  var boxes=document.querySelectorAll('.docbox');
  for(var i=0;i<boxes.length;i++){
    if(boxes[i].checked){ dsFromDoc(boxes[i].value); return; }
  }
  dsSeq++; dsClear();
}
(function(){
  var pf=document.getElementsByName('pdfFile')[0];
  if(pf) pf.addEventListener('change',function(){
    if(pf.files && pf.files.length>0){
      var fd=new FormData();
      fd.append('pdfFile',pf.files[0]);
      dsStart(fd,false);
    } else {
      dsFromDocs();
    }
  });
  // Delegated so it survives the filter box re-rendering nothing (rows only ever hide).
  var dw=document.getElementById('docwrap');
  if(dw) dw.addEventListener('change',function(ev){
    var t=ev.target;
    if(!t || !t.className || (' '+t.className+' ').indexOf(' docbox ')<0) return;
    if(pf && pf.files && pf.files.length>0) return;   // the upload wins; keep its banner
    if(t.checked){ dsFromDoc(t.value); return; }
    dsFromDocs();
  });
  // Opened from a document's Fax button (docNo pre-ticked): suggest right away - this is the
  // pharmacy-refill path the feature exists for.
  if(!(pf && pf.files && pf.files.length>0)) dsFromDocs();
})();
</script>
</body></html>
