import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

const API_BASE = "http://127.0.0.1:8000/api/roc";
// For production change to:
// const API_BASE = "https://your-backend-url/api/roc";

const TODAY = new Date("2026-03-02");

const COMPLIANCE_RULES = [
  { id:"mgt7a", form:"MGT-7A", title:"Abridged Annual Return", cat:"Annual Filing", section:"Sec 92, Rule 11A", freq:"Annual", applies:(c)=>c.isSmallCompany==="Yes"||c.companyType==="OPC", tags:["Small Co/OPC"] },
  { id:"mgt7", form:"MGT-7", title:"Annual Return", cat:"Annual Filing", section:"Sec 92", freq:"Annual", applies:(c)=>c.companyType!=="LLP"&&c.isSmallCompany!=="Yes", tags:["Non-Small Co"] },
  { id:"aoc4", form:"AOC-4", title:"Financial Statements Filing", cat:"Annual Filing", section:"Sec 137", freq:"Annual", applies:(c)=>c.companyType!=="LLP", tags:["All Cos"] },
  { id:"adt1", form:"ADT-1", title:"Appointment of Auditor", cat:"Annual Filing", section:"Sec 139", freq:"Annual/5yr", applies:(c)=>c.companyType!=="LLP", tags:["All Cos"] },
  { id:"dpt3", form:"DPT-3", title:"Return of Deposits", cat:"Statutory Return", section:"Sec 73/Rule 16", freq:"Annual", applies:(c)=>c.companyType!=="LLP", tags:["Non-LLP"] },
  { id:"msme1", form:"MSME-1", title:"Outstanding Dues to MSME", cat:"Statutory Return", section:"Sec 405", freq:"Half-yearly", applies:()=>true, tags:["All Cos"] },
  { id:"dir12", form:"DIR-12", title:"Change in Directors / KMP", cat:"Director", section:"Sec 170", freq:"Event", applies:()=>true, tags:["All Cos"] },
  { id:"dir3k", form:"DIR-3 KYC", title:"Director KYC (Annual)", cat:"Director", section:"Rule 12A", freq:"Annual", applies:()=>true, tags:["All Cos"] },
  { id:"mgt14", form:"MGT-14", title:"Filing of Board Resolutions", cat:"Director", section:"Sec 117", freq:"Event", applies:(c)=>c.companyType==="Public"||c.listedStatus==="Listed", tags:["Public/Listed"] },
  { id:"pas3", form:"PAS-3", title:"Return of Allotment", cat:"Share Capital", section:"Sec 39/42", freq:"Event", applies:()=>true, tags:["All Cos"] },
  { id:"sh7", form:"SH-7", title:"Increase in Authorised Capital", cat:"Share Capital", section:"Sec 64", freq:"Event", applies:()=>true, tags:["All Cos"] },
  { id:"inc22", form:"INC-22", title:"Change in Registered Office", cat:"Registered Office", section:"Sec 12", freq:"Event", applies:()=>true, tags:["All Cos"] },
  { id:"xbrl", form:"AOC-4 XBRL", title:"XBRL Financial Statements", cat:"Annual Filing", section:"MCA XBRL Rules", freq:"Annual", applies:(c)=>c.listedStatus==="Listed"||+c.turnover>=500||+c.paidUpCapital>=500, tags:["Listed/Large"] },
  { id:"csr", form:"CSR-1/CSR-2", title:"CSR Registration & Reporting", cat:"CSR", section:"Sec 135", freq:"Annual", applies:(c)=>+c.networth>=500||+c.turnover>=1000||+c.netProfit>=5, tags:["NW≥500/TO≥1000 Cr"] },
  { id:"iepf", form:"IEPF-1/IEPF-2", title:"IEPF – Unpaid Dividend/Shares", cat:"Investor Protection", section:"Sec 125", freq:"Event", applies:(c)=>c.companyType==="Public"||c.listedStatus==="Listed", tags:["Public/Listed"] },
  { id:"ben2", form:"BEN-2", title:"Significant Beneficial Ownership", cat:"Statutory Return", section:"Sec 90", freq:"Event", applies:(c)=>c.companyType!=="LLP", tags:["Non-LLP"] },
  { id:"chg1", form:"CHG-1/CHG-4", title:"Registration / Satisfaction of Charge", cat:"Charges", section:"Sec 77/82", freq:"Event", applies:(c)=>c.hasCharges, tags:["Cos with Charges"] },
  { id:"llp8", form:"Form 8 (LLP)", title:"Statement of Account & Solvency", cat:"Annual Filing", section:"LLP Act 2008", freq:"Annual", applies:(c)=>c.companyType==="LLP", tags:["LLP Only"] },
  { id:"llp11", form:"Form 11 (LLP)", title:"Annual Return (LLP)", cat:"Annual Filing", section:"LLP Act 2008", freq:"Annual", applies:(c)=>c.companyType==="LLP", tags:["LLP Only"] },
];

const CAT_COL = {
  "Annual Filing": { bg:"#1d4ed822", bd:"#3b82f633", txt:"#93c5fd" },
  "Statutory Return": { bg:"#c2410c22", bd:"#f9731633", txt:"#fdba74" },
  "Director": { bg:"#7c3aed22", bd:"#8b5cf633", txt:"#c4b5fd" },
  "Share Capital": { bg:"#b4530922", bd:"#f59e0b33", txt:"#fcd34d" },
  "Registered Office": { bg:"#065f4622", bd:"#10b98133", txt:"#6ee7b7" },
  "CSR": { bg:"#9d174d22", bd:"#ec489933", txt:"#f9a8d4" },
  "Investor Protection": { bg:"#0e749022", bd:"#06b6d433", txt:"#67e8f9" },
  "Charges": { bg:"#7f1d1d22", bd:"#ef444433", txt:"#fca5a5" },
};

const parseIndDate = (s) => { if (!s) return null; const [d,m,y]=s.split("/").map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
const fmt = (d) => { if(!d) return "—"; return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
const daysLeft = (d) => d ? Math.ceil((d-TODAY)/86400000) : null;
const urgency = (n) => {
  if (n===null) return {col:"#4a4a66",bg:"#1e1e3022",label:"—"};
  if (n<0) return {col:"#f87171",bg:"#7f1d1d22",label:`${Math.abs(n)}d overdue`};
  if (n<=30) return {col:"#fb923c",bg:"#7c2d1222",label:`${n}d left`};
  if (n<=90) return {col:"#fbbf24",bg:"#78350f22",label:`${n}d left`};
  return {col:"#4ade80",bg:"#14532d22",label:`${n}d left`};
};

const calcDueDates = (rule, co) => {
  const agm = parseIndDate(co.lastAGM);
  const slots = [];
  switch(rule.id) {
    case"mgt7":case"mgt7a": if(agm) slots.push({label:"FY 24-25",date:addDays(agm,60)}); slots.push({label:"FY 25-26 (est.)",date:new Date(2026,10,29)}); break;
    case"aoc4": if(agm) slots.push({label:"FY 24-25",date:addDays(agm,30)}); slots.push({label:"FY 25-26 (est.)",date:new Date(2026,9,30)}); break;
    case"adt1": if(agm) slots.push({label:"FY 24-25",date:addDays(agm,15)}); slots.push({label:"FY 25-26 (est.)",date:new Date(2026,9,15)}); break;
    case"dpt3": slots.push({label:"FY 24-25",date:new Date(2025,5,30)}); slots.push({label:"FY 25-26",date:new Date(2026,5,30)}); break;
    case"msme1": slots.push({label:"Apr-Sep 2025",date:new Date(2025,9,31)}); slots.push({label:"Oct25-Mar26",date:new Date(2026,3,30)}); slots.push({label:"Apr-Sep 2026",date:new Date(2026,9,31)}); break;
    case"dir3k": slots.push({label:"FY 24-25",date:new Date(2025,8,30)}); slots.push({label:"FY 25-26",date:new Date(2026,8,30)}); break;
    case"llp8": slots.push({label:"FY 24-25",date:new Date(2025,9,30)}); slots.push({label:"FY 25-26",date:new Date(2026,9,30)}); break;
    case"llp11": slots.push({label:"FY 24-25",date:new Date(2025,4,30)}); slots.push({label:"FY 25-26",date:new Date(2026,4,30)}); break;
    default: slots.push({label:"Event-based",date:null});
  }
  const upcoming = slots.filter(s=>s.date&&s.date>=TODAY);
  const past = slots.filter(s=>s.date&&s.date<TODAY);
  return {upcoming:upcoming[0]||null, past:past.at(-1)||null, all:slots};
};

const loadPdfJs = () => new Promise((res,rej) => {
  if (window.pdfjsLib) { res(window.pdfjsLib); return; }
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(window.pdfjsLib); };
  s.onerror = rej; document.head.appendChild(s);
});

const extractPdfText = async (file) => {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({data:buf}).promise;
  let txt = "";
  for (let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    txt += content.items.map(x=>x.str).join(" ") + "\n";
  }
  return txt;
};

const toC = (v) => v ? (v/10000000).toFixed(4) : "";
const parseAOC4 = (txt, fileName) => {
  const cin = txt.match(/([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/)?.[1]||"";
  const nm1 = txt.match(/Name of the company\s+([A-Z][A-Z\s&,.()-]+(?:PRIVATE\s*LIMITED|LIMITED|LLP))/i)?.[1]||"";
  const srn = txt.match(/eForm Service request number.*?([A-Z0-9][\w-]+)/i)?.[1]||txt.match(/SRN\s+([A-Z0-9][\w-]+)/)?.[1]||"";
  const filingDate = txt.match(/eForm filing date.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const agmDate = txt.match(/date of AGM.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const fyFrom = txt.match(/From\s+(\d{2}\/\d{2}\/\d{4})/)?.[1]||"";
  const fyTo = txt.match(/To\s+(\d{2}\/\d{2}\/\d{4})/)?.[1]||"";
  const nwAbs = parseInt(txt.match(/Net Worth.*?(-?\d+)/i)?.[1]||"0")||0;
  const toAbs = parseInt(txt.match(/Sale or supply of services\s+(\d+)/)?.[1] || txt.match(/\*Turnover\s+(\d+)/)?.[1]||"0")||0;
  const scAbs = parseInt(txt.match(/Share capital\s+(\d+)/)?.[1]||"0")||0;
  const plAbs = parseInt(txt.match(/Profit\s*\/?\s*\(Loss\).*?\(XI.*?XIV\).*?(-?\d+)/)?.[1]||"0")||0;
  const auditor = (txt.match(/Name of the auditor.*?firm\s+([A-Z][A-Z\s&.]+)/i)?.[1]||"").replace(/\s+/g," ").trim();
  return { type:"aoc4", fileName, cin, companyName:nm1.replace(/\s+/g," "), srn, filingDate, lastAGM:agmDate, fyFrom, fyTo,
    turnoverAbsolute:toAbs, netWorthAbsolute:nwAbs, shareCapital:scAbs, netLoss:plAbs, auditor,
    turnover:toC(toAbs), networth:toC(nwAbs), paidUpCapital:toC(scAbs) };
};

const parseMGT7 = (txt, fileName) => {
  const cin = txt.match(/([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/)?.[1]||"";
  const nm1 = txt.match(/Name of the company\s+([A-Z][A-Z\s&,.()-]+(?:PRIVATE\s*LIMITED|LIMITED|LLP))/i)?.[1]||"";
  const srn = txt.match(/eForm Service request number.*?([A-Z0-9][\w-]+)/i)?.[1]||txt.match(/SRN\s+([A-Z0-9][\w-]+)/)?.[1]||"";
  const filingDate = txt.match(/eForm filing date.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const agmDate = txt.match(/date of AGM.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const fyFrom = txt.match(/Financial year.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const isSmallCompany = /Small Company/i.test(txt)?"Yes":"No";
  const companyType = txt.includes("Private")?"Private":txt.includes("Public")?"Public":"Private";
  const toAbs = parseInt(txt.match(/\*Turnover\s+(-?\d+)/)?.[1]||"0")||0;
  const nwAbs = parseInt(txt.match(/Net worth.*?(-?\d+)/i)?.[1]||"0")||0;
  const dirMatches = [...txt.matchAll(/(\d{8})\s+([A-Z][A-Z\s]+?)\s+(?:Director|Manager)/g)];
  const directors = dirMatches.map(m=>({ "DIN/PAN":m[1],"Name":m[2].replace(/\s+/g," ").trim(),"Designation":"Director","Date of Appointment":"—","Cessation Date":"—" }));
  return { type:"mgt7", fileName, cin, companyName:nm1.replace(/\s+/g," "), srn, filingDate, lastAGM:agmDate, fyFrom,
    isSmallCompany, companyType, directors, turnoverAbsolute:toAbs, netWorthAbsolute:nwAbs, turnover:toC(toAbs), networth:toC(nwAbs) };
};

const parseMDS = (file) => new Promise((res,rej) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result,{type:"array"});
      const raw = {}; wb.SheetNames.forEach(n=>{raw[n]=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:""})});
      const kv = {}; (raw["MasterData"]||raw[wb.SheetNames[0]]||[]).forEach(([k,v])=>{if(k)kv[String(k).trim()]=String(v??"").trim();});
      const classVal=(kv["Class of Company"]||"").toLowerCase();
      let companyType="Private"; if(classVal.includes("public"))companyType="Public"; else if(classVal.includes("llp"))companyType="LLP";
      const tC=(s)=>{const n=parseFloat(String(s||"").replace(/,/g,"")); return isNaN(n)?"": (n/10000000).toFixed(4);};
      const master = {
        companyName:kv["Company Name"]||"", cin:kv["CIN"]||"", companyType,
        listedStatus:(kv["Listed in Stock Exchange(s) (Y/N)"]||"").toLowerCase()==="yes"?"Listed":"Unlisted",
        incorporationDate:kv["Date of Incorporation"]||"",
        paidUpCapital:tC(kv["Paid up Capital (Rs)"]), authorisedCapital:tC(kv["Authorised Capital (Rs)"]),
        registeredAddress:kv["Registered Address"]||"", email:kv["Email Id"]||"",
        rocName:kv["ROC (name and office)"]||kv["ROC Name"]||"", companyStatus:kv["Company Status"]||"",
        isSmallCompany:kv["Small Company"]==="Yes"?"Yes":"No", activeCompliance:kv["ACTIVE compliance"]||"",
        lastAGM:kv["Date of last AGM"]||"", balanceSheetDate:kv["Date of Balance Sheet"]||"",
        category:kv["Category of Company"]||"", subcategory:kv["Subcategory of the Company"]||"",
        networth:"",turnover:"",netProfit:"",
      };
      const parseTable=(key)=>{
        const rows=raw[key]; if(!rows) return [];
        let hi=rows.findIndex(r=>r.filter(c=>String(c).trim()).length>1); if(hi<0) return [];
        const headers=rows[hi].map(h=>String(h).trim());
        return rows.slice(hi+1).filter(r=>r.some(c=>String(c).trim())).map(r=>Object.fromEntries(headers.map((h,i)=>[h,String(r[i]??"").trim()])));
      };
      const directors=parseTable("Director Details");
      const charges=parseTable("IndexOfCharges");
      master.hasCharges=charges.length>0;
      res({type:"mds",master,directors,charges,sheetNames:wb.SheetNames,raw});
    } catch(err){rej(err);}
  };
  reader.onerror=rej; reader.readAsArrayBuffer(file);
});

// ─── CSS ───────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Sora:wght@300;400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:#08080f}::-webkit-scrollbar-thumb{background:#202035;border-radius:3px}
input,select,textarea{outline:none;font-family:'Sora',sans-serif}
input::placeholder,textarea::placeholder{color:#252540}
.mono{font-family:'IBM Plex Mono',monospace}
@keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.up{animation:up .22s ease forwards}
.spin{animation:sp .7s linear infinite;border:2px solid #202035;border-top-color:#6366f1;border-radius:50%;width:18px;height:18px;display:inline-block;flex-shrink:0}
.pls{animation:pulse 2s ease infinite}
.card{background:#0b0b18;border:1px solid #181828;border-radius:12px;transition:.15s}
.card:hover{border-color:#242440}
.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:7px;border:1px solid #181828;background:transparent;color:#7a7a99;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:.13s;white-space:nowrap}
.btn:hover{border-color:#6366f1;color:#a5b4fc}
.btn.pri{background:linear-gradient(135deg,#6366f1,#4f46e5);border-color:transparent;color:#fff;box-shadow:0 2px 10px #6366f128}
.btn.pri:hover{box-shadow:0 4px 18px #6366f140;transform:translateY(-1px)}
.btn.red{border-color:#7f1d1d44;color:#f87171}.btn.red:hover{background:#7f1d1d18}
.inp{background:#0b0b18;border:1px solid #181828;border-radius:7px;padding:7px 11px;color:#e8e6ff;font-size:11px;transition:.13s;width:100%}
.inp:focus{border-color:#6366f150}
.bg{display:inline-flex;align-items:center;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:700}
.tab{padding:8px 16px;border-bottom:2px solid transparent;font-size:11px;font-weight:600;cursor:pointer;color:#3a3a55;transition:.13s;white-space:nowrap;background:transparent;border-left:none;border-right:none;border-top:none;font-family:inherit}
.tab.on{color:#a5b4fc;border-bottom-color:#6366f1}
.tab:hover:not(.on){color:#7a7a99}
.row{transition:.12s}.row:hover{background:#0d0d1c}
`;

// ─── EDIT STATUS FORM ──────────────────────────────────────────────────────
function EditForm({rule,init,onSave,onCancel}) {
  const [status,setStatus]=useState(init.status||"pending");
  const [srn,setSrn]=useState(init.srn||"");
  const [fd,setFd]=useState(init.filedDate||"");
  const [notes,setNotes]=useState(init.notes||"");
  return (
    <div>
      <div style={{marginBottom:12}}>
        <label style={{fontSize:9,fontWeight:700,color:"#3a3a55",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:5}}>Status</label>
        <div style={{display:"flex",gap:5}}>
          {[["pending","⏳ Pending"],["filed","✅ Filed"],["na","— N/A"]].map(([v,l])=>(
            <button key={v} onClick={()=>setStatus(v)} style={{flex:1,padding:"7px 0",borderRadius:6,border:`1px solid ${status===v?"#6366f1":"#181828"}`,background:status===v?"#6366f118":"transparent",color:status===v?"#a5b4fc":"#3a3a55",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:".13s"}}>{l}</button>
          ))}
        </div>
      </div>
      {status==="filed"&&<>
        <div style={{marginBottom:9}}>
          <label style={{fontSize:9,fontWeight:700,color:"#3a3a55",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>SRN</label>
          <input className="inp" placeholder="e.g. AB1234567" value={srn} onChange={e=>setSrn(e.target.value)}/>
        </div>
        <div style={{marginBottom:9}}>
          <label style={{fontSize:9,fontWeight:700,color:"#3a3a55",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>Date Filed (DD/MM/YYYY)</label>
          <input className="inp" placeholder="04/12/2025" value={fd} onChange={e=>setFd(e.target.value)}/>
        </div>
      </>}
      <div style={{marginBottom:13}}>
        <label style={{fontSize:9,fontWeight:700,color:"#3a3a55",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>Notes</label>
        <textarea className="inp" rows={2} placeholder="Any notes…" value={notes} onChange={e=>setNotes(e.target.value)} style={{resize:"none"}}/>
      </div>
      <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn pri" onClick={()=>onSave({status,srn,filedDate:fd,notes})}>Save</button>
      </div>
    </div>
  );
}

// ─── UPLOAD MODAL ─────────────────────────────────────────────────────────
function UploadModal({mode,setMode,onMds,onPdf,loading,err,onClose}) {
  const mdsRef=useRef(); const pdfRef=useRef();
  return (
    <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>e.target===e.currentTarget&&!loading&&onClose()}>
      <div style={{background:"#09091a",border:"1px solid #181828",borderRadius:16,padding:"22px",width:"100%",maxWidth:500,maxHeight:"90vh",overflowY:"auto"}} className="up">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div><div style={{fontSize:15,fontWeight:700}}>Upload Company Data</div><div style={{fontSize:10,color:"#3a3a55",marginTop:2}}>MDS Excel · AOC-4 PDF · MGT-7/7A PDF</div></div>
          {!loading&&<button className="btn" onClick={onClose}>✕</button>}
        </div>
        <div style={{display:"flex",gap:4,marginBottom:16,background:"#06060f",borderRadius:8,padding:3}}>
          {[["mds","📊 MDS Excel"],["aoc4","📋 AOC-4"],["mgt7","📋 MGT-7/7A"]].map(([k,l])=>(
            <button key={k} onClick={()=>!loading&&setMode(k)} style={{flex:1,padding:"7px 0",borderRadius:6,border:"none",background:mode===k?"linear-gradient(135deg,#6366f1,#4f46e5)":"transparent",color:mode===k?"#fff":"#3a3a55",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:".13s"}}>{l}</button>
          ))}
        </div>
        {mode==="mds"&&(
          <div>
            <p style={{fontSize:11,color:"#6a6a8a",lineHeight:1.7,marginBottom:12}}>Upload the <strong style={{color:"#aac"}}>Master Data Sheet (MDS)</strong> Excel from the MCA portal. MasterData, Director Details, and IndexOfCharges sheets are parsed automatically.</p>
            <input ref={mdsRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={e=>onMds(e.target.files[0])}/>
            <DropZone icon="📊" label="Drop MDS Excel here or click" sub=".xlsx / .xls" loading={loading} loadingText="Parsing MDS…" onClick={()=>!loading&&mdsRef.current?.click()}/>
          </div>
        )}
        {(mode==="aoc4"||mode==="mgt7")&&(
          <div>
            <p style={{fontSize:11,color:"#6a6a8a",lineHeight:1.7,marginBottom:10}}>
              Upload the <strong style={{color:"#aac"}}>{mode==="aoc4"?"AOC-4":"MGT-7 / MGT-7A"}</strong> PDF downloaded from MCA portal. Data is automatically extracted and merged with existing company records.
              <br/><span style={{color:"#fbbf24",fontSize:10}}>⚠ Requires text-based MCA eForms PDF (not scanned images)</span>
            </p>
            <input ref={pdfRef} type="file" accept=".pdf" style={{display:"none"}} onChange={e=>onPdf(e.target.files[0],mode)}/>
            <DropZone icon="📋" label={`Drop ${mode==="aoc4"?"AOC-4":"MGT-7"} PDF here or click`} sub=".pdf only" loading={loading} loadingText="Extracting from PDF…" onClick={()=>!loading&&pdfRef.current?.click()}/>
            <div style={{background:"#0b0b18",border:"1px solid #181828",borderRadius:8,padding:"10px 13px",marginTop:10}}>
              <div style={{fontSize:9,fontWeight:700,color:mode==="aoc4"?"#93c5fd":"#c4b5fd",textTransform:"uppercase",letterSpacing:".5px",marginBottom:6}}>Extracts from {mode==="aoc4"?"AOC-4":"MGT-7/7A"}</div>
              {(mode==="aoc4"
                ?["CIN & Company Name","Financial Year (From/To)","Turnover (Services/Goods)","Net Worth","Share Capital","AGM Date","Auditor Firm","SRN & Filing Date"]
                :["CIN & Company Name","Class (Private/Public/OPC)","Small Company Flag","AGM Date","Directors (DIN + Name)","Turnover & Net Worth","SRN & Filing Date"]
              ).map(f=><div key={f} style={{fontSize:10,color:"#4a4a66",marginBottom:2}}>✓ {f}</div>)}
            </div>
          </div>
        )}
        {err&&<div style={{background:"#7f1d1d18",border:"1px solid #7f1d1d44",borderRadius:7,padding:"8px 12px",fontSize:11,color:"#fca5a5",marginTop:10}}>⚠ {err}</div>}
      </div>
    </div>
  );
}

function DropZone({icon,label,sub,loading,loadingText,onClick}) {
  const [drag,setDrag]=useState(false);
  return (
    <div onDrop={e=>{e.preventDefault();setDrag(false);}} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onClick={onClick}
      style={{border:`2px dashed ${drag?"#6366f1":"#181828"}`,borderRadius:10,padding:"30px 20px",textAlign:"center",cursor:"pointer",background:drag?"#6366f108":"#0b0b18",transition:".16s"}}>
      {loading
        ?<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}><div className="spin"/><div style={{fontSize:11,color:"#3a3a55"}}>{loadingText}</div></div>
        :<><div style={{fontSize:30,marginBottom:8}}>{icon}</div><div style={{fontWeight:700,fontSize:12}}>{label}</div><div style={{fontSize:10,color:"#3a3a55",marginTop:3}}>{sub}</div></>}
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────
export default function App() {
  const [db,setDb]=useState({companies:{}});
  const [screen,setScreen]=useState("dash");
  const [selCin,setSelCin]=useState(null);
  const [tab,setTab]=useState("compliances");
  const [showUpload,setShowUpload]=useState(false);
  const [uploadMode,setUploadMode]=useState("mds");
  const [uploading,setUploading]=useState(false);
  const [uploadErr,setUploadErr]=useState("");
  const [editStatus,setEditStatus]=useState(null);
  const [filterCat,setFilterCat]=useState("All");
  const [filterSt,setFilterSt]=useState("All");
  const [search,setSearch]=useState("");
  const [delConfirm,setDelConfirm]=useState(null);
  const [dataLoading,setDataLoading]=useState(true);

  /* ==============================
     FETCH ALL COMPANIES FROM BACKEND
  ============================== */
  const fetchCompanies = async () => {
    try {
      const res = await fetch(`${API_BASE}/companies`);
      if (!res.ok) throw new Error("Failed to fetch companies");
      const data = await res.json();
      const companiesObj = {};
      data.forEach(co => {
        companiesObj[co.cin] = co;
      });
      setDb({companies: companiesObj});
    } catch (err) {
      console.error("Error fetching companies:", err);
    }
  };

  /* ==============================
     FETCH SINGLE COMPANY
  ============================== */
  const fetchSingleCompany = async (cin) => {
    try {
      const res = await fetch(`${API_BASE}/companies/${cin}`);
      if (!res.ok) return;
      const updatedCo = await res.json();
      setDb(prev => ({
        ...prev,
        companies: { ...prev.companies, [cin]: updatedCo }
      }));
    } catch (e) {}
  };

  /* ==============================
     SAVE / UPDATE COMPANY TO BACKEND
  ============================== */
  const saveCompanyToBackend = async (companyData) => {
    try {
      const res = await fetch(`${API_BASE}/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(companyData),
      });
      if (!res.ok) throw new Error("Failed to save company");
      await fetchCompanies();
    } catch (err) {
      console.error(err);
      alert("❌ Failed to save to backend");
    }
  };

  /* ==============================
     UPDATE FILING STATUS ON BACKEND
  ============================== */
  const updateFilingStatusAPI = async (cin, ruleId, statusData) => {
    try {
      const res = await fetch(`${API_BASE}/filing-status/${cin}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: ruleId, ...statusData }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      await fetchCompanies();
    } catch (err) {
      console.error(err);
      alert("❌ Failed to update filing status");
    }
  };

  /* ==============================
     INITIAL LOAD
  ============================== */
  useEffect(() => {
    (async () => {
      await fetchCompanies();
      setDataLoading(false);
    })();
  }, []);

  const companies = useMemo(() => Object.values(db.companies), [db]);
  const company = useMemo(() => selCin && db.companies[selCin] ? db.companies[selCin] : null, [selCin, db]);

  const applicable = useMemo(() => company ? COMPLIANCE_RULES.filter(r => r.applies(company)) : [], [company]);
  const filtered = useMemo(() => applicable.filter(r => {
    const st = company?.filingStatus?.[r.id]?.status || "pending";
    return (filterCat === "All" || r.cat === filterCat) &&
           (filterSt === "All" || filterSt === st) &&
           (!search || r.title.toLowerCase().includes(search.toLowerCase()) || r.form.toLowerCase().includes(search.toLowerCase()));
  }), [applicable, filterCat, filterSt, search, company]);

  const globalUpcoming = useMemo(() => {
    const items = [];
    for (const co of companies) {
      for (const rule of COMPLIANCE_RULES.filter(r => r.applies(co))) {
        const st = co.filingStatus?.[rule.id]?.status || "pending";
        if (st === "filed" || st === "na") continue;
        const { upcoming: u } = calcDueDates(rule, co);
        if (!u?.date) continue;
        const n = daysLeft(u.date);
        if (n !== null && n >= 0 && n <= 90) items.push({ cin: co.cin, name: co.companyName, rule, date: u.date, label: u.label, n });
      }
    }
    return items.sort((a, b) => a.n - b.n);
  }, [companies]);

  const coStats = useMemo(() => {
    const s = {};
    for (const co of companies) {
      const rules = COMPLIANCE_RULES.filter(r => r.applies(co));
      let filed = 0, overdue = 0, up30 = 0;
      for (const r of rules) {
        const st = co.filingStatus?.[r.id]?.status || "pending";
        if (st === "filed") { filed++; continue; }
        if (st === "na") continue;
        const { upcoming: u } = calcDueDates(r, co);
        if (!u?.date) continue;
        const n = daysLeft(u.date);
        if (n !== null && n < 0) overdue++;
        else if (n !== null && n <= 30) up30++;
      }
      s[co.cin] = { total: rules.length, filed, overdue, up30 };
    }
    return s;
  }, [companies]);

  const handleMDS = async (file) => {
    if (!file?.name.match(/\.(xlsx|xls)$/i)) { setUploadErr("Upload a valid .xlsx/.xls file"); return; }
    setUploading(true); setUploadErr("");
    try {
      const p = await parseMDS(file);
      if (!p.master.cin) { setUploadErr("CIN not found in file."); setUploading(false); return; }
      const ex = db.companies[p.master.cin] || { filingStatus: {}, documents: [] };
      const updatedCompany = {
        ...ex,
        ...p.master,
        directors: p.directors,
        charges: p.charges,
        updatedAt: new Date().toISOString(),
        filingStatus: ex.filingStatus || {},
        documents: ex.documents || []
      };
      await saveCompanyToBackend(updatedCompany);
      setShowUpload(false);
      setSelCin(p.master.cin);
      setScreen("company");
      setTab("compliances");
    } catch (e) {
      setUploadErr("Parse failed. Ensure it's a valid MCA MDS Excel.");
    }
    setUploading(false);
  };

  const handlePDF = async (file, type) => {
    if (!file?.name.match(/\.pdf$/i)) { setUploadErr("Upload a valid .pdf file"); return; }
    setUploading(true); setUploadErr("");
    try {
      const txt = await extractPdfText(file);
      const p = type === "aoc4" ? parseAOC4(txt, file.name) : parseMGT7(txt, file.name);
      if (!p.cin) { setUploadErr("CIN not found. Ensure this is a text-based MCA eForm PDF."); setUploading(false); return; }
      const ex = db.companies[p.cin] || { cin: p.cin, filingStatus: {}, documents: [], hasCharges: false, listedStatus: "Unlisted", companyStatus: "Active" };
      const autoFiled = {
        ...(type === "mgt7" && p.srn ? { [p.isSmallCompany === "Yes" ? "mgt7a" : "mgt7"]: { status: "filed", srn: p.srn, filedDate: p.filingDate, notes: "Auto-imported from PDF" } } : {}),
        ...(type === "aoc4" && p.srn ? { aoc4: { status: "filed", srn: p.srn, filedDate: p.filingDate, notes: "Auto-imported from PDF" } } : {}),
      };
      const updated = {
        ...ex,
        cin: p.cin,
        companyName: p.companyName || ex.companyName,
        lastAGM: p.lastAGM || ex.lastAGM,
        isSmallCompany: p.isSmallCompany || ex.isSmallCompany || "No",
        companyType: p.companyType || ex.companyType || "Private",
        ...(p.turnover ? { turnover: p.turnover } : {}),
        ...(p.networth ? { networth: p.networth } : {}),
        ...(p.paidUpCapital ? { paidUpCapital: p.paidUpCapital } : {}),
        ...(p.directors?.length ? { directors: p.directors } : {}),
        updatedAt: new Date().toISOString(),
        documents: [
          ...(ex.documents || []).filter(d => d.srn !== p.srn),
          {
            type: p.type,
            form: type === "aoc4" ? "AOC-4" : "MGT-7/MGT-7A",
            srn: p.srn,
            filingDate: p.filingDate,
            fyFrom: p.fyFrom,
            fyTo: p.fyTo || "",
            fileName: file.name,
            auditor: p.auditor || ""
          }
        ],
        filingStatus: { ...(ex.filingStatus || {}), ...autoFiled }
      };
      await saveCompanyToBackend(updated);
      setShowUpload(false);
      setSelCin(p.cin);
      setScreen("company");
      setTab("compliances");
    } catch (e) {
      console.error(e);
      setUploadErr("PDF parse failed. Ensure this is a text-based MCA eForm PDF.");
    }
    setUploading(false);
  };

  const updateStatus = async (cin, rid, data) => {
    await updateFilingStatusAPI(cin, rid, data);
    setEditStatus(null);
  };

  const deleteCompany = async (cin) => {
    try {
      await fetch(`${API_BASE}/companies/${cin}`, { method: "DELETE" });
      await fetchCompanies();
      if (selCin === cin) { setSelCin(null); setScreen("dash"); }
      setDelConfirm(null);
    } catch (err) {
      console.error(err);
      alert("❌ Failed to delete company");
    }
  };

  if (dataLoading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#07070f",gap:10,fontFamily:"Sora,sans-serif"}}>
      <div className="spin"/><span style={{color:"#3a3a55",fontSize:12}}>Loading from backend…</span>
    </div>
  );

  return (
    <div style={{fontFamily:"'Sora',sans-serif",minHeight:"100vh",background:"#07070f",color:"#e8e6ff"}}>
      <style>{CSS}</style>
      {/* NAV */}
      <div style={{background:"#08081a",borderBottom:"1px solid #101025",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,backdropFilter:"blur(10px)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#6366f1,#4f46e5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,boxShadow:"0 0 14px #6366f128",cursor:"pointer"}} onClick={()=>{setScreen("dash");setSelCin(null);}}>⚖️</div>
          <div>
            <div style={{fontWeight:700,fontSize:13,letterSpacing:"-.2px"}}>ROC Compliance Tracker</div>
            <div style={{fontSize:9,color:"#2a2a42",fontWeight:500,textTransform:"uppercase",letterSpacing:".5px"}}>Companies Act 2013 · MCA (Backend Powered)</div>
          </div>
          {screen==="company"&&company&&(
            <div style={{display:"flex",alignItems:"center",gap:5,marginLeft:10,paddingLeft:10,borderLeft:"1px solid #131325"}}>
              <span style={{fontSize:10,color:"#3a3a55",cursor:"pointer"}} onClick={()=>{setScreen("dash");setSelCin(null);}}>Dashboard</span>
              <span style={{fontSize:10,color:"#1f1f35"}}>›</span>
              <span style={{fontSize:11,color:"#7a7a99",fontWeight:600,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{company.companyName}</span>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:7,alignItems:"center"}}>
          {globalUpcoming.length>0&&(
            <div style={{display:"flex",alignItems:"center",gap:5,background:"#fb923c14",border:"1px solid #fb923c28",borderRadius:6,padding:"4px 9px",cursor:"pointer"}} onClick={()=>setScreen("dash")}>
              <span className="pls" style={{color:"#fb923c",fontSize:12,lineHeight:1}}>●</span>
              <span style={{fontSize:10,fontWeight:700,color:"#fb923c"}}>{globalUpcoming.length} due in 90d</span>
            </div>
          )}
          <button className="btn pri" onClick={()=>{setShowUpload(true);setUploadMode("mds");setUploadErr("");}}>+ Add / Update Company</button>
        </div>
      </div>
      <div style={{maxWidth:1140,margin:"0 auto",padding:"22px 16px"}}>
        {/* ── DASHBOARD ── */}
        {screen==="dash"&&(
          <div className="up">
            {/* Stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:9,marginBottom:20}}>
              {[
                ["Companies",companies.length, "#a5b4fc","#1d4ed828"],
                ["Total Applicable",companies.reduce((a,c)=>a+(COMPLIANCE_RULES.filter(r=>r.applies(c)).length),0),"#6ee7b7","#065f4628"],
                ["⚠ Overdue", companies.reduce((a,c)=>a+(coStats[c.cin]?.overdue||0),0),"#f87171","#7f1d1d28"],
                ["📅 Due ≤30d", globalUpcoming.filter(x=>x.n<=30).length,"#fb923c","#7c2d1228"],
              ].map(([l,v,col,bg])=>(
                <div key={l} className="card" style={{padding:"13px 15px",borderLeft:`3px solid ${col}44`}}>
                  <div style={{fontSize:22,fontWeight:800,color:col,fontFamily:"IBM Plex Mono,monospace"}}>{v}</div>
                  <div style={{fontSize:9,color:"#3a3a55",marginTop:2,fontWeight:600,textTransform:"uppercase",letterSpacing:".4px"}}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:14,alignItems:"start"}}>
              {/* Companies list */}
              <div>
                <div style={{fontSize:11,fontWeight:700,color:"#6a6a8a",marginBottom:10,letterSpacing:".3px"}}>COMPANIES ({companies.length})</div>
                <div style={{display:"flex",flexDirection:"column",gap:9}}>
                  {companies.length===0?(
                    <div className="card" style={{padding:"36px 20px",textAlign:"center"}}>
                      <div style={{fontSize:26,marginBottom:8}}>📂</div>
                      <div style={{fontSize:12,fontWeight:600,color:"#4a4a66",marginBottom:4}}>No companies yet</div>
                      <div style={{fontSize:10,color:"#2a2a40",marginBottom:14}}>Upload an MDS Excel or AOC-4/MGT-7 PDF to get started</div>
                      <button className="btn pri" onClick={()=>setShowUpload(true)}>+ Add Company</button>
                    </div>
                  ):companies.map(co=>{
                    const st=coStats[co.cin]||{};
                    return (
                      <div key={co.cin} className="card" style={{padding:"14px 16px",cursor:"pointer"}} onClick={()=>{setSelCin(co.cin);setScreen("company");setTab("compliances");setFilterCat("All");setFilterSt("All");setSearch("");}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:700,marginBottom:4,lineHeight:1.3}}>{co.companyName}</div>
                            <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
                              <span className="mono bg" style={{background:"#10102a",color:"#6366f1",fontSize:9}}>{co.cin}</span>
                              <span className="bg" style={{background:"#13132a",color:"#7a7a99"}}>{co.companyType}</span>
                              {co.isSmallCompany==="Yes"&&<span className="bg" style={{background:"#1e3a5f18",color:"#7dd3fc",border:"1px solid #1e3a5f33"}}>Small Co.</span>}
                              {co.companyStatus&&<span className="bg" style={{background:"#14532d18",color:"#4ade80"}}>{co.companyStatus}</span>}
                            </div>
                          </div>
                          <div style={{display:"flex",gap:6,flexShrink:0}}>
                            {st.overdue>0&&<div style={{textAlign:"center",background:"#7f1d1d18",border:"1px solid #7f1d1d33",borderRadius:7,padding:"5px 10px"}}><div style={{fontSize:15,fontWeight:800,color:"#f87171",fontFamily:"IBM Plex Mono,monospace"}}>{st.overdue}</div><div style={{fontSize:8,color:"#f87171",fontWeight:700}}>OVERD</div></div>}
                            {st.up30>0&&<div style={{textAlign:"center",background:"#7c2d1218",border:"1px solid #fb923c28",borderRadius:7,padding:"5px 10px"}}><div style={{fontSize:15,fontWeight:800,color:"#fb923c",fontFamily:"IBM Plex Mono,monospace"}}>{st.up30}</div><div style={{fontSize:8,color:"#fb923c",fontWeight:700}}>30D</div></div>}
                            <div style={{textAlign:"center",background:"#1d4ed818",border:"1px solid #3b82f628",borderRadius:7,padding:"5px 10px"}}><div style={{fontSize:15,fontWeight:800,color:"#93c5fd",fontFamily:"IBM Plex Mono,monospace"}}>{st.total}</div><div style={{fontSize:8,color:"#93c5fd",fontWeight:700}}>TOTAL</div></div>
                          </div>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:9,paddingTop:8,borderTop:"1px solid #0f0f1e",fontSize:9,color:"#2a2a40"}}>
                          <span>AGM: <span style={{color:"#5a5a7a"}}>{co.lastAGM||"—"}</span> · Docs: <span style={{color:"#5a5a7a"}}>{(co.documents||[]).length}</span></span>
                          <span>Filed: <span style={{color:"#4ade80"}}>{st.filed||0}</span>/{st.total}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Upcoming panel */}
              <div>
                <div style={{fontSize:11,fontWeight:700,color:"#6a6a8a",marginBottom:10,letterSpacing:".3px"}}>UPCOMING (90 DAYS)</div>
                <div className="card" style={{overflow:"hidden"}}>
                  {globalUpcoming.length===0?(
                    <div style={{padding:"26px 14px",textAlign:"center",color:"#2a2a40",fontSize:11}}>✅ No pending deadlines in 90 days</div>
                  ):globalUpcoming.slice(0,12).map((item,i)=>{
                    const u=urgency(item.n);
                    return (
                      <div key={i} className="row" style={{padding:"9px 13px",borderBottom:i<Math.min(globalUpcoming.length,12)-1?"1px solid #0d0d1c":"none",cursor:"pointer"}} onClick={()=>{setSelCin(item.cin);setScreen("company");setTab("compliances");}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
                          <div style={{minWidth:0,flex:1}}>
                            <div style={{fontSize:10,fontWeight:700,color:"#93c5fd",marginBottom:1}}>{item.rule.form}</div>
                            <div style={{fontSize:9,color:"#5a5a7a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name.length>26?item.name.slice(0,26)+"…":item.name}</div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0}}>
                            <div style={{fontSize:10,fontWeight:700,color:u.col,background:u.bg,padding:"2px 6px",borderRadius:4}}>{u.label}</div>
                            <div style={{fontSize:9,color:"#3a3a55",marginTop:2}}>{fmt(item.date)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {globalUpcoming.length>12&&<div style={{padding:"7px 13px",textAlign:"center",fontSize:9,color:"#3a3a55",borderTop:"1px solid #0d0d1c"}}>+{globalUpcoming.length-12} more</div>}
                </div>
              </div>
            </div>
          </div>
        )}
        {/* ── COMPANY DETAIL ── */}
        {screen==="company"&&company&&(
          <div className="up">
            {/* Header */}
            <div className="card" style={{padding:"15px 18px",marginBottom:14,display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <div>
                <div style={{fontSize:9,fontWeight:700,color:"#6366f1",letterSpacing:".6px",textTransform:"uppercase",marginBottom:4}}>Company</div>
                <div style={{fontSize:16,fontWeight:700,letterSpacing:"-.2px"}}>{company.companyName}</div>
                <div style={{fontSize:10,color:"#2a2a42",marginTop:2,fontFamily:"IBM Plex Mono,monospace"}}>{company.cin}</div>
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                {company.companyStatus&&<span className="bg" style={{background:"#14532d18",color:"#4ade80",border:"1px solid #14532d33"}}>{company.companyStatus}</span>}
                {company.isSmallCompany==="Yes"&&<span className="bg" style={{background:"#1e3a5f18",color:"#7dd3fc",border:"1px solid #1e3a5f33"}}>Small Co.</span>}
                <span className="bg" style={{background:"#13132a",color:"#7a7a99"}}>{company.companyType}</span>
                <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("mds");setUploadErr("");}}>↑ Update MDS</button>
                <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("aoc4");setUploadErr("");}}>+ AOC-4</button>
                <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("mgt7");setUploadErr("");}}>+ MGT-7</button>
                <button className="btn red" onClick={()=>setDelConfirm(company.cin)}>✕</button>
              </div>
            </div>
            {/* Info chips */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:7,marginBottom:14}}>
              {[["Incorporation",company.incorporationDate||"—"],["Last AGM",company.lastAGM||"—"],["Balance Sheet",company.balanceSheetDate||"—"],["ROC",company.rocName||"—"],["Paid-up Capital",company.paidUpCapital?`₹${(+company.paidUpCapital).toFixed(2)} Cr`:"—"],["Net Worth",company.networth?`₹${(+company.networth*10000000).toLocaleString("en-IN")}`:company.networth==="0.0000"?"₹0":"—"]].map(([l,v])=>(
                <div key={l} style={{background:"#0b0b18",border:"1px solid #181828",borderRadius:7,padding:"8px 11px"}}>
                  <div style={{fontSize:8,color:"#2a2a42",fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",marginBottom:3}}>{l}</div>
                  <div style={{fontSize:11,fontWeight:600,color:"#9999bb"}}>{v}</div>
                </div>
              ))}
            </div>
            {/* Tabs */}
            <div style={{display:"flex",borderBottom:"1px solid #101025",marginBottom:14,overflowX:"auto"}}>
              {[["compliances","Compliances"],["directors","Directors"],["documents","Documents"],["financials","Financials"]].map(([k,l])=>(
                <button key={k} className={`tab${tab===k?" on":""}`} onClick={()=>setTab(k)}>{l} {k==="compliances"&&<span style={{fontSize:9,marginLeft:3,color:tab===k?"#a5b4fc":"#2a2a42"}}>({applicable.length})</span>}</button>
              ))}
            </div>
            {/* COMPLIANCES TAB */}
            {tab==="compliances"&&(
              <div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:13,alignItems:"center"}}>
                  <input className="inp" style={{maxWidth:190,padding:"5px 9px",fontSize:10}} placeholder="🔍 Search…" value={search} onChange={e=>setSearch(e.target.value)}/>
                  <select className="inp" style={{width:"auto",padding:"5px 9px",fontSize:10}} value={filterSt} onChange={e=>setFilterSt(e.target.value)}>
                    <option value="All">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="filed">Filed</option>
                    <option value="na">N/A</option>
                  </select>
                  <select className="inp" style={{width:"auto",padding:"5px 9px",fontSize:10}} value={filterCat} onChange={e=>setFilterCat(e.target.value)}>
                    <option value="All">All Categories</option>
                    {[...new Set(applicable.map(r=>r.cat))].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <div style={{marginLeft:"auto",fontSize:10,color:"#3a3a55"}}>
                    {applicable.filter(r=>(company.filingStatus?.[r.id]?.status||"pending")==="filed").length}/{applicable.length} filed
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))",gap:9}}>
                  {filtered.map(rule=>{
                    const col=CAT_COL[rule.cat]||{bg:"#1e1e3022",bd:"#1e1e3066",txt:"#8b8baa"};
                    const st=company.filingStatus?.[rule.id]||{status:"pending"};
                    const{upcoming:u,past:p}=calcDueDates(rule,company);
                    const n=u?daysLeft(u.date):null;
                    const urg=urgency(n);
                    return (
                      <div key={rule.id} className="card" style={{padding:"13px 15px",position:"relative"}}>
                        <div style={{position:"absolute",top:11,right:11,display:"flex",gap:4}}>
                          {st.status==="filed"&&<span className="bg" style={{background:"#14532d18",color:"#4ade80",border:"1px solid #14532d33"}}>✓ Filed</span>}
                          {st.status==="na"&&<span className="bg" style={{background:"#13132a",color:"#5a5a7a"}}>N/A</span>}
                          {st.status==="pending"&&n!==null&&<span className="bg" style={{background:urg.bg,color:urg.col}}>{urg.label}</span>}
                        </div>
                        <div style={{paddingRight:90}}>
                          <div style={{display:"flex",gap:5,alignItems:"center",marginBottom:3}}>
                            <span style={{fontWeight:800,fontSize:11,color:col.txt,fontFamily:"IBM Plex Mono,monospace"}}>{rule.form}</span>
                            <span className="bg" style={{background:col.bg,color:col.txt,border:`1px solid ${col.bd}`,fontSize:9}}>{rule.cat}</span>
                          </div>
                          <div style={{fontWeight:600,fontSize:11,marginBottom:7,color:"#ccccee",lineHeight:1.3}}>{rule.title}</div>
                        </div>
                        <div style={{height:1,background:"#0d0d1c",marginBottom:7}}/>
                        <div style={{display:"flex",flexDirection:"column",gap:4,fontSize:10}}>
                          {u&&<div style={{display:"flex",gap:5}}><span style={{color:"#2a2a42",minWidth:40,fontWeight:700,textTransform:"uppercase",fontSize:8,letterSpacing:".4px",paddingTop:1}}>Next</span><span style={{color:"#9999bb"}}>{fmt(u.date)} <span style={{color:"#3a3a55",fontSize:9}}>({u.label})</span></span></div>}
                          {st.status==="filed"&&<div style={{display:"flex",gap:5}}><span style={{color:"#2a2a42",minWidth:40,fontWeight:700,textTransform:"uppercase",fontSize:8,letterSpacing:".4px"}}>Filed</span><span style={{color:"#4ade80"}}>{st.filedDate||"—"} {st.srn&&<span className="mono" style={{color:"#2a6a52",fontSize:9}}>{st.srn}</span>}</span></div>}
                          {st.notes&&<div style={{fontSize:9,color:"#2a2a42",fontStyle:"italic",marginTop:1}}>"{st.notes}"</div>}
                          <div style={{display:"flex",gap:5}}><span style={{color:"#2a2a42",minWidth:40,fontWeight:700,textTransform:"uppercase",fontSize:8,letterSpacing:".4px"}}>Law</span><span style={{color:"#2a2a42",fontSize:9}}>{rule.section}</span></div>
                        </div>
                        <div style={{marginTop:8}}>
                          <button className="btn" style={{fontSize:10,padding:"3px 9px"}} onClick={()=>setEditStatus({cin:company.cin,id:rule.id,current:st})}>
                            {st.status==="filed"?"✎ Edit":"📋 Update Status"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {filtered.length===0&&<div style={{textAlign:"center",padding:"36px",color:"#2a2a40"}}><div style={{fontSize:24,marginBottom:7}}>🔎</div><div style={{fontSize:12}}>No compliances match filters</div></div>}
              </div>
            )}
            {/* DIRECTORS TAB */}
            {tab==="directors"&&(
              <div>
                {!(company.directors||[]).length?(
                  <div style={{textAlign:"center",padding:"36px",color:"#3a3a55",fontSize:11}}>No directors data — upload MDS Excel or MGT-7 PDF to populate</div>
                ):(
                  <div className="card" style={{overflow:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead><tr style={{borderBottom:"1px solid #0f0f1e"}}>
                        {["#","DIN/PAN","Name","Designation","Category","Appointed","Cessation"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:8,fontWeight:700,color:"#2a2a42",textTransform:"uppercase",letterSpacing:".5px",whiteSpace:"nowrap"}}>{h}</th>)}
                      </tr></thead>
                      <tbody>{(company.directors||[]).map((d,i)=>(
                        <tr key={i} className="row" style={{borderBottom:i<company.directors.length-1?"1px solid #0d0d1c":"none"}}>
                          <td style={{padding:"8px 12px",color:"#2a2a42"}}>{i+1}</td>
                          <td style={{padding:"8px 12px",fontFamily:"IBM Plex Mono,monospace",fontSize:10,color:"#818cf8"}}>{d["DIN/PAN"]||"—"}</td>
                          <td style={{padding:"8px 12px",fontWeight:600}}>{d["Name"]||"—"}</td>
                          <td style={{padding:"8px 12px",color:"#7a7a99"}}>{d["Designation"]||"—"}</td>
                          <td style={{padding:"8px 12px",color:"#4a4a66"}}>{d["Category"]||"—"}</td>
                          <td style={{padding:"8px 12px",color:"#4a4a66",whiteSpace:"nowrap"}}>{d["Date of Appointment"]||"—"}</td>
                          <td style={{padding:"8px 12px",color:(d["Cessation Date"]&&d["Cessation Date"]!=="-")?"#f87171":"#1a1a2e"}}>{d["Cessation Date"]||"—"}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {/* DOCUMENTS TAB */}
            {tab==="documents"&&(
              <div>
                <div style={{display:"flex",gap:6,justifyContent:"flex-end",marginBottom:11}}>
                  <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("aoc4");setUploadErr("");}}>+ AOC-4 PDF</button>
                  <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("mgt7");setUploadErr("");}}>+ MGT-7 PDF</button>
                </div>
                {!(company.documents||[]).length?(
                  <div style={{textAlign:"center",padding:"36px",color:"#3a3a55",fontSize:11}}>No documents uploaded yet</div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {(company.documents||[]).map((doc,i)=>(
                      <div key={i} className="card" style={{padding:"12px 15px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                        <div style={{display:"flex",gap:10,alignItems:"center"}}>
                          <div style={{width:34,height:34,borderRadius:7,background:"#1d4ed818",border:"1px solid #3b82f628",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>{doc.type==="aoc4"?"📊":"📋"}</div>
                          <div>
                            <div style={{fontSize:11,fontWeight:700,color:"#93c5fd"}}>{doc.form||doc.type.toUpperCase()} <span className="mono" style={{fontSize:10,color:"#3a3a55"}}>{doc.srn}</span></div>
                            <div style={{fontSize:10,color:"#3a3a55",marginTop:2}}>{doc.fileName} · Filed: {doc.filingDate||"—"} · FY {doc.fyFrom?.slice(6)||"—"}–{doc.fyTo?.slice(6)||"—"}</div>
                            {doc.auditor&&<div style={{fontSize:9,color:"#2a2a42"}}>Auditor: {doc.auditor}</div>}
                          </div>
                        </div>
                        {doc.filingDate&&<span className="bg" style={{background:"#14532d18",color:"#4ade80",border:"1px solid #14532d33"}}>✓ {doc.filingDate}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* FINANCIALS TAB */}
            {tab==="financials"&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11}}>
                <div className="card" style={{padding:"14px 16px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#93c5fd",marginBottom:11}}>Capital Structure</div>
                  {[["Authorised Capital",company.authorisedCapital?(+company.authorisedCapital*10000000).toLocaleString("en-IN"):"—"],["Paid-up Capital",company.paidUpCapital?(+company.paidUpCapital*10000000).toLocaleString("en-IN"):"—"],["Net Worth",company.networth?(+company.networth*10000000).toLocaleString("en-IN"):"—"]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #0d0d1c"}}>
                      <span style={{fontSize:10,color:"#5a5a7a"}}>{l}</span>
                      <span style={{fontSize:10,fontWeight:700,fontFamily:"IBM Plex Mono,monospace",color:"#e8e6ff"}}>₹{v}</span>
                    </div>
                  ))}
                </div>
                <div className="card" style={{padding:"14px 16px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#6ee7b7",marginBottom:11}}>P&L Summary</div>
                  {[["Turnover",company.turnover?(+company.turnover*10000000).toLocaleString("en-IN"):"—"],["Net Profit/Loss",company.netProfit?(+company.netProfit*10000000).toLocaleString("en-IN"):"—"]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #0d0d1c"}}>
                      <span style={{fontSize:10,color:"#5a5a7a"}}>{l}</span>
                      <span style={{fontSize:10,fontWeight:700,fontFamily:"IBM Plex Mono,monospace",color:"#e8e6ff"}}>₹{v}</span>
                    </div>
                  ))}
                </div>
                <div className="card" style={{padding:"13px 16px",gridColumn:"1/-1"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#fbbf24",marginBottom:10}}>Manual Entry — Financial Data</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:9}}>
                    {[["turnover","Turnover (₹ Cr)"],["networth","Net Worth (₹ Cr)"],["netProfit","Net Profit (₹ Cr)"]].map(([k,l])=>(
                      <div key={k}>
                        <label style={{fontSize:8,fontWeight:700,color:"#3a3a55",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>{l}</label>
                        <input className="inp" type="number" step="0.0001" placeholder="0.0000" value={company[k]||""} onChange={async e=>{const nd={...db,companies:{...db.companies,[company.cin]:{...company,[k]:e.target.value}}};await saveCompanyToBackend(nd.companies[company.cin]);}}/>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:9,color:"#2a2a42"}}>Enter in Crore (₹ Cr). These values determine applicability of CSR and XBRL filings.</div>
                  <div style={{marginTop:10,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:5}}>
                    {[["PaidUp ≥ ₹500 Cr → XBRL",+company.paidUpCapital>=500],["Turnover ≥ ₹500 Cr → XBRL",+company.turnover>=500],["NW ≥ ₹500 Cr → CSR",+company.networth>=500],["Turnover ≥ ₹1000 Cr → CSR",+company.turnover>=1000],["Net Profit ≥ ₹5 Cr → CSR",+company.netProfit>=5]].map(([l,v])=>(
                      <div key={l} style={{fontSize:9,color:v?"#f87171":"#3a3a55"}}>{v?"⚠":"✓"} {l}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {/* UPLOAD MODAL */}
      {showUpload&&<UploadModal mode={uploadMode} setMode={setUploadMode} onMds={handleMDS} onPdf={handlePDF} loading={uploading} err={uploadErr} onClose={()=>!uploading&&setShowUpload(false)}/>}
      {/* EDIT STATUS MODAL */}
      {editStatus&&(()=>{
        const rule=COMPLIANCE_RULES.find(r=>r.id===editStatus.id);
        return (
          <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>e.target===e.currentTarget&&setEditStatus(null)}>
            <div style={{background:"#09091a",border:"1px solid #181828",borderRadius:14,padding:"20px",width:"100%",maxWidth:420}} className="up">
              <div style={{fontSize:13,fontWeight:700,marginBottom:3}}>Update Filing Status</div>
              <div style={{fontSize:10,color:"#3a3a55",marginBottom:14}}>{rule?.form} — {rule?.title}</div>
              <EditForm rule={rule} init={editStatus.current} onSave={d=>updateStatus(editStatus.cin,editStatus.id,d)} onCancel={()=>setEditStatus(null)}/>
            </div>
          </div>
        );
      })()}
      {/* DELETE CONFIRM */}
      {delConfirm&&(
        <div style={{position:"fixed",inset:0,background:"#00000090",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>e.target===e.currentTarget&&setDelConfirm(null)}>
          <div style={{background:"#09091a",border:"1px solid #7f1d1d44",borderRadius:14,padding:"22px",width:"100%",maxWidth:360,textAlign:"center"}} className="up">
            <div style={{fontSize:24,marginBottom:8}}>⚠️</div>
            <div style={{fontSize:14,fontWeight:700,marginBottom:5}}>Remove Company?</div>
            <div style={{fontSize:11,color:"#5a5a7a",marginBottom:18}}>All data for <strong style={{color:"#e8e6ff"}}>{db?.companies[delConfirm]?.companyName}</strong> will be permanently removed from MongoDB.</div>
            <div style={{display:"flex",gap:8,justifyContent:"center"}}>
              <button className="btn" onClick={()=>setDelConfirm(null)}>Cancel</button>
              <button className="btn red" onClick={()=>deleteCompany(delConfirm)}>Yes, Remove</button>
            </div>
          </div>
        </div>
      )}
      <div style={{maxWidth:1140,margin:"0 auto",padding:"0 16px 18px"}}>
        <div style={{padding:"9px 13px",background:"#7f1d1d06",border:"1px solid #7f1d1d18",borderRadius:7,fontSize:9,color:"#2a2a40",lineHeight:1.7}}>
          ⚠ <strong style={{color:"#f87171"}}>Backend Powered</strong> — Single source of truth = MongoDB + FastAPI. 950 lines of pure React.
        </div>
      </div>
    </div>
  );
}
