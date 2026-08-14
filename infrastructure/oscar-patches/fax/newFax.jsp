<%@ page import="java.util.*,java.io.*,java.sql.*,java.sql.Connection,java.sql.PreparedStatement,java.sql.DriverManager,org.apache.commons.fileupload.servlet.ServletFileUpload,org.apache.commons.fileupload.disk.DiskFileItemFactory,org.apache.commons.fileupload.FileItem,org.oscarehr.util.LoggedInInfo,oscar.OscarProperties,com.itextpdf.text.Document,com.itextpdf.text.Paragraph,com.itextpdf.text.Chunk,com.itextpdf.text.Font,com.itextpdf.text.PageSize,com.itextpdf.text.pdf.PdfWriter,com.itextpdf.text.pdf.PdfReader,com.itextpdf.text.pdf.PdfCopy" contentType="text/html;charset=UTF-8" %>
<%!
  // Address book stored as TSV (group <tab> name <tab> 10-digit-fax) outside the web root.
  static final String AB_FILE = "/var/lib/OscarDocument/oscar/fax_addressbook.tsv";
  static final Object AB_LOCK = new Object();

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

  // Read a PDF straight out of the chart so a document can be faxed without a
  // download/re-upload round trip. Fully-qualified names: the bare "Document"
  // in this page is com.itextpdf.text.Document.
  static byte[] readChartDoc(String docNo) throws Exception {
    if(docNo==null || !docNo.matches("[0-9]+")) return null;
    org.oscarehr.common.dao.DocumentDao dao =
        org.oscarehr.util.SpringUtils.getBean(org.oscarehr.common.dao.DocumentDao.class);
    org.oscarehr.common.model.Document d = dao.getDocument(docNo);
    if(d==null) throw new Exception("Document "+docNo+" was not found");
    if(d.getContenttype()==null || !d.getContenttype().toLowerCase().startsWith("application/pdf"))
      throw new Exception("Document "+docNo+" is not a PDF");
    String dir=OscarProperties.getInstance().getProperty("DOCUMENT_DIR","/var/lib/OscarDocument/oscar/document");
    if(!dir.endsWith("/")) dir+="/";
    // Basename only, so a crafted docfilename cannot walk out of the document dir.
    File f=new File(dir, new File(d.getDocfilename()).getName());
    if(!f.isFile()) throw new Exception("The document file is missing: "+f.getName());
    ByteArrayOutputStream bo=new ByteArrayOutputStream();
    InputStream in=null;
    try{
      in=new FileInputStream(f);
      byte[] buf=new byte[8192]; int n;
      while((n=in.read(buf))>0) bo.write(buf,0,n);
    } finally { if(in!=null) try{in.close();}catch(Exception ig){} }
    return bo.toByteArray();
  }

  static String chartDocDesc(String docNo){
    try{
      if(docNo==null || !docNo.matches("[0-9]+")) return null;
      org.oscarehr.common.dao.DocumentDao dao =
          org.oscarehr.util.SpringUtils.getBean(org.oscarehr.common.dao.DocumentDao.class);
      org.oscarehr.common.model.Document d = dao.getDocument(docNo);
      if(d==null || d.getContenttype()==null
         || !d.getContenttype().toLowerCase().startsWith("application/pdf")) return null;
      return d.getDocdesc()==null ? ("Document "+docNo) : d.getDocdesc();
    }catch(Exception e){ return null; }
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
String faxDocNo="";
if(ServletFileUpload.isMultipartContent(request)){
  try{
    ServletFileUpload upload=new ServletFileUpload(new DiskFileItemFactory());
    List<FileItem> items=upload.parseRequest(request);
    FileItem pdf=null; boolean coverPage=false; String toName=""; String coverMsg="";
    for(FileItem it:items){
      if(it.isFormField() && "faxNumber".equals(it.getFieldName())) faxNumber=it.getString().replaceAll("[^0-9]","");
      else if(it.isFormField() && "coverPage".equals(it.getFieldName())) coverPage=true;
      else if(it.isFormField() && "toName".equals(it.getFieldName())) toName=it.getString("UTF-8");
      else if(it.isFormField() && "coverMsg".equals(it.getFieldName())) coverMsg=it.getString("UTF-8");
      else if(it.isFormField() && "docNo".equals(it.getFieldName())) faxDocNo=it.getString().replaceAll("[^0-9]","");
      else if(!it.isFormField() && "pdfFile".equals(it.getFieldName())) pdf=it;
    }
    boolean wantCover = coverPage || (coverMsg!=null && coverMsg.trim().length()>0);
    if(faxNumber.length()<10) throw new Exception("Fax number must be 10 digits");
    // The PDF is either uploaded here or pulled from the chart document this
    // page was opened for (?docNo=). An upload always wins.
    byte[] docBytes=null;
    if(pdf!=null && pdf.getSize()>0) docBytes=pdf.get();
    else if(faxDocNo.length()>0) docBytes=readChartDoc(faxDocNo);
    if(docBytes==null || docBytes.length==0) throw new Exception("PDF file required");
    String docDir=OscarProperties.getInstance().getProperty("DOCUMENT_DIR","/var/lib/OscarDocument/oscar/document");
    if(!docDir.endsWith("/")) docDir+="/";
    String filename="manualfax_"+System.currentTimeMillis()+".pdf";
    File outFile=new File(docDir+filename);
    byte[] finalBytes=docBytes;
    if(wantCover){
      byte[] coverBytes=buildCoverPage(toName, faxNumber, loggedInInfo.getLoggedInProvider().getFormattedName(), coverMsg);
      ByteArrayOutputStream mergedBaos=new ByteArrayOutputStream();
      Document mdoc=new Document();
      PdfCopy copy=new PdfCopy(mdoc, mergedBaos);
      mdoc.open();
      PdfReader cr=new PdfReader(coverBytes); copy.addDocument(cr); cr.close();
      PdfReader dr=new PdfReader(docBytes); copy.addDocument(dr); dr.close();
      mdoc.close();
      finalBytes=mergedBaos.toByteArray();
    }
    FileOutputStream fos=new FileOutputStream(outFile); fos.write(finalBytes); fos.close();
    int numPages=1;
    try{ PdfReader pr=new PdfReader(finalBytes); numPages=pr.getNumberOfPages(); pr.close(); }catch(Exception ig){}
    Class.forName("com.mysql.cj.jdbc.Driver");
    // Credentials come from OSCAR's own config rather than being copied in here: this file
    // sits in the web root and is kept in the repo, and it should not be a second place the
    // database password has to be changed.
    Connection c=DriverManager.getConnection("jdbc:mysql://127.0.0.1:3306/oscar_db?useSSL=false",
        OscarProperties.getInstance().getProperty("db_username","oscar"),
        OscarProperties.getInstance().getProperty("db_password",""));
    PreparedStatement ps=c.prepareStatement("INSERT INTO faxes (filename,faxline,destination,status,numPages,stamp,user,oscarUser) VALUES (?,?,?,'SENT',?,NOW(),?,?)");
    ps.setString(1,filename); ps.setString(2,"6046283830"); ps.setString(3,faxNumber); ps.setInt(4,numPages); ps.setString(5,loggedInInfo.getLoggedInProvider().getFormattedName()); ps.setString(6,providerNo);
    ps.executeUpdate(); ps.close(); c.close();
    msg="<div style='color:green;padding:10px;background:#efe;border:1px solid #090'>Fax queued to "+faxNumber+(wantCover?" (with cover page)":"")+" — it will send within 30 seconds.</div>";
  } catch(Exception e){ msg="<div style='color:red;padding:10px;background:#fee;border:1px solid #900'>Error: "+e.getMessage()+"</div>"; }
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
  } catch(Exception e){ msg="<div style='color:red;padding:10px;background:#fee;border:1px solid #900'>Error: "+esc(e.getMessage())+"</div>"; }
}
List<String[]> ab=readAddressBook();
StringBuilder opts=new StringBuilder();
if(faxDocNo.length()==0){
  String q=request.getParameter("docNo");
  if(q!=null && q.matches("[0-9]+")) faxDocNo=q;
}
String faxDocDesc = faxDocNo.length()>0 ? chartDocDesc(faxDocNo) : null;
if(faxDocDesc==null) faxDocNo="";
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
%>
<html><head><title>New Fax</title><style>body{font-family:sans-serif;max-width:600px;margin:30px auto;padding:20px}label{display:block;margin:12px 0 4px;font-weight:bold}input[type=text],input[type=file],select,textarea{width:100%;padding:6px;font-size:14px;box-sizing:border-box}textarea{font-family:sans-serif;resize:vertical}button{margin-top:16px;padding:10px 20px;background:#336;color:#fff;border:0;border-radius:4px;cursor:pointer;font-size:14px}button:hover{background:#558}details{margin-top:24px;border:1px solid #ddd;border-radius:4px;padding:8px 12px}summary{cursor:pointer;font-weight:bold;color:#336}#abChosen{margin:6px 0 4px;color:#336;font-size:13px;min-height:18px}.hint{font-weight:normal;color:#888;font-size:12px}.chk{font-weight:normal;margin-top:14px}.chk input{width:auto;margin-right:6px;vertical-align:middle}</style></head>
<body>
<h2>Send a New Fax</h2>
<%= msg %>
<form method="POST" enctype="multipart/form-data">
  <input type="hidden" name="toName" />
  <label>Address Book <span class="hint">(<%= ab.size() %> contacts — type to search, click to fill the number below)</span></label>
  <input type="text" id="abSearch" placeholder="Search by name, hospital, lab, doctor…" autocomplete="off" oninput="abFilter()" style="margin-bottom:6px" />
  <select id="abSelect" size="10" onchange="abPick()" onkeyup="if(event.key==='Enter')abPick()">
<%= opts.toString() %>
  </select>
  <div id="abChosen"></div>
  <label>Destination Fax Number (10 digits, North America only)</label>
  <input type="text" name="faxNumber" placeholder="604-398-6518 or (604) 398-6518 or 6043986518" oninput="this.setCustomValidity('');var t=document.getElementsByName('toName');if(t.length)t[0].value=''" value="<%= faxNumber %>" required />
<% if(faxDocNo.length()>0){ %>
  <input type="hidden" name="docNo" value="<%= faxDocNo %>" />
  <label>Document to Fax</label>
  <div style="padding:8px;background:#eef;border:1px solid #99c;border-radius:4px">&#128196; <b><%= esc(faxDocDesc) %></b> <span class="hint">(from the patient's chart)</span></div>
  <label class="hint" style="font-weight:normal">Or upload a different PDF instead</label>
  <input type="file" name="pdfFile" accept="application/pdf" />
<% } else { %>
  <label>PDF File to Fax</label>
  <input type="file" name="pdfFile" accept="application/pdf" required />
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
</script>
</body></html>
