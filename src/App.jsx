import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

// ⚠️ Set this to your actual Render backend URL
const API_BASE = "https://rocsphere.onrender.com/api/roc";

const fetchWithTimeout = (url, options = {}, ms = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

const TODAY = new Date();
const CUR_YEAR = TODAY.getFullYear();

// ── AY helpers ────────────────────────────────────────────────────────────────
// AY concept: AY "Y-(Y+1)" covers filings for FY Apr(Y-1) – Mar(Y)
// e.g. AY 2024-25 → FY 2023-24 → Apr 1 2023 to Mar 31 2024
const AY_OPTIONS = Array.from({length:6},(_,i)=>{
  const y = CUR_YEAR - 1 + i; // AY label year
  return {
    value: `${y}-${String(y+1).slice(2)}`,
    label: `AY ${y}-${String(y+1).slice(2)} (FY ${y-1}-${String(y).slice(2)})`,
    fyStart: new Date(y-1,3,1),   // Apr 1 of (y-1)
    fyEnd:   new Date(y,2,31,23,59,59), // Mar 31 of y
  };
});
const DEFAULT_AY = AY_OPTIONS[1].value; // current AY

// ── AGM Cluster ───────────────────────────────────────────────────────────────
const AGM_CLUSTER_IDS = ["aoc4","adt1","mgt14","mgt7","mgt7a"];

const COMPLIANCE_RULES = [
  { id:"mgt7a", form:"MGT-7A",         title:"Abridged Annual Return",                  cat:"Annual Filing",       section:"Sec 92, Rule 11A",  freq:"Annual",      agmLinked:true,  applies:(c)=>c.isSmallCompany==="Yes"||c.companyType==="OPC",                                    tags:["Small Co/OPC"]        },
  { id:"mgt7",  form:"MGT-7",          title:"Annual Return",                            cat:"Annual Filing",       section:"Sec 92",            freq:"Annual",      agmLinked:true,  applies:(c)=>c.companyType!=="LLP"&&c.isSmallCompany!=="Yes",                                    tags:["Non-Small Co"]        },
  { id:"aoc4",  form:"AOC-4",          title:"Financial Statements Filing",              cat:"Annual Filing",       section:"Sec 137",           freq:"Annual",      agmLinked:true,  applies:(c)=>c.companyType!=="LLP",                                                              tags:["All Cos"]             },
  { id:"adt1",  form:"ADT-1",          title:"Appointment of Auditor",                   cat:"Annual Filing",       section:"Sec 139",           freq:"Annual/5yr",  agmLinked:true,  applies:(c)=>c.companyType!=="LLP",                                                              tags:["All Cos"]             },
  { id:"mgt14", form:"MGT-14",         title:"Filing of Board / AGM Resolutions",        cat:"Annual Filing",       section:"Sec 117",           freq:"Event",       agmLinked:true,  applies:(c)=>c.companyType!=="LLP",                                                              tags:["All Cos (Board Res)"] },
  { id:"dpt3",  form:"DPT-3",          title:"Return of Deposits",                       cat:"Statutory Return",    section:"Sec 73/Rule 16",    freq:"Annual",      agmLinked:false, applies:(c)=>c.companyType!=="LLP",                                                              tags:["Non-LLP"]             },
  { id:"msme1", form:"MSME-1",         title:"Outstanding Dues to MSME",                 cat:"Statutory Return",    section:"Sec 405",           freq:"Half-yearly", agmLinked:false, applies:()=>true,                                                                                tags:["All Cos"]             },
  { id:"dir3k", form:"DIR-3 KYC",      title:"Director KYC (Annual)",                    cat:"Director",            section:"Rule 12A",          freq:"Annual",      agmLinked:false, applies:()=>true,                                                                                tags:["All Cos"]             },
  { id:"csr2",  form:"CSR-2",          title:"CSR Contribution Report",                  cat:"CSR",                 section:"Sec 135",           freq:"Annual",      agmLinked:false, applies:(c)=>+c.networth>=500||+c.turnover>=1000||+c.netProfit>=5,                               tags:["NW>=500/TO>=1000 Cr"] },
  { id:"nfra2", form:"NFRA-2",         title:"Auditor Annual Return (NFRA)",              cat:"Statutory Return",    section:"NFRA Rules 2018",   freq:"Annual",      agmLinked:false, applies:(c)=>c.listedStatus==="Listed",                                                          tags:["Listed"]              },
  { id:"fc3",   form:"FC-3",           title:"Annual Accounts — Foreign Company",         cat:"Annual Filing",       section:"Companies Act",      freq:"Annual",      agmLinked:false, applies:(c)=>c.companyType==="Foreign",                                                          tags:["Foreign Co"]          },
  { id:"dir12", form:"DIR-12",         title:"Change in Directors / KMP",                cat:"Director",            section:"Sec 170",           freq:"Event",       agmLinked:false, applies:()=>true,                                                                                tags:["All Cos"]             },
  { id:"pas3",  form:"PAS-3",          title:"Return of Allotment of Shares",            cat:"Share Capital",       section:"Sec 39/42",         freq:"Event",       agmLinked:false, applies:()=>true,                                                                                tags:["All Cos"]             },
  { id:"sh7",   form:"SH-7",           title:"Increase in Authorised Capital",            cat:"Share Capital",       section:"Sec 64",            freq:"Event",       agmLinked:false, applies:()=>true,                                                                                tags:["All Cos"]             },
  { id:"ben2",  form:"BEN-2",          title:"Significant Beneficial Ownership",          cat:"Statutory Return",    section:"Sec 90",            freq:"Event",       agmLinked:false, applies:(c)=>c.companyType!=="LLP",                                                              tags:["Non-LLP"]             },
  { id:"inc22", form:"INC-22",         title:"Change in Registered Office",               cat:"Registered Office",   section:"Sec 12",            freq:"Event",       agmLinked:false, applies:()=>true,                                                                                tags:["All Cos"]             },
  { id:"inc20a",form:"INC-20A",        title:"Commencement of Business (One-time)",       cat:"Statutory Return",    section:"Sec 10A",           freq:"One-time",    agmLinked:false, applies:(c)=>c.companyType!=="LLP",                                                              tags:["All Cos"]             },
  { id:"inc22a",form:"INC-22A",        title:"ACTIVE Company Tagging (One-time)",         cat:"Registered Office",   section:"Rule 25A",          freq:"One-time",    agmLinked:false, applies:()=>true,                                                                                tags:["All Cos"]             },
  { id:"cra2",  form:"CRA-2",          title:"Appointment of Cost Auditor",               cat:"Cost Audit",          section:"CRA Rules",         freq:"Annual",      agmLinked:false, applies:(c)=>c.hasCostAudit,                                                                     tags:["Cost Audit Cos"]      },
  { id:"cra3",  form:"CRA-3",          title:"Cost Audit Report (to Company)",            cat:"Cost Audit",          section:"CRA Rules",         freq:"Annual",      agmLinked:false, applies:(c)=>c.hasCostAudit,                                                                     tags:["Cost Audit Cos"]      },
  { id:"cra4",  form:"CRA-4",          title:"Cost Audit Report (to ROC)",               cat:"Cost Audit",          section:"CRA Rules",         freq:"Annual",      agmLinked:false, applies:(c)=>c.hasCostAudit,                                                                     tags:["Cost Audit Cos"]      },
  { id:"xbrl",  form:"AOC-4 XBRL",    title:"XBRL Financial Statements",                cat:"Annual Filing",       section:"MCA XBRL Rules",    freq:"Annual",      agmLinked:false, applies:(c)=>c.listedStatus==="Listed"||+c.turnover>=500||+c.paidUpCapital>=500,                 tags:["Listed/Large"]        },
  { id:"csr",   form:"CSR-1/CSR-2",   title:"CSR Registration & Reporting",              cat:"CSR",                 section:"Sec 135",           freq:"Annual",      agmLinked:false, applies:(c)=>+c.networth>=500||+c.turnover>=1000||+c.netProfit>=5,                               tags:["NW>=500/TO>=1000 Cr"] },
  { id:"iepf",  form:"IEPF-1/IEPF-2", title:"IEPF — Unpaid Dividend/Shares",            cat:"Investor Protection", section:"Sec 125",           freq:"Event",       agmLinked:false, applies:(c)=>c.companyType==="Public"||c.listedStatus==="Listed",                                tags:["Public/Listed"]       },
  { id:"chg1",  form:"CHG-1/CHG-4",   title:"Registration / Satisfaction of Charge",    cat:"Charges",             section:"Sec 77/82",         freq:"Event",       agmLinked:false, applies:(c)=>c.hasCharges,                                                                       tags:["Cos with Charges"]    },
  { id:"llp8",  form:"Form 8 (LLP)",  title:"Statement of Account & Solvency",          cat:"Annual Filing",       section:"LLP Act 2008",      freq:"Annual",      agmLinked:false, applies:(c)=>c.companyType==="LLP",                                                              tags:["LLP Only"]            },
  { id:"llp11", form:"Form 11 (LLP)", title:"Annual Return (LLP)",                       cat:"Annual Filing",       section:"LLP Act 2008",      freq:"Annual",      agmLinked:false, applies:(c)=>c.companyType==="LLP",                                                              tags:["LLP Only"]            },
];

const CAT_COL = {
  "Annual Filing":       { bg:"#1a5f8a12", bd:"#1a5f8a30", txt:"#1a5f8a" },
  "Statutory Return":    { bg:"#d9730012", bd:"#d9730030", txt:"#c06000" },
  "Director":            { bg:"#6d28d912", bd:"#6d28d930", txt:"#5b21b6" },
  "Share Capital":       { bg:"#b4530912", bd:"#d9730030", txt:"#92400e" },
  "Registered Office":   { bg:"#00796b12", bd:"#00796b30", txt:"#00695c" },
  "CSR":                 { bg:"#be185d12", bd:"#be185d30", txt:"#9d1555" },
  "Investor Protection": { bg:"#0d7a7012", bd:"#00b4a630", txt:"#0d6b62" },
  "Charges":             { bg:"#dc262612", bd:"#dc262630", txt:"#b91c1c" },
  "Cost Audit":          { bg:"#78350f12", bd:"#78350f30", txt:"#78350f" },
};

const parseIndDate = (s) => { if (!s) return null; const [d,m,y]=s.split("/").map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
const fmt = (d) => { if(!d) return "-"; return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
const daysLeft = (d) => d ? Math.ceil((d-TODAY)/86400000) : null;

const urgency = (n) => {
  if (n===null) return {col:"#94a3b8", bg:"#f1f5f9", label:"-"};
  if (n<0)      return {col:"#dc2626", bg:"#fef2f2", label:`${Math.abs(n)}d overdue`};
  if (n<=30)    return {col:"#d97706", bg:"#fffbeb", label:`${n}d left`};
  if (n<=90)    return {col:"#0d7a70", bg:"#f0fdfa", label:`${n}d left`};
  return         {col:"#1a5f8a", bg:"#eff6ff", label:`${n}d left`};
};

const calcDueDates = (rule, co, ayOption) => {
  const agm = parseIndDate(co.lastAGM);
  const slots = [];
  const y = ayOption ? ayOption.fyStart.getFullYear() : CUR_YEAR;

  switch(rule.id) {
    case "mgt7": case "mgt7a":
      if (agm) slots.push({label:`FY ${agm.getFullYear()-1}-${String(agm.getFullYear()).slice(2)}`, date: addDays(agm,60)});
      slots.push({label:`FY ${y}-${String(y+1).slice(2)} (est.)`, date: new Date(y,8,29)});
      slots.push({label:`FY ${y+1}-${String(y+2).slice(2)} (est.)`, date: new Date(y+1,8,29)});
      break;
    case "aoc4":
      if (agm) slots.push({label:`FY ${agm.getFullYear()-1}-${String(agm.getFullYear()).slice(2)}`, date: addDays(agm,30)});
      slots.push({label:`FY ${y}-${String(y+1).slice(2)} (est.)`, date: new Date(y,8,30)});
      slots.push({label:`FY ${y+1}-${String(y+2).slice(2)} (est.)`, date: new Date(y+1,8,30)});
      break;
    case "adt1":
      if (agm) slots.push({label:`FY ${agm.getFullYear()-1}-${String(agm.getFullYear()).slice(2)}`, date: addDays(agm,15)});
      slots.push({label:`FY ${y}-${String(y+1).slice(2)} (est.)`, date: new Date(y,8,15)});
      break;
    case "mgt14":
      if (agm) slots.push({label:`FY ${agm.getFullYear()-1}-${String(agm.getFullYear()).slice(2)}`, date: addDays(agm,30)});
      slots.push({label:`FY ${y}-${String(y+1).slice(2)} (est.)`, date: new Date(y,8,29)});
      break;
    case "dpt3":
      slots.push({label:`FY ${y-1}-${String(y).slice(2)}`, date: new Date(y,5,30)});
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y+1,5,30)});
      break;
    case "msme1":
      slots.push({label:`Apr-Sep ${y}`,       date: new Date(y,9,31)});
      slots.push({label:`Oct ${y}-Mar ${y+1}`,date: new Date(y+1,3,30)});
      slots.push({label:`Apr-Sep ${y+1}`,     date: new Date(y+1,9,31)});
      break;
    case "dir3k":
      slots.push({label:`FY ${y-1}-${String(y).slice(2)}`, date: new Date(y,8,30)});
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y+1,8,30)});
      break;
    case "csr2": case "csr":
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y,11,31)});
      slots.push({label:`FY ${y+1}-${String(y+2).slice(2)}`, date: new Date(y+1,11,31)});
      break;
    case "nfra2":
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y,10,30)});
      slots.push({label:`FY ${y+1}-${String(y+2).slice(2)}`, date: new Date(y+1,10,30)});
      break;
    case "fc3":
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y,8,30)});
      slots.push({label:`FY ${y+1}-${String(y+2).slice(2)}`, date: new Date(y+1,8,30)});
      break;
    case "cra2":
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y,8,27)});
      slots.push({label:`FY ${y+1}-${String(y+2).slice(2)}`, date: new Date(y+1,8,27)});
      break;
    case "cra3":
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y,8,27)});
      break;
    case "cra4":
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y,9,27)});
      break;
    case "llp8":
      slots.push({label:`FY ${y-1}-${String(y).slice(2)}`, date: new Date(y,8,30)});
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y+1,8,30)});
      break;
    case "llp11":
      slots.push({label:`FY ${y-1}-${String(y).slice(2)}`, date: new Date(y,4,30)});
      slots.push({label:`FY ${y}-${String(y+1).slice(2)}`, date: new Date(y+1,4,30)});
      break;
    case "dir12": case "pas3": case "sh7": case "ben2":
    case "inc22": case "inc20a": case "inc22a":
    case "iepf":  case "chg1":
      slots.push({label:"Event-based", date:null});
      break;
    default:
      slots.push({label:"Event-based", date:null});
  }

  const ayStart = ayOption?.fyStart;
  const ayEnd   = ayOption?.fyEnd;
  let relevant = slots;
  if (ayStart && ayEnd) {
    const inAY = slots.filter(s => s.date && s.date >= ayStart && s.date <= ayEnd);
    if (inAY.length > 0) relevant = inAY;
    else if (slots.every(s => !s.date)) relevant = slots;
    else relevant = slots;
  }

  const upcoming = relevant.filter(s=>s.date&&s.date>=TODAY).sort((a,b)=>a.date-b.date)[0]||null;
  const past     = relevant.filter(s=>s.date&&s.date<TODAY).sort((a,b)=>b.date-a.date)[0]||null;
  return { upcoming, past, all: relevant };
};

// ── PDF helpers ───────────────────────────────────────────────────────────────
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
  for (let i=1;i<=pdf.numPages;i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    txt += content.items.map(x=>x.str).join(" ")+"\n";
  }
  return txt;
};
const toC = (v) => v ? (v/10000000).toFixed(4) : "";

const checkPdfSigned = (txt) => {
  const hasDSC          = /Digitally signed|digital signature|DSC/i.test(txt);
  const hasSignerBlock  = /DIN\s*\d{8}|Director identification number/i.test(txt);
  const hasFilingDate   = /eForm filing date/i.test(txt);
  const hasOfficeSRN    = /eForm Service request number/i.test(txt);
  const isFiled         = hasFilingDate && hasOfficeSRN;
  const dscPattern      = /0\*\d\*\d\*\d\*|0\*8\*8\*7\*/.test(txt);
  const hasSRNInBody    = /\b1\d{12,13}\b/.test(txt);
  const hasSignSlot     = /To be digitally signed by/i.test(txt);
  const hasActualSig    = dscPattern || hasDSC;
  const isDraft         = hasSignSlot && !hasActualSig && !isFiled;
  const signerDIN       = txt.match(/DIN1?\s+(\d{8})/i)?.[1] || "";
  const signerName      = (txt.match(/\*Name\s+([A-Z][A-Z\s]+(?:DHANRAJANI|KUMAR|SHAH|PATEL|[A-Z]{4,}))/i)?.[1] || "").trim();
  const bodySRN         = txt.match(/\b(1\d{12,13})\b/)?.[1] || "";
  const isSignedCopy    = dscPattern || isFiled || hasSRNInBody;
  const signStatus      = isDraft ? "draft" : isSignedCopy ? "signed" : "unknown";
  return {
    hasDSC, hasSignerBlock, hasFilingDate, hasOfficeSRN,
    isFiled, dscPattern, isDraft, isSignedCopy, signStatus,
    signerDIN, signerName, bodySRN,
    signingIndicators: []
      .concat(dscPattern   ? ["✓ Director DIN masked (MCA received copy)"] : [])
      .concat(isFiled      ? ["✓ MCA eForm filing date & SRN present"] : [])
      .concat(hasDSC       ? ["✓ DSC signature block found"] : [])
      .concat(hasSRNInBody ? [`✓ SRN in document body: ${bodySRN}`] : [])
      .concat(isDraft      ? ["⚠ Sign slot present but NO signature — likely draft/unsigned"] : [])
      .concat(signerName   ? [`✓ Signed by: ${signerName}${signerDIN?" (DIN:"+signerDIN+")":""}`] : [])
  };
};

const detectFormType = (txt, fileName) => {
  const fn = (fileName || "").toLowerCase();
  if (/aoc.?2/i.test(fn)  || /Form No\.\s*AOC-2/i.test(txt))                         return "aoc2";
  if (/aoc.?4/i.test(fn)  || /Form No\.\s*AOC-4/i.test(txt))                         return "aoc4";
  if (/auditor|extract.*audit/i.test(fn) ||
      /Extract of Auditor.*Report|auditor.*report.*standalone/i.test(txt))             return "auditor_report";
  if (/board.*report/i.test(fn) || /extract.*board.*report/i.test(txt))               return "board_report";
  if (/mgt.?7a/i.test(fn) || /MGT-7A|Abridged Annual Return/i.test(txt))             return "mgt7a";
  if (/mgt.?7/i.test(fn)  || /MGT-7|Annual Return/i.test(txt))                       return "mgt7";
  if (/adt.?1/i.test(fn)  || /ADT-1|Appointment.*Auditor/i.test(txt))                return "adt1";
  if (/dir.?12/i.test(fn) || /DIR-12/i.test(txt))                                    return "dir12";
  if (/msme.?1/i.test(fn) || /MSME-1/i.test(txt))                                    return "msme1";
  return "unknown";
};

const parseAOC4 = (txt, fileName) => {
  const cin        = txt.match(/([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/)?.[1]||"";
  const nm1        = txt.match(/Name of the company\s+([A-Z][A-Z\s&,.()-]+(?:PRIVATE\s*LIMITED|LIMITED|LLP))/i)?.[1]||"";
  const srn        = txt.match(/eForm Service request number.*?([\d-]+)/i)?.[1]||txt.match(/SRN\s+([\dA-Z-]+)/)?.[1]||"";
  const filingDate = txt.match(/eForm filing date.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const agmDate    = txt.match(/date of AGM.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const fyFrom     = txt.match(/\*From.*?(\d{2}\/\d{2}\/\d{4})/)?.[1]||txt.match(/From\s+(\d{2}\/\d{2}\/\d{4})/)?.[1]||"";
  const fyTo       = txt.match(/\*To.*?(\d{2}\/\d{2}\/\d{4})/)?.[1]||txt.match(/To\s+(\d{2}\/\d{2}\/\d{4})/)?.[1]||"";
  const boardMtgFS = txt.match(/Date of Board of directors.*?financial statements are approved.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const boardMtgBR = txt.match(/Date of Board of directors.*?boards.*?report.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const auditorSign= txt.match(/Date of signing.*?auditors.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const adtSRN     = txt.match(/SRN of Form ADT-1\s+([\dA-Z-]+)/i)?.[1]||"";
  const authCapAbs = parseInt(txt.match(/Authorised capital.*?(\d+)/i)?.[1]||"0")||0;
  const nwAbs      = parseInt(txt.match(/Net Worth.*?(-?\d+)/i)?.[1]||"0")||0;
  const scAbs      = parseInt(txt.match(/Share capital\s+(\d+)/)?.[1]||"0")||0;
  const resvAbs    = parseInt(txt.match(/Reserves and surplus\s+(-?\d+)/)?.[1]||"0")||0;
  const ltbAbs     = parseInt(txt.match(/Long term borrowings\s+(\d+)/i)?.[1]||"0")||0;
  const tpAbs      = parseInt(txt.match(/creditors other.*?enterprises\s+(\d+)/i)?.[1]||"0")||0;
  const cashAbs    = parseInt(txt.match(/Cash and cash equivalents\s+(\d+)/)?.[1]||"0")||0;
  const totalAbs   = parseInt(txt.match(/Total\s+([\d.]+)/)?.[1]||"0")||0;
  const revenueAbs = parseInt(txt.match(/Sale of goods manufactured\s+(\d+)/)?.[1]||"0")||0;
  const totalIncomeAbs = parseInt(txt.match(/Total Income.*?(\d+\.\d+)/)?.[1]||"0")||0;
  const totalExpAbs = parseInt(txt.match(/Total expenses\s+([\d.]+)/)?.[1]||"0")||0;
  const lossAbs    = parseInt(txt.match(/Profit before tax.*?(-?\d+\.\d+)/)?.[1]||txt.match(/Profit\/.*?tax.*?(-?\d+)/)?.[1]||"0")||0;
  const deprAbs    = parseInt(txt.match(/Depreciation and amortization expenses\s+(\d+)/)?.[1]||"0")||0;
  const epsBasic   = txt.match(/Basic\s+(-?[\d.]+)/)?.[1]||"";
  const auditorName= (txt.match(/Name of the auditor.*?firm\s+([A-Z][A-Z\s&.]+)/i)?.[1]||"").replace(/\s+/g," ").trim();
  const auditorFRN = txt.match(/registration number\s+(\d{6}[A-Z])/i)?.[1]||"";
  const auditorMem = txt.match(/Membership number\s+(\d+)/i)?.[1]||"";
  const auditorPAN = txt.match(/Income-tax PAN.*?([A-Z]{5}\d{4}[A-Z])/)?.[1]||"";
  const dirMatches = [...txt.matchAll(/(\d{8})\s+([A-Z][A-Z\s]+(?:DHANRAJANI|LIMITED|KUMAR|SHAH|PATEL|JAIN|MEHTA|GUPTA|SINGH|AGARWAL|CHOPRA|[A-Z]{4,}))\s+(Director|Manager|CEO|CFO|Secretary)/gi)];
  const directors = dirMatches.map(m=>({din:m[1], name:m[2].trim(), designation:m[3]}));
  const isSmallCo = /small company/i.test(txt) ? "Yes" : "No";
  const isOPC     = /one person company|OPC/i.test(txt) ? "Yes" : "No";
  const hasSubsidiary = /subsidiary.*Yes|Yes.*subsidiary/i.test(txt) ? "Yes" : "No";
  const caro      = /CARO.*No|No.*CARO/i.test(txt) ? "No" : "Yes";
  const signInfo  = checkPdfSigned(txt);
  return {
    type:"aoc4", fileName, cin, companyName:(nm1||"").replace(/\s+/g," ").trim(),
    srn, filingDate, lastAGM:agmDate, fyFrom, fyTo,
    boardMeetingFS: boardMtgFS, boardMeetingBR: boardMtgBR, auditorSignDate: auditorSign,
    adtSRN, authorisedCapitalAbsolute: authCapAbs,
    shareCapitalAbsolute: scAbs, reservesAbsolute: resvAbs, ltBorrowingsAbsolute: ltbAbs,
    tradePayablesAbsolute: tpAbs, cashAbsolute: cashAbs, totalAssetsAbsolute: totalAbs,
    netWorthAbsolute: nwAbs,
    revenueAbsolute: revenueAbs, totalIncomeAbsolute: totalIncomeAbs,
    totalExpensesAbsolute: totalExpAbs, netLossAbsolute: lossAbs, depreciationAbsolute: deprAbs,
    epsBasic,
    auditor: auditorName, auditorFRN, auditorMembership: auditorMem, auditorPAN,
    directors,
    isSmallCompany: isSmallCo, isOPC, hasSubsidiary, caroApplicable: caro,
    turnoverAbsolute: revenueAbs, netWorthAbsoluteVal: nwAbs,
    turnover: toC(revenueAbs), networth: toC(nwAbs), paidUpCapital: toC(scAbs),
    authorisedCapital: toC(authCapAbs),
    signInfo,
    filingIntelligence: null,
  };
};

const parseAuditorReport = (txt, fileName) => {
  const cin         = txt.match(/([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/)?.[1] || "";
  const companyName = (
    txt.match(/Financial Statements of ([A-Z][A-Z\s&,.()-]+(?:PRIVATE\s*LIMITED|LIMITED))/i)?.[1] ||
    txt.match(/\*Name of the company\s+([A-Z][A-Z\s&,.()-]+(?:PRIVATE\s*LIMITED|LIMITED))/i)?.[1] ||
    ""
  ).replace(/\s+/g," ").trim();
  const srn          = txt.match(/eForm Service request number.*?([\d-]+)/i)?.[1] || txt.match(/SRN\s+([\dA-Z-]+)/)?.[1] || "";
  const filingDate   = txt.match(/eForm filing date.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1] || "";
  const opinion      = /unqualified|true and fair view/i.test(txt) ? "Unqualified (Clean)" :
                       /adverse/i.test(txt) ? "Adverse" :
                       /disclaimer/i.test(txt) ? "Disclaimer" :
                       /qualified/i.test(txt) ? "Qualified" : "Unknown";
  const qualCount    = parseInt(txt.match(/Number of qualifications.*?(\d+)/i)?.[1] || "0") || 0;
  const caroAppl     = /CARO.*No|CARO.*not applicable|not applicable.*CARO|small company.*not applicable/i.test(txt) ? "No" : "Yes";
  const emphasis     = /Emphasis of matter[^N]*NA|emphasis.*?\bNA\b/i.test(txt) ? "None" : "Present";
  const ifcExempt    = /exempted from.*Internal Financial controls|turnover.*less.*50 Crores/i.test(txt) ? "Exempted" : "Applicable";
  const signInfo     = checkPdfSigned(txt);
  const signerDIN    = txt.match(/DIN1?\s+(\d{8})/i)?.[1] || "";
  const signerName   = (txt.match(/\*Name\s+([A-Z][A-Z\s]+(?:DHANRAJANI|KUMAR|SHAH|PATEL|[A-Z]{4,}))/i)?.[1] || "").trim();
  const signerDes    = txt.match(/\*Designation.*?(Director|Manager|Secretary)/i)?.[1] || "";
  const hasBoardResp = /Companys Board of Directors is responsible/i.test(txt);
  const goingConcern = /going concern/i.test(txt) ? "Mentioned" : "Not mentioned";
  const fraudMention = /fraud/i.test(txt) && !/no.*fraud/i.test(txt) ? "Mentioned" : "None";
  const sec197Note   = /section 197 is not applicable on private company/i.test(txt) ? "N/A (Private Co)" : "";
  const iepfNote     = /no delay in transferring.*Investor Education/i.test(txt) ? "No delays" : "";
  return {
    type: "auditor_report", fileName, cin, companyName, srn, filingDate,
    auditOpinion: opinion, qualificationsCount: qualCount,
    caroApplicable: caroAppl, emphasisOfMatter: emphasis,
    ifcApplicability: ifcExempt,
    signerDIN, signerName, signerDesignation: signerDes,
    goingConcern, fraudMention, sec197Note, iepfNote,
    hasBoardResponsibility: hasBoardResp,
    signInfo,
  };
};

const parseBoardReport = (txt, fileName) => {
  const cin         = txt.match(/([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/)?.[1]||"";
  const companyName = (txt.match(/\*Name of the Company\s+([A-Z][A-Z\s&,.()-]+(?:PRIVATE\s*LIMITED|LIMITED))/i)?.[1]||"").trim();
  const srn         = txt.match(/eForm Service request number.*?([\d-]+)/i)?.[1]||txt.match(/SRN\s+([\dA-Z-]+)/)?.[1]||"";
  const isSmallCo   = /OPC or Small Company.*Yes|Yes.*Small/i.test(txt) ? "Yes" : "No";
  const boardMtgs   = parseInt(txt.match(/Number of meetings held\s+(\d+)/i)?.[1]||"0")||0;
  const csrAppl     = /CSR.*not applicable|Not applicable.*CSR/i.test(txt) ? "No" : "Yes";
  const fraud       = /no fraud reported|no.*fraud/i.test(txt) ? "None" : "Reported";
  const lossAmt     = parseInt(txt.match(/incurred a loss of Rs\.\s*([\d,]+)/i)?.[1]?.replace(/,/g,"")||"0")||0;
  const secretAudit = /Secretarial Audit.*No|No.*Secretarial/i.test(txt) ? "No" : "Yes";
  const signInfo    = checkPdfSigned(txt);
  const signerDIN   = txt.match(/DIN1?\s+(\d{8})/i)?.[1]||"";
  return {
    type:"board_report", fileName, cin, companyName, srn,
    isSmallCompany: isSmallCo, boardMeetingsHeld: boardMtgs,
    csrApplicable: csrAppl, fraudReported: fraud,
    lossForYear: lossAmt, secretarialAuditApplicable: secretAudit,
    signerDIN, signInfo,
  };
};

const parseAOC2 = (txt, fileName) => {
  const cin          = txt.match(/([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/)?.[1] || "";
  const companyName  = (txt.match(/\*Name of the Company\s+([A-Z][A-Z\s&,.()-]+(?:PRIVATE\s*LIMITED|LIMITED))/i)?.[1] || "").replace(/\s+/g," ").trim();
  const srn          = txt.match(/eForm Service request number.*?([\d-]+)/i)?.[1] || txt.match(/SRN\s+([\dA-Z-]+)/)?.[1] || "";
  const filingDate   = txt.match(/eForm filing date.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1] || "";
  const nonArmCount  = parseInt(txt.match(/Number of contracts.*?not at arm.*?(\d+)/i)?.[1] || "0") || 0;
  const armCount     = parseInt(txt.match(/Number of material contracts.*?arm.*?length.*?(\d+)/i)?.[1] || "0") || 0;
  const rptBlocks   = [];
  const blockMatches = [...txt.matchAll(/Name.*?of the related party\s+([A-Za-z\s]+?)(?:\n|Nature of relationship)/gi)];
  blockMatches.forEach(m => {
    const name   = m[1].trim();
    const section  = txt.slice(txt.indexOf(m[0]), txt.indexOf(m[0]) + 500);
    const relNature= section.match(/Nature of relationship\s+(\w[^\n]+)/i)?.[1]?.trim() || "";
    const txnNature= section.match(/Nature of contracts.*?transactions\s+([A-Za-z\s&,]+)/i)?.[1]?.trim() || "";
    const amount   = parseInt(section.match(/Salient terms.*?contractual amount\s+(\d+)/i)?.[1] || "0") || 0;
    const boardDate= section.match(/Date of approval.*?Board.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1] || "";
    const pan      = section.match(/([A-Z]{5}\d{4}[A-Z])/)?.[1] || "";
    const advances = parseInt(section.match(/Amount paid as advances.*?(\d+)/i)?.[1] || "0") || 0;
    rptBlocks.push({ name, relNature, txnNature, amount, boardDate, pan, advances });
  });
  const rptName   = rptBlocks[0]?.name   || (txt.match(/Name.*?of the related party\s+([A-Za-z\s]+)/i)?.[1]||"").trim();
  const rptNature = rptBlocks[0]?.txnNature || (txt.match(/Nature of contracts.*?transactions\s+([A-Za-z\s]+)/i)?.[1]||"").trim();
  const rptAmount = rptBlocks[0]?.amount  || parseInt(txt.match(/Salient terms.*?contractual amount\s+(\d+)/i)?.[1]||"0")||0;
  const rptRelNat = rptBlocks[0]?.relNature || "";
  const rptBoardApproval = rptBlocks[0]?.boardDate || "";
  const signInfo  = checkPdfSigned(txt);
  const signerDIN = txt.match(/DIN1?\s+(\d{8})/i)?.[1] || "";
  return {
    type: "aoc2", fileName, cin, companyName, srn, filingDate,
    nonArmLengthCount: nonArmCount, armLengthCount: armCount,
    rptBlocks,
    relatedPartyName: rptName, relatedPartyNature: rptNature,
    relatedPartyRelationship: rptRelNat,
    relatedPartyAmount: rptAmount, relatedPartyBoardApproval: rptBoardApproval,
    signerDIN, signInfo,
  };
};

const parseMGT7 = (txt, fileName) => {
  const cin          = txt.match(/([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/)?.[1]||"";
  const nm1          = txt.match(/Name of the company\s+([A-Z][A-Z\s&,.()-]+(?:PRIVATE\s*LIMITED|LIMITED|LLP))/i)?.[1]||"";
  const srn          = txt.match(/eForm Service request number.*?([\dA-Z-]+)/i)?.[1]||txt.match(/SRN\s+([\dA-Z-]+)/)?.[1]||"";
  const filingDate   = txt.match(/eForm filing date.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const agmDate      = txt.match(/date of AGM.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const fyFrom       = txt.match(/Financial year.*?(\d{2}\/\d{2}\/\d{4})/i)?.[1]||"";
  const isSmallCompany = /Small Company/i.test(txt)?"Yes":"No";
  const companyType  = txt.includes("Private")?"Private":txt.includes("Public")?"Public":"Private";
  const toAbs        = parseInt(txt.match(/\*Turnover\s+(-?\d+)/)?.[1]||"0")||0;
  const nwAbs        = parseInt(txt.match(/Net worth.*?(-?\d+)/i)?.[1]||"0")||0;
  const dirMatches   = [...txt.matchAll(/(\d{8})\s+([A-Z][A-Z\s]+?)\s+(?:Director|Manager)/g)];
  const directors    = dirMatches.map(m=>({"DIN/PAN":m[1],"Name":m[2].replace(/\s+/g," ").trim(),"Designation":"Director","Date of Appointment":"-","Cessation Date":"-"}));
  const signInfo     = checkPdfSigned(txt);
  return { type:"mgt7", fileName, cin, companyName:(nm1||"").replace(/\s+/g," "), srn, filingDate, lastAGM:agmDate, fyFrom,
    isSmallCompany, companyType, directors, turnoverAbsolute:toAbs, netWorthAbsolute:nwAbs,
    turnover:toC(toAbs), networth:toC(nwAbs), signInfo };
};

const parseAnyPDF = (txt, fileName) => {
  const formType = detectFormType(txt, fileName);
  switch(formType) {
    case "aoc4":          return parseAOC4(txt, fileName);
    case "auditor_report":return parseAuditorReport(txt, fileName);
    case "board_report":  return parseBoardReport(txt, fileName);
    case "aoc2":          return parseAOC2(txt, fileName);
    case "mgt7":
    case "mgt7a":         return parseMGT7(txt, fileName);
    default:              return { type:"unknown", fileName, formType, srn:"", companyName:"", signInfo: checkPdfSigned(txt) };
  }
};

// ── Filing Intelligence Engine ────────────────────────────────────────────────
const computeFilingIntelligence = (aoc4Data, company, audRptData, aoc2Data) => {
  const alerts = [];
  const autoUpdates = {};
  const advice = [];
  const masterDiffs = [];

  if (!aoc4Data || aoc4Data.type !== "aoc4") return { alerts, autoUpdates, advice, masterDiffs };

  const { fyFrom, fyTo, lastAGM, srn, filingDate, adtSRN, isSmallCompany,
    boardMeetingFS, boardMeetingBR, auditorSignDate,
    revenueAbsolute, lossForYear, netWorthAbsolute, directors,
    auditor, auditorFRN, companyName, cin,
    authorisedCapitalAbsolute, shareCapitalAbsolute } = aoc4Data;

  if (srn && filingDate) {
    autoUpdates["aoc4"] = { status:"filed", srn, filedDate:filingDate, notes:`Auto-imported from PDF. FY: ${fyFrom} to ${fyTo}` };
    alerts.push({ level:"success", msg:`✓ AOC-4 filed on ${filingDate} (SRN: ${srn})` });
  } else {
    alerts.push({ level:"warning", msg:`⚠ AOC-4 PDF uploaded but no MCA SRN/filing date found — may be a draft or unsigned copy` });
  }

  if (adtSRN) {
    autoUpdates["adt1"] = { status:"filed", srn:adtSRN, filedDate:"", notes:`Referenced in AOC-4. Auditor: ${auditor} (FRN: ${auditorFRN})` };
    alerts.push({ level:"success", msg:`✓ ADT-1 SRN found in AOC-4: ${adtSRN} — Auditor: ${auditor}` });
  }

  if (audRptData) {
    if (audRptData.auditOpinion === "Unqualified (Clean)") {
      alerts.push({ level:"success", msg:`✓ Auditor's Report: Clean/Unqualified opinion for FY ${fyFrom?.slice(6)}–${fyTo?.slice(3,5)}` });
    }
    if (audRptData.caroApplicable === "No") {
      alerts.push({ level:"info", msg:`ℹ CARO not applicable (small company exemption). AOC-4 CARO field: ${aoc4Data.caroApplicable}` });
    }
    if (audRptData.ifcApplicability === "Exempted") {
      alerts.push({ level:"info", msg:`ℹ IFC audit exempted — turnover below ₹50 Cr threshold` });
    }
    if (audRptData.signerName) {
      alerts.push({ level:"success", msg:`✓ Auditor's Report signed by: ${audRptData.signerName}` });
    }
  }

  if (aoc2Data) {
    if (aoc2Data.armLengthCount > 0 || aoc2Data.nonArmLengthCount > 0) {
      autoUpdates["mgt14"] = { status:"pending", srn:"", filedDate:"", notes:`AOC-2 has RPT. Check MGT-14 for board resolution filing (if applicable).` };
      const party = aoc2Data.relatedPartyName || "party";
      const amt   = aoc2Data.relatedPartyAmount > 0 ? ` ₹${aoc2Data.relatedPartyAmount.toLocaleString("en-IN")}` : "";
      alerts.push({ level:"info", msg:`ℹ AOC-2 includes ${aoc2Data.armLengthCount} arm's length RPT with ${party} —${amt}. Board approved: ${aoc2Data.relatedPartyBoardApproval || "—"}` });
    }
  }

  if (lastAGM) {
    const agm      = parseIndDate(lastAGM);
    if (agm) {
      const mgt7Due  = addDays(agm, 60);
      const mgt7Id   = isSmallCompany === "Yes" ? "mgt7a" : "mgt7";
      const mgt7Lbl  = isSmallCompany === "Yes" ? "MGT-7A (Small Co)" : "MGT-7";
      const today    = new Date();
      if (mgt7Due < today) {
        const dOver = Math.floor((today - mgt7Due) / 86400000);
        alerts.push({ level:"warning", msg:`⚠ ${mgt7Lbl} due was ${fmt(mgt7Due)} — ${dOver} days overdue. File immediately.` });
        advice.push({ priority:"HIGH", form:mgt7Lbl, ruleId:mgt7Id, due:fmt(mgt7Due), note:`Overdue by ${dOver} days — late fees applicable` });
      } else {
        const dl = Math.floor((mgt7Due - today) / 86400000);
        alerts.push({ level:"info", msg:`ℹ ${mgt7Lbl} due on ${fmt(mgt7Due)} (${dl} days remaining)` });
        advice.push({ priority: dl<=30?"HIGH":"MEDIUM", form:mgt7Lbl, ruleId:mgt7Id, due:fmt(mgt7Due), note:`${dl} days left` });
      }

      if (boardMeetingBR) {
        const bm = parseIndDate(boardMeetingBR);
        if (bm) {
          const mgt14Due = addDays(bm, 30);
          if (mgt14Due < today) {
            alerts.push({ level:"warning", msg:`⚠ MGT-14 for Board Report resolution (Board Mtg: ${boardMeetingBR}) — due was ${fmt(mgt14Due)}` });
            advice.push({ priority:"MEDIUM", form:"MGT-14", ruleId:"mgt14", due:fmt(mgt14Due), note:"Public Co only — if applicable, file now with late fee" });
          } else {
            advice.push({ priority:"LOW", form:"MGT-14", ruleId:"mgt14", due:fmt(mgt14Due), note:"Board resolution filing (public companies)" });
          }
        }
      }
    }
  }

  if (directors && directors.length > 0) {
    alerts.push({ level:"info", msg:`ℹ DIR-3 KYC required for ${directors.length} director(s): ${directors.map(d=>d.name||d.din).join(", ")}` });
    advice.push({ priority:"MEDIUM", form:"DIR-3 KYC", ruleId:"dir3k", due:"30 Sep annually", note:`${directors.length} director(s) must complete KYC by 30 Sep` });
  }

  advice.push({ priority:"LOW", form:"MSME-1", ruleId:"msme1", due:"31 Oct & 30 Apr", note:"File if outstanding dues to MSME vendors >45 days" });
  advice.push({ priority:"LOW", form:"DPT-3",  ruleId:"dpt3",  due:"30 Jun annually", note:"Return of deposits/loans even if NIL" });

  if (netWorthAbsolute < 0) {
    alerts.push({ level:"critical", msg:`🔴 NEGATIVE NET WORTH: ₹${Math.abs(netWorthAbsolute).toLocaleString("en-IN")} — monitor going concern; possible IBC applicability` });
  }

  if (company) {
    const checks = [
      { field:"Company Name",   pdf:companyName,           master:company.companyName },
      { field:"Small Company",  pdf:isSmallCompany,        master:company.isSmallCompany },
      { field:"Last AGM",       pdf:lastAGM,               master:company.lastAGM },
    ];
    checks.forEach(({ field, pdf, master }) => {
      if (pdf && master && pdf.toString().trim().toUpperCase() !== master.toString().trim().toUpperCase()) {
        masterDiffs.push({ field, pdfVal:pdf, masterVal:master });
        alerts.push({ level:"warning", msg:`⚠ Master data mismatch — ${field}: PDF says "${pdf}", Master says "${master}"` });
      } else if (pdf && master) {
        alerts.push({ level:"success", msg:`✓ ${field} consistent: "${pdf}"` });
      }
    });
  }

  return { alerts, autoUpdates, advice, masterDiffs };
};

const crossVerifyDocuments = (parsedDocs) => {
  const issues = [];
  const aoc4   = parsedDocs.find(d => d.type === "aoc4");
  const audRpt = parsedDocs.find(d => d.type === "auditor_report");
  const brdRpt = parsedDocs.find(d => d.type === "board_report");
  const aoc2   = parsedDocs.find(d => d.type === "aoc2");

  const names = parsedDocs.map(d => d.companyName).filter(Boolean);
  const uniqueNames = [...new Set(names.map(n => n.replace(/\s+/g," ").trim().toUpperCase()))];
  if (uniqueNames.length > 1) {
    issues.push({ level:"error", msg:`Company name mismatch across documents: ${uniqueNames.join(" | ")}` });
  } else if (uniqueNames.length === 1 && parsedDocs.length > 1) {
    issues.push({ level:"success", msg:`✓ Company name consistent across all ${parsedDocs.length} document(s): ${uniqueNames[0]}` });
  }

  parsedDocs.forEach(d => {
    const label  = {aoc4:"AOC-4", auditor_report:"Auditor's Report", board_report:"Board's Report", aoc2:"AOC-2", mgt7:"MGT-7", mgt7a:"MGT-7A"}[d.type] || d.type;
    const si     = d.signInfo;
    if (!si) return;
    if (si.signStatus === "draft") {
      issues.push({ level:"warning", msg:`⚠ ${label} (${d.fileName}) — Sign slot present but NO signature detected. Likely a DRAFT/unsigned copy.` });
    } else if (si.isSignedCopy) {
      const extra = si.signerName ? ` — Signed by: ${si.signerName}` : "";
      issues.push({ level:"success", msg:`✓ ${label} is a signed MCA copy${extra}` });
    } else {
      issues.push({ level:"warning", msg:`⚠ ${label} (${d.fileName}) — Could not confirm MCA filing stamp.` });
    }
  });

  if (aoc4 && audRpt) {
    if (audRpt.auditOpinion === "Unqualified (Clean)") {
      issues.push({ level:"success", msg:`✓ Audit opinion: Unqualified (Clean) — consistent with AOC-4 filing` });
    } else {
      issues.push({ level:"critical", msg:`🔴 Audit opinion is NOT clean (${audRpt.auditOpinion}) — requires special attention before filing AOC-4` });
    }
    if (audRpt.caroApplicable === "No") {
      issues.push({ level:"info", msg:`ℹ CARO not applicable (small company) — consistent with AOC-4 small company flag: ${aoc4.isSmallCompany}` });
    }
    if (audRpt.qualificationsCount > 0) {
      issues.push({ level:"warning", msg:`⚠ ${audRpt.qualificationsCount} audit qualification(s) found in Auditor's Report` });
    } else {
      issues.push({ level:"success", msg:`✓ No audit qualifications (${audRpt.qualificationsCount}) — clean report` });
    }
    if (audRpt.signerDIN && aoc4.auditorSignDate) {
      issues.push({ level:"success", msg:`✓ Auditor sign date in AOC-4: ${aoc4.auditorSignDate}; Auditor Report signer DIN: ${audRpt.signerDIN}` });
    }
    if (audRpt.ifcApplicability === "Exempted") {
      issues.push({ level:"info", msg:`ℹ IFC audit exempted — turnover < ₹50 Cr and borrowings < ₹25 Cr` });
    }
    if (audRpt.emphasisOfMatter === "Present") {
      issues.push({ level:"warning", msg:`⚠ Emphasis of matter present in Auditor's Report` });
    }
    if (audRpt.fraudMention === "Mentioned") {
      issues.push({ level:"critical", msg:`🔴 Fraud mentioned in Auditor's Report — mandatory reporting obligations under Sec 143(12)` });
    }
  }

  if (aoc4 && brdRpt) {
    if (brdRpt.fraudReported !== "None") {
      issues.push({ level:"critical", msg:`🔴 Fraud reported in Board's Report — immediate follow-up required` });
    }
    if (brdRpt.isSmallCompany === aoc4.isSmallCompany) {
      issues.push({ level:"success", msg:`✓ Small Company status consistent across AOC-4 & Board's Report: ${aoc4.isSmallCompany}` });
    } else {
      issues.push({ level:"warning", msg:`⚠ Small Company status mismatch: AOC-4 says "${aoc4.isSmallCompany}", Board Report says "${brdRpt.isSmallCompany}"` });
    }
  }

  if (aoc2) {
    if (aoc2.nonArmLengthCount > 0) {
      issues.push({ level:"warning", msg:`⚠ AOC-2: ${aoc2.nonArmLengthCount} non-arm's length RPT(s) — verify board/shareholder approval under Sec 188` });
    } else {
      issues.push({ level:"success", msg:`✓ AOC-2: No non-arm's length related party transactions` });
    }
    if (aoc2.armLengthCount > 0) {
      const party = aoc2.relatedPartyName || "Party";
      const amt   = aoc2.relatedPartyAmount > 0 ? ` — ₹${aoc2.relatedPartyAmount.toLocaleString("en-IN")}` : "";
      const rel   = aoc2.relatedPartyRelationship ? ` (${aoc2.relatedPartyRelationship})` : "";
      issues.push({ level:"info", msg:`ℹ AOC-2: ${aoc2.armLengthCount} arm's length material transaction(s). Party: ${party}${rel}${amt}` });
      if (aoc2.relatedPartyBoardApproval) {
        issues.push({ level:"success", msg:`✓ AOC-2 RPT board approval dated: ${aoc2.relatedPartyBoardApproval}` });
      }
    }
    if (aoc2.armLengthCount > 0 || aoc2.nonArmLengthCount > 0) {
      issues.push({ level:"info", msg:`ℹ AOC-2 filed as attachment to AOC-4. Ensure MGT-14 filed for board resolution approving RPT (if company is public/listed).` });
    }
  }

  return issues;
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
      const tC=(s)=>{const n=parseFloat(String(s||"").replace(/,/g,"")); return isNaN(n)?"":(n/10000000).toFixed(4);};
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
        networth:"", turnover:"", netProfit:"",
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

// ── Export compliance report ───────────────────────────────────────────────────
const exportReport = (company, applicable, ayLabel, calcDueFn) => {
  const today = new Date();
  const fmtD = (d) => { if(!d) return "-"; return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
  const statusLabel = (st) => st==="filed"?"FILED":st==="na"?"N/A":"PENDING";
  const statusColor = (st) => st==="filed"?"#16a34a":st==="na"?"#64748b":"#d97706";

  const rows = applicable.map(rule => {
    const st  = company.filingStatus?.[rule.id]||{status:"pending"};
    const {upcoming:u} = calcDueFn(rule, company);
    const n = u ? Math.ceil((u.date - today)/86400000) : null;
    const dl = u ? fmtD(u.date) : "Event-based";
    const overdue = n !== null && n < 0;
    return { rule, st, dl, n, overdue };
  });

  const filed   = rows.filter(r=>r.st.status==="filed").length;
  const overdue = rows.filter(r=>r.overdue && r.st.status!=="filed").length;
  const pending = rows.filter(r=>r.st.status==="pending"&&!r.overdue).length;

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Compliance Report — ${company.companyName}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Inter',sans-serif;background:#fff;color:#0d2d4a;font-size:11px;padding:0}
.page{max-width:900px;margin:0 auto;padding:40px 36px}.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:18px;border-bottom:2px solid #e2e8f0}
.logo{font-size:20px;font-weight:800;letter-spacing:-.5px}.logo span{color:#00b4a6}.title-block{text-align:right}
.report-title{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.company-name{font-size:17px;font-weight:800;color:#0d2d4a;line-height:1.2}.cin{font-size:10px;color:#94a3b8;font-family:monospace;margin-top:3px}
.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}.meta-box{border:1px solid #e2e8f0;border-radius:8px;padding:10px 13px}
.meta-label{font-size:8px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}.meta-val{font-size:12px;font-weight:700;color:#0d2d4a}
.stat-row{display:flex;gap:8px;margin-bottom:20px}.stat{flex:1;border-radius:8px;padding:11px 14px;text-align:center}
.stat-num{font-size:24px;font-weight:800;font-family:monospace;line-height:1}.stat-lbl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-top:3px}
.section-title{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.7px;margin:18px 0 10px}
table{width:100%;border-collapse:collapse;font-size:10px}thead tr{background:#f8fafc;border-bottom:2px solid #e2e8f0}
th{padding:8px 10px;text-align:left;font-size:8px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
td{padding:8px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle}tr:last-child td{border-bottom:none}
.form-id{font-family:monospace;font-weight:700;color:#1a5f8a}.badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:8px;font-weight:700}
.overdue-row td{background:#fef2f2}.footer{margin-top:28px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:8px;color:#94a3b8}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head>
<body><div class="page">
  <div class="header">
    <div class="logo">roc<span>Sphere</span><br/><span style="font-size:9px;font-weight:400;color:#94a3b8">Compliance Management Platform</span></div>
    <div class="title-block"><div class="report-title">Compliance Report — AY ${ayLabel}</div>
      <div class="company-name">${company.companyName}</div>
      <div class="cin">${company.cin} · ${company.companyType} · ${company.companyStatus||"Active"}</div></div></div>
  <div class="meta">
    <div class="meta-box"><div class="meta-label">Incorporation</div><div class="meta-val">${company.incorporationDate||"-"}</div></div>
    <div class="meta-box"><div class="meta-label">Last AGM</div><div class="meta-val">${company.lastAGM||"-"}</div></div>
    <div class="meta-box"><div class="meta-label">ROC Office</div><div class="meta-val" style="font-size:10px">${company.rocName||"-"}</div></div>
    <div class="meta-box"><div class="meta-label">Paid-up Capital</div><div class="meta-val">${company.paidUpCapital?`₹${(+company.paidUpCapital).toFixed(2)} Cr`:"-"}</div></div></div>
  <div class="stat-row">
    <div class="stat" style="background:#eff6ff;border:1px solid #bfdbfe"><div class="stat-num" style="color:#1a5f8a">${applicable.length}</div><div class="stat-lbl" style="color:#1a5f8a">Total Forms</div></div>
    <div class="stat" style="background:#f0fdf4;border:1px solid #bbf7d0"><div class="stat-num" style="color:#16a34a">${filed}</div><div class="stat-lbl" style="color:#16a34a">Filed</div></div>
    <div class="stat" style="background:#fffbeb;border:1px solid #fde68a"><div class="stat-num" style="color:#d97706">${pending}</div><div class="stat-lbl" style="color:#d97706">Pending</div></div>
    <div class="stat" style="background:#fef2f2;border:1px solid #fecaca"><div class="stat-num" style="color:#dc2626">${overdue}</div><div class="stat-lbl" style="color:#dc2626">Overdue</div></div></div>
  <div class="section-title">All Applicable Compliances</div>
  <table><thead><tr><th>#</th><th>Form</th><th>Description</th><th>Category</th><th>Due Date</th><th>Status</th><th>SRN</th><th>Filed Date</th><th>Notes</th></tr></thead>
  <tbody>${rows.map((r,i)=>{
    const st = r.st; const stCol = statusColor(st.status);
    const rowCls = r.overdue && st.status!=="filed" ? 'class="overdue-row"' : "";
    return `<tr ${rowCls}><td style="color:#94a3b8">${i+1}</td><td><span class="form-id">${r.rule.form}</span></td>
      <td style="color:#334155">${r.rule.title}</td><td><span style="font-size:8px;color:#64748b">${r.rule.cat}</span></td>
      <td style="font-family:monospace;color:#0d2d4a">${r.dl}</td>
      <td><span class="badge" style="background:${st.status==="filed"?"#f0fdf4":st.status==="na"?"#f1f5f9":"#fffbeb"};color:${stCol};border:1px solid ${stCol}30">${statusLabel(st.status)}</span></td>
      <td style="font-family:monospace;color:#0d7a70;font-size:9px">${st.srn||"-"}</td>
      <td style="color:#64748b">${st.filedDate||"-"}</td>
      <td style="color:#94a3b8;font-style:italic;font-size:9px">${st.notes||""}</td></tr>`;
  }).join("")}</tbody></table>
  <div class="footer"><span>Generated by rocSphere · ${fmtD(today)} · AY ${ayLabel}</span>
    <span>This report is for informational purposes only. Verify all dates with MCA portal.</span></div>
</div></body></html>`;

  const blob = new Blob([html], {type:"text/html"});
  const url  = URL.createObjectURL(blob);
  const win  = window.open(url,"_blank");
  if (win) win.onload = () => { win.print(); URL.revokeObjectURL(url); };
};

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@300;400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f0f4f8}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:#f1f5f9}
::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:#94a3b8}
input,select,textarea{outline:none;font-family:'Inter',sans-serif}
input::placeholder,textarea::placeholder{color:#94a3b8}
.mono{font-family:'IBM Plex Mono',monospace}
@keyframes up{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes sp{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.up{animation:up .2s ease forwards}
.spin{animation:sp .7s linear infinite;border:2.5px solid #e2e8f0;border-top-color:#1a5f8a;border-radius:50%;width:20px;height:20px;display:inline-block;flex-shrink:0}
.pls{animation:pulse 2s ease infinite}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;transition:all .15s;box-shadow:0 1px 3px rgba(13,45,74,.06)}
.card:hover{border-color:#00b4a650;box-shadow:0 4px 16px rgba(13,45,74,.10)}
.btn{display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:7px;border:1px solid #e2e8f0;background:#fff;color:#64748b;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;transition:.13s;white-space:nowrap}
.btn:hover{border-color:#00b4a6;color:#0d7a70;background:#f0fdfa}
.btn.pri{background:linear-gradient(135deg,#1a5f8a,#0d2d4a);border-color:transparent;color:#fff;box-shadow:0 2px 10px rgba(26,95,138,.25)}
.btn.pri:hover{box-shadow:0 4px 18px rgba(26,95,138,.40);transform:translateY(-1px)}
.btn.teal{background:linear-gradient(135deg,#00b4a6,#0d7a70);border-color:transparent;color:#fff;box-shadow:0 2px 10px rgba(0,180,166,.25)}
.btn.teal:hover{box-shadow:0 4px 18px rgba(0,180,166,.40);transform:translateY(-1px)}
.btn.red{border-color:#fecaca;color:#dc2626;background:#fff}.btn.red:hover{background:#fef2f2;border-color:#dc2626}
.inp{background:#fff;border:1px solid #e2e8f0;border-radius:7px;padding:7px 11px;color:#0d2d4a;font-size:11px;transition:.13s;width:100%}
.inp:focus{border-color:#00b4a6;box-shadow:0 0 0 3px rgba(0,180,166,.12)}
.bg{display:inline-flex;align-items:center;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700}
.tab{padding:10px 16px;border-bottom:2.5px solid transparent;font-size:11px;font-weight:600;cursor:pointer;color:#94a3b8;transition:.13s;white-space:nowrap;background:transparent;border-left:none;border-right:none;border-top:none;font-family:inherit}
.tab.on{color:#1a5f8a;border-bottom-color:#00b4a6}
.tab:hover:not(.on){color:#475569}
.row{transition:.12s}.row:hover{background:#f8fafc}
`;

// ── LogoImg ───────────────────────────────────────────────────────────────────
function LogoImg({height=40, style={}, onClick}) {
  const [err, setErr] = useState(false);
  if (err) return (
    <div onClick={onClick} style={{cursor:onClick?"pointer":"default",display:"flex",alignItems:"center",gap:8,...style}}>
      <div style={{width:height,height,borderRadius:10,background:"linear-gradient(135deg,#1a5f8a,#00b4a6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:height*0.5,flexShrink:0}}>⚖️</div>
      <div style={{fontWeight:800,fontSize:height*0.45,color:"#0d2d4a",letterSpacing:"-.5px",lineHeight:1}}>
        <span>roc</span><span style={{color:"#00b4a6"}}>Sphere</span>
      </div>
    </div>
  );
  return <img src="/logo.png" alt="rocSphere" onError={()=>setErr(true)} onClick={onClick} style={{height,objectFit:"contain",cursor:onClick?"pointer":"default",flexShrink:0,...style}}/>;
}

// ── EditForm — Enhanced with PDF upload ───────────────────────────────────────
function EditForm({init, rule, onSave, onCancel, onPdfUpload}) {
  const [status,    setStatus]    = useState(init.status||"pending");
  const [srn,       setSrn]       = useState(init.srn||"");
  const [fd,        setFd]        = useState(init.filedDate||"");
  const [notes,     setNotes]     = useState(init.notes||"");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const [dragOver,  setDragOver]  = useState(false);
  const pdfRef = useRef();

  const handlePdfFile = async (file) => {
    if (!file?.name.match(/\.pdf$/i)) { setUploadErr("Please upload a .pdf file"); return; }
    setUploading(true); setUploadMsg("Extracting data from PDF…"); setUploadErr("");
    try {
      const txt = await extractPdfText(file);
      const p   = parseAnyPDF(txt, file.name);
      if (p.srn)        setSrn(p.srn);
      if (p.filingDate) setFd(p.filingDate);
      if (p.srn || p.filingDate) setStatus("filed");
      const noteStr = [
        `PDF: ${file.name}`,
        p.fyFrom ? `FY: ${p.fyFrom} – ${p.fyTo}` : "",
        p.auditor ? `Auditor: ${p.auditor}` : "",
        p.companyName ? `Co: ${p.companyName}` : "",
      ].filter(Boolean).join(" | ");
      setNotes(noteStr);
      setUploadMsg(
        `✓ ${(p.type||"doc").toUpperCase()} extracted` +
        (p.srn ? ` · SRN: ${p.srn}` : "") +
        (p.filingDate ? ` · Filed: ${p.filingDate}` : "")
      );
      if (onPdfUpload) await onPdfUpload(file, p);
    } catch(e) {
      setUploadErr("Failed to read PDF: " + e.message);
      setUploadMsg("");
    }
    setUploading(false);
  };

  return (
    <div>
      {/* PDF upload strip */}
      <div
        onDrop={e=>{ e.preventDefault(); setDragOver(false); handlePdfFile(e.dataTransfer.files[0]); }}
        onDragOver={e=>{ e.preventDefault(); setDragOver(true); }}
        onDragLeave={()=>setDragOver(false)}
        onClick={()=>!uploading&&pdfRef.current?.click()}
        style={{
          background: dragOver?"#dbeafe":uploading?"#f0fdf4":uploadMsg?"#f0fdf4":"#eff6ff",
          border:`2px dashed ${dragOver?"#3b82f6":uploadMsg?"#86efac":"#93c5fd"}`,
          borderRadius:9, padding:"11px 13px", marginBottom:13,
          cursor:uploading?"default":"pointer", transition:".15s",
          minHeight:50, display:"flex", alignItems:"center",
        }}
      >
        <input ref={pdfRef} type="file" accept=".pdf" style={{display:"none"}} onChange={e=>handlePdfFile(e.target.files[0])}/>
        {uploading ? (
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10,color:"#1a5f8a"}}>
            <div className="spin" style={{width:14,height:14,flexShrink:0}}/> {uploadMsg}
          </div>
        ) : uploadMsg ? (
          <div style={{display:"flex",alignItems:"center",gap:8,width:"100%"}}>
            <span style={{fontSize:16}}>✅</span>
            <div style={{flex:1}}>
              <div style={{fontSize:10,fontWeight:700,color:"#16a34a"}}>{uploadMsg}</div>
              <div style={{fontSize:9,color:"#64748b",marginTop:1}}>Fields auto-filled · Click to replace PDF</div>
            </div>
          </div>
        ) : (
          <div style={{display:"flex",alignItems:"center",gap:10,width:"100%"}}>
            <div style={{width:32,height:32,borderRadius:7,background:"#dbeafe",border:"1px solid #93c5fd",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>📎</div>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:"#1a5f8a"}}>
                Attach filed PDF to auto-fill{rule ? ` — ${rule.form}` : ""}
              </div>
              <div style={{fontSize:9,color:"#64748b",marginTop:1}}>Drop PDF here or click · SRN &amp; date extracted automatically</div>
            </div>
          </div>
        )}
      </div>
      {uploadErr&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:6,padding:"7px 11px",fontSize:10,color:"#dc2626",marginBottom:10}}>⚠ {uploadErr}</div>}

      {/* Status */}
      <div style={{marginBottom:12}}>
        <label style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:5}}>Status</label>
        <div style={{display:"flex",gap:5}}>
          {[["pending","Pending"],["filed","Filed"],["na","N/A"]].map(([v,l])=>(
            <button key={v} onClick={()=>setStatus(v)} style={{flex:1,padding:"7px 0",borderRadius:6,border:`1.5px solid ${status===v?"#00b4a6":"#e2e8f0"}`,background:status===v?"#f0fdfa":"#fff",color:status===v?"#0d7a70":"#94a3b8",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:".13s"}}>{l}</button>
          ))}
        </div>
      </div>
      {status==="filed"&&<>
        <div style={{marginBottom:9}}>
          <label style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>SRN</label>
          <input className="inp" placeholder="e.g. AB1234567" value={srn} onChange={e=>setSrn(e.target.value)}/>
        </div>
        <div style={{marginBottom:9}}>
          <label style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>Date Filed (DD/MM/YYYY)</label>
          <input className="inp" placeholder="04/12/2025" value={fd} onChange={e=>setFd(e.target.value)}/>
        </div>
      </>}
      <div style={{marginBottom:13}}>
        <label style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>Notes</label>
        <textarea className="inp" rows={2} placeholder="Any notes…" value={notes} onChange={e=>setNotes(e.target.value)} style={{resize:"none"}}/>
      </div>
      <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn teal" onClick={()=>onSave({status,srn,filedDate:fd,notes})}>Save Changes</button>
      </div>
    </div>
  );
}

// ── DropZone ──────────────────────────────────────────────────────────────────
function DropZone({icon,label,sub,loading,loadingText,onClick}) {
  const [drag,setDrag]=useState(false);
  return (
    <div onDrop={e=>{e.preventDefault();setDrag(false);}} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onClick={onClick}
      style={{border:`2px dashed ${drag?"#00b4a6":"#cbd5e1"}`,borderRadius:10,padding:"32px 20px",textAlign:"center",cursor:"pointer",background:drag?"#f0fdfa":"#f8fafc",transition:".16s"}}>
      {loading
        ?<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}><div className="spin"/><div style={{fontSize:11,color:"#64748b"}}>{loadingText}</div></div>
        :<><div style={{fontSize:32,marginBottom:10}}>{icon}</div><div style={{fontWeight:700,fontSize:12,color:"#334155"}}>{label}</div><div style={{fontSize:10,color:"#94a3b8",marginTop:3}}>{sub}</div></>}
    </div>
  );
}

// ── BatchUploadTab ────────────────────────────────────────────────────────────
function BatchUploadTab({onMulti, loading}) {
  const inputRef = useRef();
  const [dragOver, setDragOver] = useState(false);
  const [queued, setQueued] = useState([]);

  const handleFiles = (files) => {
    const arr = [...files].filter(f => f.name.toLowerCase().endsWith(".pdf"));
    setQueued(arr);
  };

  return (
    <div>
      <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"10px 13px",marginBottom:12,fontSize:10,color:"#1a5f8a",lineHeight:1.7}}>
        <strong>📁 Batch Upload — AOC-4 Cluster</strong><br/>
        Upload <strong>AOC-4 + Auditor's Report + AOC-2 + Board's Report</strong> together. The system will:<br/>
        • Auto-detect each form type from filename &amp; content<br/>
        • Cross-verify signatures, company names &amp; audit opinion<br/>
        • Auto-update filing statuses and generate an Intelligence Report
      </div>
      <div
        onDrop={e=>{e.preventDefault();setDragOver(false);handleFiles(e.dataTransfer.files);}}
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onClick={()=>!loading&&inputRef.current?.click()}
        style={{border:`2px dashed ${dragOver?"#00b4a6":"#cbd5e1"}`,borderRadius:10,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:dragOver?"#f0fdfa":"#f8fafc",transition:".16s",marginBottom:10}}>
        {loading
          ?<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}><div className="spin"/><div style={{fontSize:11,color:"#64748b"}}>Analysing PDFs…</div></div>
          :<><div style={{fontSize:32,marginBottom:8}}>📁</div>
            <div style={{fontWeight:700,fontSize:12,color:"#334155"}}>Drop multiple PDFs here or click to browse</div>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:3}}>AOC-4, Auditor's Report, AOC-2, Board's Report — all at once</div>
          </>}
      </div>
      <input ref={inputRef} type="file" accept=".pdf" multiple style={{display:"none"}} onChange={e=>handleFiles(e.target.files)}/>
      {queued.length>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:6}}>{queued.length} file(s) queued</div>
          {queued.map((f,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 9px",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:6,marginBottom:4,fontSize:10,color:"#334155"}}>
              <span style={{fontSize:14}}>📋</span>
              <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
              <span style={{fontSize:9,color:"#94a3b8"}}>{(f.size/1024).toFixed(0)} KB</span>
            </div>
          ))}
          {!loading&&(
            <button className="btn pri" style={{width:"100%",marginTop:8,padding:"9px"}} onClick={()=>onMulti(queued)}>
              🚀 Analyse &amp; Upload All
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── UploadModal ───────────────────────────────────────────────────────────────
function UploadModal({mode,setMode,onMds,onPdf,onMulti,loading,err,onClose}) {
  const mdsRef=useRef(); const pdfRef=useRef();
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(13,45,74,.55)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(4px)"}} onClick={e=>e.target===e.currentTarget&&!loading&&onClose()}>
      <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:16,padding:"24px",width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(13,45,74,.18)"}} className="up">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#0d2d4a"}}>Upload Company Data</div>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>MDS Excel · Batch PDF (AOC-4 cluster) · Single PDF</div>
          </div>
          {!loading&&<button className="btn" onClick={onClose}>✕</button>}
        </div>
        <div style={{display:"flex",gap:4,marginBottom:18,background:"#f8fafc",borderRadius:9,padding:4,border:"1px solid #e2e8f0"}}>
          {[["mds","📊 MDS Excel"],["multi","📁 Batch PDFs"],["aoc4","📋 AOC-4"],["mgt7","📋 MGT-7/7A"]].map(([k,l])=>(
            <button key={k} onClick={()=>!loading&&setMode(k)} style={{flex:1,padding:"7px 0",borderRadius:6,border:"none",background:mode===k?"linear-gradient(135deg,#1a5f8a,#0d2d4a)":"transparent",color:mode===k?"#fff":"#94a3b8",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:".13s"}}>{l}</button>
          ))}
        </div>
        {mode==="mds"&&(
          <div>
            <p style={{fontSize:11,color:"#64748b",lineHeight:1.7,marginBottom:12}}>Upload the <strong style={{color:"#1a5f8a"}}>Master Data Sheet (MDS)</strong> Excel from the MCA portal.</p>
            <input ref={mdsRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={e=>onMds(e.target.files[0])}/>
            <DropZone icon="📊" label="Drop MDS Excel here or click" sub=".xlsx / .xls" loading={loading} loadingText="Parsing MDS..." onClick={()=>!loading&&mdsRef.current?.click()}/>
          </div>
        )}
        {mode==="multi"&&<BatchUploadTab onMulti={onMulti} loading={loading}/>}
        {(mode==="aoc4"||mode==="mgt7")&&(
          <div>
            <p style={{fontSize:11,color:"#64748b",lineHeight:1.7,marginBottom:10}}>
              Upload the <strong style={{color:"#1a5f8a"}}>{mode==="aoc4"?"AOC-4":"MGT-7 / MGT-7A"}</strong> PDF from MCA portal.
              <br/><span style={{color:"#d97706",fontSize:10}}>⚠ Requires text-based MCA eForms PDF (not scanned images)</span>
            </p>
            <input ref={pdfRef} type="file" accept=".pdf" style={{display:"none"}} onChange={e=>onPdf(e.target.files[0],mode)}/>
            <DropZone icon="📋" label={`Drop ${mode==="aoc4"?"AOC-4":"MGT-7"} PDF here or click`} sub=".pdf only" loading={loading} loadingText="Extracting from PDF..." onClick={()=>!loading&&pdfRef.current?.click()}/>
          </div>
        )}
        {err&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:7,padding:"9px 13px",fontSize:11,color:"#dc2626",marginTop:12}}>⚠ {err}</div>}
      </div>
    </div>
  );
}

// ── ReminderModal ─────────────────────────────────────────────────────────────
function ReminderModal({company, rule, dueDate, daysLeft, onClose, onSend}) {
  const [channel,  setChannel]  = useState("email");
  const [toEmail,  setToEmail]  = useState(company.email||"");
  const [toPhone,  setToPhone]  = useState("");
  const [sending,  setSending]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [err,      setErr]      = useState("");

  const urgencyColor = daysLeft===null?"#64748b":daysLeft<0?"#dc2626":daysLeft<=7?"#dc2626":daysLeft<=30?"#d97706":"#0d7a70";
  const urgencyLabel = daysLeft===null?"Event-based":daysLeft<0?`OVERDUE by ${Math.abs(daysLeft)} days`:daysLeft===0?"DUE TODAY":`${daysLeft} days left`;

  async function handleSend() {
    if (channel==="email"&&!toEmail)    { setErr("Enter recipient email address."); return; }
    if (channel==="whatsapp"&&!toPhone) { setErr("Enter recipient WhatsApp number (+91...)."); return; }
    if (channel==="both"&&(!toEmail||!toPhone)) { setErr("Enter both email and WhatsApp number."); return; }
    setSending(true); setErr(""); setResult(null);
    try {
      const res = await onSend({
        channel, to_email:toEmail, to_phone:toPhone,
        company_name:company.companyName, form:rule.form,
        form_title:rule.title, due_date:dueDate, days_left:daysLeft, notes:"",
      });
      setResult(res);
    } catch(e) { setErr("Failed: "+e.message); }
    setSending(false);
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(13,45,74,.55)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(4px)"}}
      onClick={e=>e.target===e.currentTarget&&!sending&&onClose()}>
      <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:"22px",width:"100%",maxWidth:460,boxShadow:"0 24px 64px rgba(13,45,74,.18)"}} className="up">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,borderRadius:8,background:"linear-gradient(135deg,#1a5f8a,#00b4a6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>🔔</div>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#0d2d4a"}}>Send Reminder</div>
              <div style={{fontSize:9,color:"#94a3b8"}}>{company.companyName}</div>
            </div>
          </div>
          {!sending&&<button className="btn" style={{padding:"4px 10px"}} onClick={onClose}>✕</button>}
        </div>
        <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:9,padding:"11px 14px",marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <span style={{fontFamily:"IBM Plex Mono,monospace",fontWeight:700,color:"#1a5f8a",fontSize:12}}>{rule.form}</span>
            <span style={{fontSize:10,fontWeight:700,color:urgencyColor,background:urgencyColor+"15",padding:"2px 9px",borderRadius:5,border:`1px solid ${urgencyColor}30`}}>{urgencyLabel}</span>
          </div>
          <div style={{fontSize:10,color:"#64748b"}}>{rule.title}</div>
          <div style={{fontSize:10,color:"#94a3b8",marginTop:3}}>Due: <strong style={{color:"#334155"}}>{dueDate}</strong></div>
        </div>
        {result&&(
          <div style={{marginBottom:14}}>
            {["email","whatsapp"].map(ch=>{
              const r = result.results?.[ch];
              if (!r) return null;
              return (
                <div key={ch} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",borderRadius:8,marginBottom:6,background:r.success?"#f0fdf4":"#fef2f2",border:`1px solid ${r.success?"#bbf7d0":"#fecaca"}`}}>
                  <span style={{fontSize:14}}>{ch==="email"?"📧":"💬"}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,fontWeight:700,color:r.success?"#16a34a":"#dc2626"}}>{ch==="email"?"Email":"WhatsApp"} — {r.success?"Sent successfully":"Failed"}</div>
                    {!r.success&&r.error&&<div style={{fontSize:9,color:"#dc2626",marginTop:1}}>{r.error}</div>}
                  </div>
                  <span style={{fontSize:16}}>{r.success?"✓":"✗"}</span>
                </div>
              );
            })}
            {result.any_success&&<div style={{marginTop:8,textAlign:"center"}}><button className="btn teal" style={{fontSize:11}} onClick={onClose}>Done</button></div>}
          </div>
        )}
        {!result&&<>
          <div style={{marginBottom:13}}>
            <label style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:6}}>Send Via</label>
            <div style={{display:"flex",gap:5}}>
              {[["email","📧 Email"],["whatsapp","💬 WhatsApp"],["both","📧+💬 Both"]].map(([v,l])=>(
                <button key={v} onClick={()=>{setChannel(v);setErr("");setResult(null);}}
                  style={{flex:1,padding:"8px 0",borderRadius:7,border:`1.5px solid ${channel===v?"#00b4a6":"#e2e8f0"}`,background:channel===v?"#f0fdfa":"#fff",color:channel===v?"#0d7a70":"#94a3b8",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:".13s"}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {(channel==="email"||channel==="both")&&(
            <div style={{marginBottom:10}}>
              <label style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>Recipient Email</label>
              <input className="inp" type="email" placeholder="client@example.com" value={toEmail} onChange={e=>setToEmail(e.target.value)}/>
            </div>
          )}
          {(channel==="whatsapp"||channel==="both")&&(
            <div style={{marginBottom:10}}>
              <label style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>WhatsApp Number (with country code)</label>
              <input className="inp" type="tel" placeholder="+919876543210" value={toPhone} onChange={e=>setToPhone(e.target.value)}/>
              <div style={{fontSize:9,color:"#94a3b8",marginTop:3}}>Must be registered on Twilio sandbox for testing.</div>
            </div>
          )}
          <div style={{marginBottom:13}}>
            <label style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>Message Preview</label>
            <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:7,padding:"10px 12px",fontSize:10,color:"#334155",lineHeight:1.7,whiteSpace:"pre-wrap",fontFamily:"IBM Plex Mono,monospace",maxHeight:140,overflowY:"auto"}}>
{`📋 ROC Compliance Reminder
Company : ${company.companyName}
Form    : ${rule.form} — ${rule.title}
Due Date: ${dueDate}
Status  : ${urgencyLabel}

Please file on time to avoid penalties.
— rocSphere`}
            </div>
          </div>
          {err&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:7,padding:"8px 12px",fontSize:11,color:"#dc2626",marginBottom:10}}>⚠ {err}</div>}
          <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}>
            <button className="btn" onClick={onClose} disabled={sending}>Cancel</button>
            <button className="btn pri" onClick={handleSend} disabled={sending}>
              {sending?<><div className="spin" style={{width:14,height:14}}/> Sending…</>:"🔔 Send Reminder"}
            </button>
          </div>
        </>}
      </div>
    </div>
  );
}

// ── FilingIntelligencePanel ───────────────────────────────────────────────────
function FilingIntelligencePanel({data, company, onClose, onUpdateStatus}) {
  if (!data) return null;
  const {intelligence, crossIssues, parsedDocs} = data;
  const allAlerts   = [...(intelligence?.alerts||[]), ...(crossIssues||[])];
  const advice      = intelligence?.advice||[];
  const autoUpdates = intelligence?.autoUpdates||{};
  const masterDiffs = intelligence?.masterDiffs||[];

  const levelStyle = (l) => ({
    critical: {bg:"#fef2f2", bd:"#fecaca", icon:"🔴", col:"#dc2626"},
    warning:  {bg:"#fffbeb", bd:"#fde68a", icon:"⚠️",  col:"#d97706"},
    info:     {bg:"#eff6ff", bd:"#bfdbfe", icon:"ℹ️",  col:"#1a5f8a"},
    success:  {bg:"#f0fdf4", bd:"#bbf7d0", icon:"✅", col:"#16a34a"},
  }[l]||{bg:"#f8fafc",bd:"#e2e8f0",icon:"•",col:"#64748b"});

  const FORM_LABELS = {aoc4:"AOC-4",adt1:"ADT-1",mgt7:"MGT-7",mgt7a:"MGT-7A",mgt14:"MGT-14",dir3k:"DIR-3 KYC",msme1:"MSME-1",dpt3:"DPT-3"};

  const criticals = allAlerts.filter(a => a.level === "critical");
  const warnings  = allAlerts.filter(a => a.level === "warning");
  const infos     = allAlerts.filter(a => a.level === "info");
  const successes = allAlerts.filter(a => a.level === "success");
  const ordered   = [...criticals, ...warnings, ...infos, ...successes];

  const audRptDoc = (parsedDocs||[]).find(d => d.type === "auditor_report");
  const aoc2Doc   = (parsedDocs||[]).find(d => d.type === "aoc2");

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(13,45,74,.6)",zIndex:400,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"20px 16px",backdropFilter:"blur(4px)",overflowY:"auto"}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:16,padding:"0",width:"100%",maxWidth:720,boxShadow:"0 32px 80px rgba(13,45,74,.22)",marginTop:20,marginBottom:20,overflow:"hidden"}} className="up">
        <div style={{background:"linear-gradient(135deg,#0d2d4a,#1a5f8a)",padding:"18px 22px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:14,fontWeight:800,color:"#fff"}}>📊 Filing Intelligence Report</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.55)",marginTop:2}}>{company?.companyName||""} · {parsedDocs?.length||0} document(s) analysed</div>
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {criticals.length>0&&<span style={{background:"#dc2626",color:"#fff",borderRadius:5,padding:"2px 8px",fontSize:9,fontWeight:700}}>{criticals.length} CRITICAL</span>}
            {warnings.length>0&&<span style={{background:"#d97706",color:"#fff",borderRadius:5,padding:"2px 8px",fontSize:9,fontWeight:700}}>{warnings.length} WARN</span>}
            <button className="btn" style={{padding:"5px 12px",color:"#fff",borderColor:"rgba(255,255,255,.3)",background:"rgba(255,255,255,.1)"}} onClick={onClose}>✕ Close</button>
          </div>
        </div>
        <div style={{padding:"18px 22px",maxHeight:"80vh",overflowY:"auto"}}>
          <div style={{marginBottom:18}}>
            <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Documents Uploaded & Signature Verification</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:7}}>
              {(parsedDocs||[]).map((doc,i)=>{
                const si=doc.signInfo; const status=si?.signStatus;
                const bk=status==="signed"?"#f0fdf4":status==="draft"?"#fef2f2":"#fffbeb";
                const bd=status==="signed"?"#bbf7d0":status==="draft"?"#fecaca":"#fde68a";
                const col=status==="signed"?"#16a34a":status==="draft"?"#dc2626":"#d97706";
                const icon=status==="signed"?"✓":status==="draft"?"✗":"?";
                const label={aoc4:"AOC-4",auditor_report:"Auditor's Report",board_report:"Board's Report",aoc2:"AOC-2",mgt7:"MGT-7",mgt7a:"MGT-7A"}[doc.type]||doc.type;
                const statusLabel=status==="signed"?"MCA signed copy":status==="draft"?"UNSIGNED/DRAFT":"Unverified";
                return (
                  <div key={i} style={{background:bk,border:`1.5px solid ${bd}`,borderRadius:9,padding:"9px 11px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:3}}>
                      <span style={{fontWeight:800,fontSize:12,color:col}}>{icon}</span>
                      <span style={{fontSize:11,fontWeight:700,color:col}}>{label}</span>
                    </div>
                    <div style={{fontSize:9,color:"#64748b",marginBottom:4,wordBreak:"break-all"}}>{doc.fileName?.slice(0,30)||""}</div>
                    <div style={{fontSize:9,fontWeight:700,color:col,background:col+"18",padding:"2px 6px",borderRadius:4,display:"inline-block",marginBottom:4}}>{statusLabel}</div>
                    {si?.signingIndicators?.slice(0,3).map((s,j)=>(
                      <div key={j} style={{fontSize:8,color:s.startsWith("✓")?"#16a34a":s.startsWith("⚠")?"#d97706":"#94a3b8",marginTop:1,lineHeight:1.4}}>{s}</div>
                    ))}
                    {doc.companyName&&<div style={{fontSize:8,color:"#64748b",marginTop:3,borderTop:"1px solid "+bd+"80",paddingTop:3}}>{doc.companyName}</div>}
                  </div>
                );
              })}
            </div>
          </div>
          {audRptDoc&&(
            <div style={{marginBottom:18,background:"#eff6ff",border:"1.5px solid #bfdbfe",borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#1a5f8a",marginBottom:8}}>📋 Auditor's Report — Key Findings</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:7}}>
                {[
                  ["Audit Opinion",audRptDoc.auditOpinion,audRptDoc.auditOpinion==="Unqualified (Clean)"?"#16a34a":"#dc2626"],
                  ["Qualifications",audRptDoc.qualificationsCount===0?"None":audRptDoc.qualificationsCount+" found",audRptDoc.qualificationsCount===0?"#16a34a":"#dc2626"],
                  ["CARO",`Not applicable (${audRptDoc.caroApplicable==="No"?"Small Co":"Applicable"})`,"#64748b"],
                  ["IFC Audit",audRptDoc.ifcApplicability||"-",audRptDoc.ifcApplicability==="Exempted"?"#0d7a70":"#334155"],
                  ["Emphasis",audRptDoc.emphasisOfMatter||"-",audRptDoc.emphasisOfMatter==="None"?"#16a34a":"#d97706"],
                  ["Going Concern",audRptDoc.goingConcern||"-","#64748b"],
                  ["Signed By",audRptDoc.signerName||audRptDoc.signerDIN||"-","#334155"],
                ].map(([l,v,col])=>(
                  <div key={l} style={{background:"#fff",borderRadius:7,padding:"7px 9px",border:"1px solid #bfdbfe"}}>
                    <div style={{fontSize:8,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".4px",marginBottom:2}}>{l}</div>
                    <div style={{fontSize:10,fontWeight:700,color:col||"#334155"}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {aoc2Doc&&(aoc2Doc.armLengthCount>0||aoc2Doc.nonArmLengthCount>0)&&(
            <div style={{marginBottom:18,background:"#fdf4ff",border:"1.5px solid #e9d5ff",borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#7c3aed",marginBottom:8}}>🤝 AOC-2 — Related Party Transactions</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:7,marginBottom:8}}>
                {[
                  ["Non-Arm's Length",aoc2Doc.nonArmLengthCount===0?"None":aoc2Doc.nonArmLengthCount+" transactions",aoc2Doc.nonArmLengthCount===0?"#16a34a":"#dc2626"],
                  ["Arm's Length (Material)",aoc2Doc.armLengthCount>0?aoc2Doc.armLengthCount+" transaction(s)":"None","#7c3aed"],
                ].map(([l,v,col])=>(
                  <div key={l} style={{background:"#fff",borderRadius:7,padding:"7px 9px",border:"1px solid #e9d5ff"}}>
                    <div style={{fontSize:8,fontWeight:700,color:"#a78bfa",textTransform:"uppercase",letterSpacing:".4px",marginBottom:2}}>{l}</div>
                    <div style={{fontSize:10,fontWeight:700,color:col}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {ordered.length>0&&(
            <div style={{marginBottom:18}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Verification & Compliance Alerts ({ordered.length})</div>
              {ordered.map((a,i)=>{
                const s=levelStyle(a.level);
                return (
                  <div key={i} style={{background:s.bg,border:`1px solid ${s.bd}`,borderRadius:8,padding:"8px 12px",marginBottom:5,display:"flex",gap:8,alignItems:"flex-start"}}>
                    <span style={{fontSize:14,marginTop:1,flexShrink:0}}>{s.icon}</span>
                    <span style={{fontSize:11,color:s.col,lineHeight:1.5}}>{a.msg}</span>
                  </div>
                );
              })}
            </div>
          )}
          {masterDiffs.length>0&&(
            <div style={{marginBottom:18,background:"#fffbeb",border:"1.5px solid #fde68a",borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:"#d97706",marginBottom:8}}>⚠ Master Data Mismatch — Update Required</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                <thead><tr style={{borderBottom:"1.5px solid #fde68a"}}>{["Field","PDF Value","Master Data Value","Action"].map(h=><th key={h} style={{padding:"5px 8px",textAlign:"left",fontSize:9,fontWeight:700,color:"#d97706",textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
                <tbody>{masterDiffs.map((d,i)=>(
                  <tr key={i} style={{borderBottom:i<masterDiffs.length-1?"1px solid #fde68a50":"none"}}>
                    <td style={{padding:"6px 8px",fontWeight:700,color:"#0d2d4a"}}>{d.field}</td>
                    <td style={{padding:"6px 8px",color:"#1a5f8a",fontFamily:"IBM Plex Mono,monospace",fontSize:9}}>{d.pdfVal}</td>
                    <td style={{padding:"6px 8px",color:"#dc2626",fontFamily:"IBM Plex Mono,monospace",fontSize:9}}>{d.masterVal}</td>
                    <td style={{padding:"6px 8px",fontSize:9,color:"#d97706",fontStyle:"italic"}}>Update master data</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {Object.keys(autoUpdates).length>0&&(
            <div style={{marginBottom:18}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Auto-Updated Statuses from PDFs</div>
              {Object.entries(autoUpdates).map(([ruleId,st])=>(
                <div key={ruleId} style={{background:st.status==="filed"?"#f0fdf4":"#fffbeb",border:`1px solid ${st.status==="filed"?"#bbf7d0":"#fde68a"}`,borderRadius:8,padding:"8px 12px",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <span style={{fontFamily:"IBM Plex Mono,monospace",fontWeight:700,color:"#1a5f8a",fontSize:11}}>{FORM_LABELS[ruleId]||ruleId}</span>
                    <span style={{fontSize:9,color:"#64748b",marginLeft:8}}>SRN: {st.srn||"—"}</span>
                    {st.notes&&<div style={{fontSize:9,color:"#94a3b8",marginTop:1}}>{st.notes}</div>}
                  </div>
                  <span style={{fontSize:10,fontWeight:700,color:st.status==="filed"?"#16a34a":"#d97706",background:st.status==="filed"?"#dcfce7":"#fffbeb",padding:"2px 8px",borderRadius:5,border:`1px solid ${st.status==="filed"?"#bbf7d0":"#fde68a"}`}}>
                    {st.status==="filed"?"FILED ✓":"PENDING"}
                  </span>
                </div>
              ))}
            </div>
          )}
          {advice.length>0&&(
            <div style={{marginBottom:10}}>
              <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",marginBottom:8}}>Next Filing Recommendations ({advice.length})</div>
              <div style={{borderRadius:9,border:"1px solid #e2e8f0",overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:"#f8fafc",borderBottom:"2px solid #e2e8f0"}}>{["Form","Due Date","Priority","Note"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".4px"}}>{h}</th>)}</tr></thead>
                  <tbody>{advice.map((a,i)=>{
                    const priBg=a.priority==="HIGH"?"#fef2f2":a.priority==="MEDIUM"?"#fffbeb":"#f8fafc";
                    const priCol=a.priority==="HIGH"?"#dc2626":a.priority==="MEDIUM"?"#d97706":"#64748b";
                    return (
                      <tr key={i} className="row" style={{borderBottom:i<advice.length-1?"1px solid #f1f5f9":"none"}}>
                        <td style={{padding:"8px 10px",fontFamily:"IBM Plex Mono,monospace",fontWeight:700,color:"#1a5f8a",fontSize:10}}>{a.form}</td>
                        <td style={{padding:"8px 10px",color:"#334155",fontWeight:500}}>{a.due}</td>
                        <td style={{padding:"8px 10px"}}><span style={{fontSize:9,fontWeight:700,color:priCol,background:priBg,padding:"2px 8px",borderRadius:5,border:`1px solid ${priCol}30`}}>{a.priority}</span></td>
                        <td style={{padding:"8px 10px",color:"#64748b",fontSize:10}}>{a.note}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </div>
          )}
          <div style={{marginTop:18,textAlign:"center"}}>
            <button className="btn teal" style={{fontSize:11,padding:"8px 24px"}} onClick={onClose}>✓ Got it — View Compliance Dashboard</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── AGMClusterBanner ──────────────────────────────────────────────────────────
function AGMClusterBanner({company, applicable, onEdit}) {
  const clusterRules = applicable.filter(r=>AGM_CLUSTER_IDS.includes(r.id));
  if (clusterRules.length === 0) return null;
  return (
    <div style={{background:"linear-gradient(135deg,#fffbeb,#fff7ed)",border:"1.5px solid #fde68a",borderRadius:10,padding:"12px 16px",marginBottom:14}}>
      <div style={{fontSize:9,fontWeight:700,color:"#d97706",textTransform:"uppercase",letterSpacing:".7px",marginBottom:10}}>
        📋 AOC-4 AGM Cluster — 4 Connected Forms (Same AGM Trigger: {company.lastAGM||"—"})
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8}}>
        {clusterRules.map(rule=>{
          const st=company.filingStatus?.[rule.id]||{status:"pending"};
          const stCol=st.status==="filed"?"#16a34a":st.status==="na"?"#64748b":"#d97706";
          const stBg=st.status==="filed"?"#f0fdf4":st.status==="na"?"#f1f5f9":"#fffbeb";
          return (
            <div key={rule.id} onClick={()=>onEdit(rule.id, st)}
              style={{background:"#fff",border:`1px solid #fde68a`,borderRadius:8,padding:"10px 12px",cursor:"pointer",transition:".13s"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor="#f59e0b"}
              onMouseLeave={e=>e.currentTarget.style.borderColor="#fde68a"}>
              <div style={{fontFamily:"IBM Plex Mono,monospace",fontWeight:700,color:"#1a5f8a",fontSize:11}}>{rule.form}</div>
              <div style={{fontSize:9,color:"#64748b",margin:"2px 0 6px",lineHeight:1.3}}>{rule.title}</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span style={{fontSize:8,fontWeight:700,color:stCol,background:stBg,padding:"1px 6px",borderRadius:4,border:`1px solid ${stCol}25`}}>
                  {st.status==="filed"?"✓ FILED":st.status==="na"?"N/A":"PENDING"}
                </span>
                <span style={{fontSize:8,color:"#94a3b8"}}>click to update</span>
              </div>
              {st.srn&&<div style={{fontSize:8,color:"#0d7a70",fontFamily:"IBM Plex Mono,monospace",marginTop:3}}>{st.srn}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Multi-Year Data Tab ───────────────────────────────────────────────────────
const MULTI_YEAR_AY_LIST = Array.from({length:7},(_,i)=>{
  const y = CUR_YEAR - 4 + i;
  return `${y}-${String(y+1).slice(2)}`;
});

const MY_FORMS = [
  {id:"aoc4",  form:"AOC-4",      label:"AOC-4",     cat:"Annual"},
  {id:"mgt7",  form:"MGT-7",      label:"MGT-7",     cat:"Annual"},
  {id:"mgt7a", form:"MGT-7A",     label:"MGT-7A",    cat:"Annual"},
  {id:"adt1",  form:"ADT-1",      label:"ADT-1",     cat:"Annual"},
  {id:"mgt14", form:"MGT-14",     label:"MGT-14",    cat:"Annual"},
  {id:"dir3k", form:"DIR-3 KYC",  label:"DIR-3 KYC", cat:"Director"},
  {id:"dpt3",  form:"DPT-3",      label:"DPT-3",     cat:"Statutory"},
  {id:"msme1", form:"MSME-1",     label:"MSME-1",    cat:"Statutory"},
  {id:"csr2",  form:"CSR-2",      label:"CSR-2",     cat:"CSR"},
  {id:"llp8",  form:"Form 8",     label:"Form 8",    cat:"LLP"},
  {id:"llp11", form:"Form 11",    label:"Form 11",   cat:"LLP"},
];

function MultiYearTab({companies, fetchCompanies, handlePDF}) {
  const [selAYs,    setSelAYs]   = useState(MULTI_YEAR_AY_LIST.slice(3,6));
  const [editCell,  setEditCell] = useState(null);
  const [searchCo,  setSearchCo] = useState("");
  const [showForms, setShowForms]= useState(MY_FORMS.map(f=>f.id));
  const [viewMode,  setViewMode] = useState("matrix");
  const [saving,    setSaving]   = useState(false);
  const [catFilter, setCatFilter]= useState("All");

  const visibleForms = MY_FORMS.filter(f=>showForms.includes(f.id)&&(catFilter==="All"||f.cat===catFilter));
  const filteredCos  = companies.filter(co=>
    !searchCo||co.companyName.toLowerCase().includes(searchCo.toLowerCase())||(co.cin||"").toLowerCase().includes(searchCo.toLowerCase())
  );

  const getStatus = (co, ruleId, ay) => {
    const ayKey = `${ruleId}__${ay}`;
    if (co.filingStatus?.[ayKey]) return co.filingStatus[ayKey];
    // Fallback: check if base key's filedDate falls in this AY's FY window
    const base = co.filingStatus?.[ruleId];
    if (base?.filedDate) {
      const [dd,mm,yyyy] = (base.filedDate||"").split("/").map(Number);
      if (yyyy) {
        const filed = new Date(yyyy,mm-1,dd);
        const ayOpt = AY_OPTIONS.find(a=>a.value===ay);
        if (ayOpt && filed >= ayOpt.fyStart && filed <= ayOpt.fyEnd) return base;
      }
    }
    return {status:"pending", noData:true};
  };

  const stDisplay = (st, applies) => {
    if (!applies) return {icon:"—", bg:"#f8fafc", col:"#cbd5e1", bd:"#f1f5f9"};
    const s = st?.status;
    if (s==="filed")  return {icon:"✓",   bg:"#f0fdf4", col:"#16a34a", bd:"#bbf7d0"};
    if (s==="na")     return {icon:"N/A", bg:"#f8fafc",  col:"#94a3b8", bd:"#e2e8f0"};
    if (st?.noData)   return {icon:"·",   bg:"#f8fafc",  col:"#c4cdd6", bd:"#e8ecf0", noData:true};
    return               {icon:"○",   bg:"#fffbeb",  col:"#d97706", bd:"#fde68a"};
  };

  const saveCell = async (cin, ruleId, ay, data) => {
    setSaving(true);
    try {
      await fetchWithTimeout(`${API_BASE}/filing-status/${cin}`, {
        method:"PUT", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({rule_id:`${ruleId}__${ay}`, ...data}),
      }, 10000);
      const recentAYs = MULTI_YEAR_AY_LIST.slice(-3);
      if (recentAYs.includes(ay)) {
        await fetchWithTimeout(`${API_BASE}/filing-status/${cin}`, {
          method:"PUT", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({rule_id:ruleId, ...data}),
        }, 10000);
      }
      await fetchCompanies();
      setEditCell(null);
      // toast is handled by parent via state lifting if needed
    } catch { alert("Save failed — please try again"); }
    setSaving(false);
  };

  const summaryRows = filteredCos.map(co => {
    const ayStats = {};
    let totalAll=0, filedAll=0;
    for (const ay of selAYs) {
      let tot=0, fil=0, pend=0;
      for (const f of visibleForms) {
        const rule = COMPLIANCE_RULES.find(r=>r.id===f.id);
        if (!rule?.applies(co)) continue;
        tot++; totalAll++;
        const st = getStatus(co, f.id, ay);
        if (st?.status==="filed") { fil++; filedAll++; }
        else if (st?.status!=="na") pend++;
      }
      ayStats[ay] = {tot, fil, pend, pct:tot?Math.round(fil/tot*100):0};
    }
    return {co, ayStats, totalAll, filedAll, overallPct:totalAll?Math.round(filedAll/totalAll*100):0};
  });

  const cats = ["All", ...new Set(MY_FORMS.map(f=>f.cat))];

  return (
    <div className="up">
      {/* Controls */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:12}}>
        <input className="inp" style={{maxWidth:210,padding:"6px 10px",fontSize:10}} placeholder="🔍 Search company or CIN…" value={searchCo} onChange={e=>setSearchCo(e.target.value)}/>
        <div style={{display:"flex",gap:3,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:3}}>
          {[["matrix","⊞ Matrix"],["summary","≡ Summary"]].map(([v,l])=>(
            <button key={v} onClick={()=>setViewMode(v)} style={{padding:"5px 11px",borderRadius:5,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:700,transition:".13s",background:viewMode===v?"linear-gradient(135deg,#1a5f8a,#0d2d4a)":"transparent",color:viewMode===v?"#fff":"#94a3b8"}}>{l}</button>
          ))}
        </div>
        <div style={{height:20,width:1,background:"#e2e8f0"}}/>
        <span style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px"}}>AY:</span>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {MULTI_YEAR_AY_LIST.map(ay=>(
            <button key={ay} onClick={()=>setSelAYs(p=>p.includes(ay)?p.length>1?p.filter(x=>x!==ay):p:[...p,ay].sort())}
              style={{padding:"4px 9px",borderRadius:5,fontFamily:"inherit",cursor:"pointer",transition:".13s",fontSize:9,fontWeight:700,
                border:`1.5px solid ${selAYs.includes(ay)?"#1a5f8a":"#e2e8f0"}`,
                background:selAYs.includes(ay)?"#eff6ff":"#fff",
                color:selAYs.includes(ay)?"#1a5f8a":"#94a3b8"}}>{ay}</button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:10,fontSize:10,color:"#64748b",alignItems:"center"}}>
          <span><strong style={{color:"#1a5f8a"}}>{filteredCos.length}</strong> cos</span>
          <span><strong style={{color:"#1a5f8a"}}>{selAYs.length}</strong> AYs</span>
          <span><strong style={{color:"#1a5f8a"}}>{visibleForms.length}</strong> forms</span>
        </div>
      </div>

      {/* Form filters */}
      <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",marginBottom:12,padding:"9px 12px",background:"#f8fafc",borderRadius:9,border:"1px solid #e2e8f0"}}>
        <span style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".4px",marginRight:4}}>Category:</span>
        {cats.map(c=>(
          <button key={c} onClick={()=>setCatFilter(c)} style={{padding:"3px 9px",borderRadius:5,fontFamily:"inherit",cursor:"pointer",fontSize:9,fontWeight:700,transition:".13s",border:`1.5px solid ${catFilter===c?"#6366f1":"#e2e8f0"}`,background:catFilter===c?"#eef2ff":"#fff",color:catFilter===c?"#4f46e5":"#94a3b8"}}>{c}</button>
        ))}
        <div style={{height:16,width:1,background:"#e2e8f0",margin:"0 4px"}}/>
        <span style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".4px",marginRight:4}}>Forms:</span>
        {MY_FORMS.filter(f=>catFilter==="All"||f.cat===catFilter).map(f=>(
          <button key={f.id} onClick={()=>setShowForms(p=>p.includes(f.id)?p.filter(x=>x!==f.id):[...p,f.id])}
            style={{padding:"3px 9px",borderRadius:5,fontFamily:"inherit",cursor:"pointer",fontSize:9,fontWeight:700,transition:".13s",
              border:`1.5px solid ${showForms.includes(f.id)?"#00b4a6":"#e2e8f0"}`,
              background:showForms.includes(f.id)?"#f0fdfa":"#fff",
              color:showForms.includes(f.id)?"#0d7a70":"#94a3b8"}}>{f.form}</button>
        ))}
        <div style={{display:"flex",gap:4,marginLeft:"auto"}}>
          <button onClick={()=>setShowForms(MY_FORMS.map(f=>f.id))} style={{padding:"3px 9px",borderRadius:5,border:"1px solid #e2e8f0",background:"#fff",color:"#64748b",fontSize:9,cursor:"pointer",fontFamily:"inherit"}}>All</button>
          <button onClick={()=>setShowForms([])} style={{padding:"3px 9px",borderRadius:5,border:"1px solid #e2e8f0",background:"#fff",color:"#64748b",fontSize:9,cursor:"pointer",fontFamily:"inherit"}}>None</button>
        </div>
      </div>

      {/* Matrix view */}
      {viewMode==="matrix"&&(
        <div style={{overflowX:"auto",borderRadius:12,border:"1px solid #e2e8f0",boxShadow:"0 2px 12px rgba(13,45,74,.07)"}}>
          <table style={{borderCollapse:"collapse",fontSize:10,background:"#fff",minWidth:"max-content",width:"100%"}}>
            <thead>
              <tr style={{background:"linear-gradient(135deg,#0d2d4a 0%,#1a5f8a 100%)"}}>
                <th rowSpan={2} style={{padding:"12px 16px",textAlign:"left",fontSize:10,fontWeight:700,color:"rgba(255,255,255,.9)",minWidth:220,maxWidth:240,position:"sticky",left:0,zIndex:6,background:"linear-gradient(135deg,#0d2d4a,#0d3a5c)",borderRight:"2px solid rgba(255,255,255,.15)"}}>Company</th>
                {selAYs.map(ay=>(
                  <th key={ay} colSpan={visibleForms.length} style={{padding:"10px 8px",textAlign:"center",fontSize:10,fontWeight:800,color:"#fff",borderLeft:"2px solid rgba(255,255,255,.2)",letterSpacing:".3px",whiteSpace:"nowrap"}}>AY {ay}</th>
                ))}
              </tr>
              <tr style={{background:"#f0f4f8",borderBottom:"2px solid #e2e8f0"}}>
                {selAYs.flatMap(ay=>visibleForms.map((f,fi)=>(
                  <th key={ay+f.id} style={{padding:"7px 3px",textAlign:"center",fontSize:8,color:"#475569",fontWeight:700,borderLeft:fi===0?"2px solid #cbd5e1":"1px solid #e8ecf0",minWidth:58,maxWidth:70,background:fi%2===0?"#f0f4f8":"#edf2f7"}}>
                    <div style={{fontFamily:"IBM Plex Mono,monospace",lineHeight:1.3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:58,margin:"0 auto"}}>{f.form}</div>
                  </th>
                )))}
              </tr>
            </thead>
            <tbody>
              {filteredCos.length===0&&(
                <tr><td colSpan={999} style={{padding:"52px",textAlign:"center",color:"#94a3b8",fontSize:12}}><div style={{fontSize:28,marginBottom:8}}>🔎</div>No companies match your search</td></tr>
              )}
              {filteredCos.map((co,ci)=>(
                <tr key={co.cin} style={{borderBottom:"1px solid #f1f5f9",background:ci%2===0?"#fff":"#fafbfc",transition:".1s"}}>
                  <td style={{padding:"10px 14px",position:"sticky",left:0,zIndex:4,background:ci%2===0?"#fff":"#fafbfc",borderRight:"2px solid #e2e8f0",minWidth:220,maxWidth:240}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#0d2d4a",lineHeight:1.35,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}} title={co.companyName}>{co.companyName}</div>
                    <div style={{fontSize:8,color:"#94a3b8",fontFamily:"IBM Plex Mono,monospace",marginTop:2}}>{co.cin}</div>
                    <div style={{display:"flex",gap:3,marginTop:4,flexWrap:"wrap"}}>
                      {co.isSmallCompany==="Yes"&&<span style={{fontSize:7,fontWeight:700,color:"#0d7a70",background:"#f0fdfa",border:"1px solid #99f6e4",borderRadius:3,padding:"1px 4px"}}>Small Co</span>}
                      <span style={{fontSize:7,color:"#64748b",background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:3,padding:"1px 4px"}}>{co.companyType}</span>
                      {co.lastAGM&&<span style={{fontSize:7,color:"#94a3b8",background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:3,padding:"1px 4px"}}>AGM: {co.lastAGM}</span>}
                    </div>
                  </td>
                  {selAYs.flatMap(ay=>visibleForms.map((f,fi)=>{
                    const rule=COMPLIANCE_RULES.find(r=>r.id===f.id);
                    const applies=rule?rule.applies(co):false;
                    const st=getStatus(co,f.id,ay);
                    const disp=stDisplay(st,applies);
                    return (
                      <td key={ay+f.id}
                        onClick={()=>applies&&setEditCell({cin:co.cin,ruleId:f.id,ay,current:st,rule:f,company:co})}
                        title={`${co.companyName} · ${f.form} · AY ${ay}\n${applies?"Status: "+(st?.status||"pending")+(st?.srn?" · SRN: "+st.srn:""):"Not applicable"}`}
                        style={{padding:"5px 3px",textAlign:"center",borderLeft:fi===0?"2px solid #e2e8f0":"1px solid #f1f5f9",cursor:applies?"pointer":"default",background:ci%2===0?"#fff":"#fafbfc",transition:".1s"}}
                        onMouseEnter={e=>{if(applies)e.currentTarget.style.background="#f0fdfa"}}
                        onMouseLeave={e=>e.currentTarget.style.background=ci%2===0?"#fff":"#fafbfc"}>
                        <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:40,height:26,borderRadius:5,background:disp.bg,border:`1px solid ${disp.bd}`,fontSize:applies&&st?.status==="filed"?10:8,fontWeight:700,color:disp.col,userSelect:"none",transition:".12s"}}>
                          {disp.icon}
                        </div>
                        {applies&&st?.status==="filed"&&st?.srn&&(
                          <div style={{fontSize:6,color:"#0d7a70",fontFamily:"IBM Plex Mono,monospace",marginTop:1,maxWidth:54,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"center"}}>{st.srn.slice(0,9)}</div>
                        )}
                        {applies&&st?.status==="filed"&&st?.filedDate&&(
                          <div style={{fontSize:6,color:"#64748b",marginTop:0,textAlign:"center",whiteSpace:"nowrap"}}>{st.filedDate.slice(0,5)}</div>
                        )}
                      </td>
                    );
                  }))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary view */}
      {viewMode==="summary"&&(
        <div style={{overflowX:"auto",borderRadius:12,border:"1px solid #e2e8f0",boxShadow:"0 2px 8px rgba(13,45,74,.06)"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,background:"#fff"}}>
            <thead>
              <tr style={{background:"linear-gradient(135deg,#0d2d4a,#1a5f8a)"}}>
                <th style={{padding:"12px 16px",textAlign:"left",color:"rgba(255,255,255,.9)",fontSize:10,fontWeight:700,minWidth:220,position:"sticky",left:0,zIndex:5,background:"#0d2d4a",borderRight:"2px solid rgba(255,255,255,.15)"}}>Company</th>
                {selAYs.map(ay=><th key={ay} colSpan={3} style={{padding:"12px 8px",textAlign:"center",color:"#fff",fontSize:9,fontWeight:700,borderLeft:"2px solid rgba(255,255,255,.2)"}}>AY {ay}</th>)}
                <th style={{padding:"12px 14px",textAlign:"center",color:"rgba(255,255,255,.9)",fontSize:9,fontWeight:700,borderLeft:"2px solid rgba(255,255,255,.2)"}}>Overall</th>
              </tr>
              <tr style={{background:"#f0f4f8",borderBottom:"2px solid #e2e8f0"}}>
                <th style={{padding:"8px 16px",textAlign:"left",fontSize:8,color:"#94a3b8",fontWeight:600,position:"sticky",left:0,background:"#f0f4f8",borderRight:"2px solid #e2e8f0"}}>Name / CIN</th>
                {selAYs.flatMap(ay=>[
                  <th key={ay+"f"} style={{padding:"7px 6px",textAlign:"center",fontSize:8,color:"#16a34a",fontWeight:700,borderLeft:"2px solid #e2e8f0"}}>Filed</th>,
                  <th key={ay+"p"} style={{padding:"7px 6px",textAlign:"center",fontSize:8,color:"#d97706",fontWeight:700}}>Pending</th>,
                  <th key={ay+"%"} style={{padding:"7px 6px",textAlign:"center",fontSize:8,color:"#1a5f8a",fontWeight:700}}>%</th>,
                ])}
                <th style={{padding:"7px 14px",textAlign:"center",fontSize:8,color:"#1a5f8a",fontWeight:700,borderLeft:"2px solid #e2e8f0"}}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(({co,ayStats,overallPct},ci)=>(
                <tr key={co.cin} className="row" style={{borderBottom:"1px solid #f1f5f9",background:ci%2===0?"#fff":"#fafbfc"}}>
                  <td style={{padding:"11px 16px",position:"sticky",left:0,zIndex:4,background:ci%2===0?"#fff":"#fafbfc",borderRight:"2px solid #e2e8f0",minWidth:220}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#0d2d4a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:200}}>{co.companyName}</div>
                    <div style={{fontSize:8,color:"#94a3b8",fontFamily:"IBM Plex Mono,monospace",marginTop:2}}>{co.cin}</div>
                  </td>
                  {selAYs.flatMap(ay=>{
                    const s=ayStats[ay]||{tot:0,fil:0,pend:0,pct:0};
                    return [
                      <td key={ay+"f"} style={{padding:"11px 6px",textAlign:"center",borderLeft:"2px solid #f1f5f9"}}><span style={{fontSize:13,fontWeight:800,color:"#16a34a"}}>{s.fil}</span></td>,
                      <td key={ay+"p"} style={{padding:"11px 6px",textAlign:"center"}}><span style={{fontSize:13,fontWeight:800,color:s.pend>0?"#d97706":"#94a3b8"}}>{s.pend}</span></td>,
                      <td key={ay+"%"} style={{padding:"11px 6px",textAlign:"center"}}><span style={{fontSize:11,fontWeight:800,color:s.pct===100?"#16a34a":s.pct>=60?"#1a5f8a":"#d97706"}}>{s.pct}%</span></td>,
                    ];
                  })}
                  <td style={{padding:"11px 16px",borderLeft:"2px solid #f1f5f9"}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{flex:1,height:6,background:"#f1f5f9",borderRadius:4,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${overallPct}%`,borderRadius:4,transition:".5s",background:overallPct===100?"linear-gradient(90deg,#16a34a,#22c55e)":overallPct>=60?"linear-gradient(90deg,#1a5f8a,#00b4a6)":"linear-gradient(90deg,#d97706,#f59e0b)"}}/>
                      </div>
                      <span style={{fontSize:10,fontWeight:800,minWidth:30,color:overallPct===100?"#16a34a":overallPct>=60?"#1a5f8a":"#d97706"}}>{overallPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{display:"flex",gap:12,marginTop:10,alignItems:"center",flexWrap:"wrap",padding:"8px 12px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0"}}>
        {[["✓","#f0fdf4","#16a34a","#bbf7d0","Filed"],["○","#fffbeb","#d97706","#fde68a","Pending — click to update"],["N/A","#f8fafc","#94a3b8","#e2e8f0","N/A"],["—","#f8fafc","#cbd5e1","#f1f5f9","Rule N/A"]].map(([ic,bg,col,bd,lbl])=>(
          <div key={lbl} style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:28,height:20,borderRadius:4,background:bg,border:`1px solid ${bd}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700,color:col}}>{ic}</div>
            <span style={{fontSize:9,color:"#64748b"}}>{lbl}</span>
          </div>
        ))}
        <span style={{fontSize:9,color:"#94a3b8",marginLeft:"auto"}}>💡 Click any pending cell to update status or attach filed PDF</span>
      </div>

      {/* Edit Cell Modal */}
      {editCell&&(
        <div style={{position:"fixed",inset:0,background:"rgba(13,45,74,.55)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(4px)"}} onClick={e=>e.target===e.currentTarget&&!saving&&setEditCell(null)}>
          <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:"22px",width:"100%",maxWidth:430,boxShadow:"0 24px 64px rgba(13,45,74,.20)"}} className="up">
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
              <div style={{width:36,height:36,borderRadius:9,flexShrink:0,background:"linear-gradient(135deg,#1a5f8a,#00b4a6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>📋</div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:800,color:"#0d2d4a"}}>{editCell.rule.form}</div>
                <div style={{fontSize:9,color:"#94a3b8",marginTop:1}}>{editCell.company.companyName} · <strong style={{color:"#1a5f8a"}}>AY {editCell.ay}</strong></div>
              </div>
              <button className="btn" style={{padding:"4px 10px"}} onClick={()=>setEditCell(null)}>✕</button>
            </div>
            <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:7,padding:"7px 11px",marginBottom:13,display:"flex",alignItems:"center",gap:7,fontSize:10}}>
              <span style={{fontSize:14}}>📅</span>
              <span style={{color:"#64748b"}}>Filing for Assessment Year:</span>
              <strong style={{color:"#1a5f8a",fontFamily:"IBM Plex Mono,monospace"}}>{editCell.ay}</strong>
            </div>
            <EditForm
              init={editCell.current}
              rule={editCell.rule}
              onSave={d=>saveCell(editCell.cin, editCell.ruleId, editCell.ay, d)}
              onCancel={()=>setEditCell(null)}
              onPdfUpload={async (file,parsed)=>{ if(handlePDF) await handlePDF(file, parsed.type); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Toast notification ───────────────────────────────────────────────────────
function Toast({msg, type, onClose}) {
  useEffect(()=>{ const t=setTimeout(onClose,4000); return()=>clearTimeout(t); },[onClose]);
  const bg   = type==="success"?"linear-gradient(135deg,#0d7a70,#16a34a)":type==="error"?"linear-gradient(135deg,#dc2626,#b91c1c)":"linear-gradient(135deg,#1a5f8a,#0d2d4a)";
  return (
    <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,maxWidth:380,minWidth:260,background:bg,color:"#fff",borderRadius:12,padding:"13px 18px",boxShadow:"0 8px 32px rgba(0,0,0,.22)",display:"flex",alignItems:"flex-start",gap:10,animation:"up .25s ease"}} className="up">
      <span style={{fontSize:18,flexShrink:0,marginTop:1}}>{type==="success"?"✅":type==="error"?"❌":"ℹ️"}</span>
      <div style={{flex:1,fontSize:12,fontWeight:600,lineHeight:1.5}}>{msg}</div>
      <button onClick={onClose} style={{background:"rgba(255,255,255,.2)",border:"none",color:"#fff",borderRadius:5,width:20,height:20,cursor:"pointer",fontFamily:"inherit",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [db,          setDb]          = useState({companies:{}});
  const [screen,      setScreen]      = useState("dash");
  const [selCin,      setSelCin]      = useState(null);
  const [tab,         setTab]         = useState("compliances");
  const [dashTab,     setDashTab]     = useState("overview");
  const [showUpload,  setShowUpload]  = useState(false);
  const [uploadMode,  setUploadMode]  = useState("mds");
  const [uploading,   setUploading]   = useState(false);
  const [uploadErr,   setUploadErr]   = useState("");
  const [editStatus,  setEditStatus]  = useState(null);
  const [filterCat,   setFilterCat]   = useState("All");
  const [filterSt,    setFilterSt]    = useState("All");
  const [search,      setSearch]      = useState("");
  const [delConfirm,  setDelConfirm]  = useState(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [backendErr,  setBackendErr]  = useState("");
  const [loadingMsg,  setLoadingMsg]  = useState("Connecting to backend...");
  const [selAY,         setSelAY]         = useState(DEFAULT_AY);
  const [reminderModal, setReminderModal] = useState(null);
  const [filingIntelligence, setFilingIntelligence] = useState(null);
  const [showIntelPanel, setShowIntelPanel] = useState(false);
  const [toast,          setToast]          = useState(null); // {msg, type}

  const ayOption = useMemo(()=>AY_OPTIONS.find(a=>a.value===selAY)||AY_OPTIONS[2],[selAY]);
  const calcDue  = (rule, co) => calcDueDates(rule, co, ayOption);

  // ── API helpers ──────────────────────────────────────────────────────────────
  const fetchCompanies = async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/companies`, {}, 8000);
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.companies || []);
      const obj = {};
      list.forEach(co => { obj[co.cin] = co; });
      setDb({companies: obj});
      setBackendErr("");
    } catch (err) {
      if (err.name === "AbortError") {
        setBackendErr("Backend timed out — it may be waking up. Refresh in 30 seconds.");
      } else {
        setBackendErr(err.message);
      }
    }
  };

  const saveCompanyToBackend = async (companyData) => {
    const res = await fetchWithTimeout(`${API_BASE}/companies`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(companyData),
    }, 10000);
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    await fetchCompanies();
  };

  const updateFilingStatusAPI = async (cin, ruleId, statusData) => {
    const res = await fetchWithTimeout(`${API_BASE}/filing-status/${cin}`, {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({rule_id: ruleId, ...statusData}),
    }, 10000);
    if (!res.ok) throw new Error(`Update failed: ${res.status}`);
    await fetchCompanies();
  };

  const saveDocumentAnalysis = async (cin, parsedDocs, intelligence, crossIssues) => {
    try {
      await fetchWithTimeout(`${API_BASE}/document-analysis/${cin}`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          documents: parsedDocs.map(p => ({
            type: p.type, fileName: p.fileName, srn: p.srn||"",
            filingDate: p.filingDate||"", fyFrom: p.fyFrom||"", fyTo: p.fyTo||"",
            companyName: p.companyName||"", signInfo: p.signInfo || {},
          })),
          intelligence: {
            alerts:      intelligence?.alerts||[],
            advice:      intelligence?.advice||[],
            autoUpdates: intelligence?.autoUpdates||{},
            masterDiffs: intelligence?.masterDiffs||[],
          },
          crossIssues: crossIssues||[],
          parsedAt: new Date().toISOString(),
        }),
      }, 10000);
    } catch (e) {
      console.warn("saveDocumentAnalysis failed (non-critical):", e.message);
    }
  };

  const deleteCompany = async (cin) => {
    try {
      await fetchWithTimeout(`${API_BASE}/companies/${cin}`, {method:"DELETE"}, 8000);
      await fetchCompanies();
      if (selCin===cin) { setSelCin(null); setScreen("dash"); }
      setDelConfirm(null);
    } catch { alert("Failed to delete company"); }
  };

  useEffect(() => {
    const t1 = setTimeout(() => setLoadingMsg("Backend is waking up, please wait..."), 3000);
    const t2 = setTimeout(() => setLoadingMsg("Almost there... (first load can take ~30s)"), 8000);
    (async () => {
      await fetchCompanies();
      setDataLoading(false);
      clearTimeout(t1);
      clearTimeout(t2);
    })();
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────────
  const companies  = useMemo(() => Object.values(db.companies), [db]);
  const company    = useMemo(() => selCin && db.companies[selCin] ? db.companies[selCin] : null, [selCin, db]);
  const applicable = useMemo(() => company ? COMPLIANCE_RULES.filter(r=>r.applies(company)) : [], [company]);
  // Helper: get filing status for a given rule + current AY
  const getAYStatus = (co, ruleId, ay) => {
    const ayKey = `${ruleId}__${ay}`;
    if (co?.filingStatus?.[ayKey]) return co.filingStatus[ayKey];
    // Fallback: check if base key's filedDate falls within this AY's FY window
    const base = co?.filingStatus?.[ruleId];
    if (base?.filedDate) {
      const [dd,mm,yyyy] = (base.filedDate||"").split("/").map(Number);
      if (yyyy) {
        const filed = new Date(yyyy,mm-1,dd);
        const ayOpt = AY_OPTIONS.find(a=>a.value===ay);
        if (ayOpt && filed >= ayOpt.fyStart && filed <= ayOpt.fyEnd) return base;
      }
    }
    return {status:"pending"};
  };

  const filtered   = useMemo(() => applicable.filter(r => {
    const st = getAYStatus(company, r.id, selAY)?.status || "pending";
    return (filterCat==="All"||r.cat===filterCat) &&
           (filterSt==="All"||filterSt===st) &&
           (!search||r.title.toLowerCase().includes(search.toLowerCase())||r.form.toLowerCase().includes(search.toLowerCase()));
  }), [applicable, filterCat, filterSt, search, company, selAY]);

  const globalUpcoming = useMemo(() => {
    const items = [];
    for (const co of companies) {
      for (const rule of COMPLIANCE_RULES.filter(r=>r.applies(co))) {
        const st = getAYStatus(co, rule.id, selAY)?.status || "pending";
        if (st==="filed"||st==="na") continue;
        const {upcoming:u} = calcDueDates(rule, co, ayOption);
        if (!u?.date) continue;
        const n = daysLeft(u.date);
        if (n!==null&&n>=0&&n<=90) items.push({cin:co.cin, name:co.companyName, rule, date:u.date, label:u.label, n});
      }
    }
    return items.sort((a,b)=>a.n-b.n);
  }, [companies, ayOption]);

  const coStats = useMemo(() => {
    const s = {};
    for (const co of companies) {
      const rules = COMPLIANCE_RULES.filter(r=>r.applies(co));
      let filed=0, overdue=0, up30=0;
      for (const r of rules) {
        const st = getAYStatus(co, r.id, selAY)?.status || "pending";
        if (st==="filed") { filed++; continue; }
        if (st==="na") continue;
        const {upcoming:u} = calcDueDates(r, co, ayOption);
        if (!u?.date) continue;
        const n = daysLeft(u.date);
        if (n!==null&&n<0) overdue++;
        else if (n!==null&&n<=30) up30++;
      }
      s[co.cin] = {total:rules.length, filed, overdue, up30};
    }
    return s;
  }, [companies, ayOption]);

  // ── Upload handlers ──────────────────────────────────────────────────────────
  const handleMDS = async (file) => {
    if (!file?.name.match(/\.(xlsx|xls)$/i)) { setUploadErr("Upload a valid .xlsx/.xls file"); return; }
    setUploading(true); setUploadErr("");
    try {
      const p = await parseMDS(file);
      if (!p.master.cin) { setUploadErr("CIN not found in file."); setUploading(false); return; }
      const ex = db.companies[p.master.cin] || {filingStatus:{}, documents:[]};
      await saveCompanyToBackend({...ex, ...p.master, directors:p.directors, charges:p.charges,
        updatedAt:new Date().toISOString(), filingStatus:ex.filingStatus||{}, documents:ex.documents||[]});
      setShowUpload(false); setSelCin(p.master.cin); setScreen("company"); setTab("compliances");
      setToast({msg:`✅ MDS uploaded — ${p.master.companyName||p.master.cin} added/updated`, type:"success"});
    } catch(e) { setUploadErr("Failed: "+e.message); }
    setUploading(false);
  };

  const handlePDF = async (file, type) => {
    if (!file?.name.match(/\.pdf$/i)) { setUploadErr("Upload a valid .pdf file"); return; }
    setUploading(true); setUploadErr("");
    try {
      const txt = await extractPdfText(file);
      const p   = parseAnyPDF(txt, file.name);
      const resolvedType = type && type!=="auto" ? type : p.type;

      if (resolvedType === "unknown") {
        setUploadErr("Could not identify form type. Upload a valid MCA eForm PDF.");
        setUploading(false); return;
      }
      if (!p.cin && resolvedType==="aoc4") {
        setUploadErr("CIN not found in PDF. Ensure this is a text-based (not scanned) MCA eForm PDF.");
        setUploading(false); return;
      }

      const cin = p.cin || (db && Object.keys(db.companies||{}).find(c=>db.companies[c].companyName===p.companyName));
      const targetCin = cin || selCin;
      if (!targetCin) { setUploadErr("Cannot identify company. Upload an AOC-4 or MDS first."); setUploading(false); return; }

      const ex = (db?.companies||{})[targetCin] || {cin:targetCin, filingStatus:{}, documents:[], hasCharges:false, listedStatus:"Unlisted", companyStatus:"Active"};

      const docRecord = {
        type: resolvedType,
        form: {aoc4:"AOC-4", auditor_report:"Auditor Report (Standalone)", board_report:"Board Report Extract", aoc2:"AOC-2", mgt7:"MGT-7", mgt7a:"MGT-7A"}[resolvedType]||resolvedType,
        srn: p.srn||"", filingDate: p.filingDate||"",
        fyFrom: p.fyFrom||"", fyTo: p.fyTo||"",
        fileName: file.name, auditor: p.auditor||"",
        signInfo: p.signInfo||null,
        parsedAt: new Date().toISOString(),
        extra: resolvedType==="aoc4" ? {
          boardMeetingFS:p.boardMeetingFS, boardMeetingBR:p.boardMeetingBR,
          auditorSignDate:p.auditorSignDate, adtSRN:p.adtSRN,
          netLoss:p.lossForYear, netWorth:p.netWorthAbsolute,
          revenue:p.revenueAbsolute, epsBasic:p.epsBasic, directors:p.directors,
        } : resolvedType==="auditor_report" ? {
          opinion:p.auditOpinion, qualifications:p.qualificationsCount, caro:p.caroApplicable
        } : resolvedType==="board_report" ? {
          boardMeetings:p.boardMeetingsHeld, fraud:p.fraudReported, csr:p.csrApplicable
        } : resolvedType==="aoc2" ? {
          nonArm:p.nonArmLengthCount, arm:p.armLengthCount,
          rptName:p.relatedPartyName, rptAmount:p.relatedPartyAmount
        } : {},
      };

      let autoFiled = {};
      let intelligence = null;
      if (resolvedType === "aoc4") {
        intelligence = computeFilingIntelligence(p, ex, null, null);
        autoFiled = intelligence.autoUpdates || {};
        Object.assign(ex, {
          companyName: p.companyName||ex.companyName,
          lastAGM: p.lastAGM||ex.lastAGM,
          isSmallCompany: p.isSmallCompany||ex.isSmallCompany||"No",
          companyType: p.companyType||ex.companyType||"Private",
          ...(p.turnover?{turnover:p.turnover}:{}),
          ...(p.networth?{networth:p.networth}:{}),
          ...(p.paidUpCapital?{paidUpCapital:p.paidUpCapital}:{}),
          ...(p.authorisedCapital?{authorisedCapital:p.authorisedCapital}:{}),
          ...(p.directors?.length?{directors:p.directors}:{}),
        });
      } else if (resolvedType === "mgt7" || resolvedType === "mgt7a") {
        if (p.srn) {
          const mgtId = p.isSmallCompany==="Yes" ? "mgt7a" : "mgt7";
          autoFiled[mgtId] = {status:"filed", srn:p.srn, filedDate:p.filingDate, notes:"Auto-imported from MGT-7/7A PDF"};
        }
      }

      const newFilingStatus = {...(ex.filingStatus||{})};
      Object.entries(autoFiled).forEach(([ruleId, statusData]) => {
        newFilingStatus[ruleId] = {...(newFilingStatus[ruleId]||{}), ...statusData};
      });

      const updated = {
        ...ex, cin:targetCin,
        updatedAt: new Date().toISOString(),
        documents: [...(ex.documents||[]).filter(d => !(d.srn && d.srn===p.srn && d.type===resolvedType)), docRecord],
        filingStatus: newFilingStatus,
      };

      await saveCompanyToBackend(updated);

      if (intelligence) {
        setFilingIntelligence({cin:targetCin, intelligence, crossIssues:[], parsedDocs:[p]});
        setShowIntelPanel(true);
      }

      setShowUpload(false);
      setSelCin(targetCin);
      setScreen("company");
      setTab("compliances");
      setToast({msg:`✅ ${docRecord.form} uploaded successfully for ${p.companyName||targetCin}`, type:"success"});

    } catch(e) { setUploadErr("Failed: "+e.message); console.error(e); }
    setUploading(false);
  };

  const handleMultiPDF = async (files) => {
    if (!files?.length) return;
    setUploading(true); setUploadErr("");
    const parsedDocs = [];
    try {
      for (const file of files) {
        const txt = await extractPdfText(file);
        const p = parseAnyPDF(txt, file.name);
        parsedDocs.push(p);
      }

      const aoc4 = parsedDocs.find(d=>d.type==="aoc4");
      const targetCin = aoc4?.cin || selCin;
      if (!targetCin) { setUploadErr("Upload includes no AOC-4. Cannot identify company."); setUploading(false); return; }

      const ex = (db?.companies||{})[targetCin] || {cin:targetCin, filingStatus:{}, documents:[], hasCharges:false, listedStatus:"Unlisted", companyStatus:"Active"};
      const crossIssues = crossVerifyDocuments(parsedDocs);

      let autoFiled = {};
      let intelligence = null;
      if (aoc4) {
        const audRptDoc = parsedDocs.find(d => d.type === "auditor_report");
        const aoc2Doc   = parsedDocs.find(d => d.type === "aoc2");
        intelligence = computeFilingIntelligence(aoc4, ex, audRptDoc, aoc2Doc);
        autoFiled = intelligence.autoUpdates || {};
        Object.assign(ex, {
          companyName: aoc4.companyName||ex.companyName,
          lastAGM: aoc4.lastAGM||ex.lastAGM,
          isSmallCompany: aoc4.isSmallCompany||ex.isSmallCompany||"No",
          companyType: aoc4.companyType||ex.companyType||"Private",
          ...(aoc4.turnover?{turnover:aoc4.turnover}:{}),
          ...(aoc4.networth?{networth:aoc4.networth}:{}),
          ...(aoc4.paidUpCapital?{paidUpCapital:aoc4.paidUpCapital}:{}),
          ...(aoc4.directors?.length?{directors:aoc4.directors}:{}),
        });
      }

      const newDocs = [...(ex.documents||[])];
      parsedDocs.forEach(p => {
        const formLabel = {aoc4:"AOC-4",auditor_report:"Auditor Report (Standalone)",board_report:"Board Report Extract",aoc2:"AOC-2",mgt7:"MGT-7",mgt7a:"MGT-7A"}[p.type]||p.type;
        const rec = {
          type:p.type, form:formLabel, srn:p.srn||"", filingDate:p.filingDate||"",
          fyFrom:p.fyFrom||"", fyTo:p.fyTo||"", fileName:p.fileName,
          signInfo:p.signInfo, parsedAt:new Date().toISOString(),
          extra: p.type==="aoc4" ? {
            boardMeetingFS:p.boardMeetingFS, boardMeetingBR:p.boardMeetingBR,
            auditorSignDate:p.auditorSignDate, adtSRN:p.adtSRN,
            netLoss:p.netLossAbsolute, netWorth:p.netWorthAbsolute,
            revenue:p.revenueAbsolute, epsBasic:p.epsBasic, directors:p.directors,
            authorisedCapital:p.authorisedCapitalAbsolute, shareCapital:p.shareCapitalAbsolute,
            reserves:p.reservesAbsolute, ltBorrowings:p.ltBorrowingsAbsolute,
            tradePayables:p.tradePayablesAbsolute, cash:p.cashAbsolute,
            totalIncome:p.totalIncomeAbsolute, totalExpenses:p.totalExpensesAbsolute,
          } : p.type==="auditor_report" ? {
            opinion:p.auditOpinion, qualifications:p.qualificationsCount, caro:p.caroApplicable,
            emphasis:p.emphasisOfMatter, signerDIN:p.signerDIN, signerName:p.signerName,
            ifc:p.ifcApplicability, goingConcern:p.goingConcern,
          } : p.type==="board_report" ? {
            boardMeetings:p.boardMeetingsHeld, fraud:p.fraudReported,
            csr:p.csrApplicable, secretarialAudit:p.secretarialAuditApplicable,
            lossForYear:p.lossForYear, signerDIN:p.signerDIN,
          } : p.type==="aoc2" ? {
            nonArm:p.nonArmLengthCount, arm:p.armLengthCount,
            rptName:p.relatedPartyName, rptAmount:p.relatedPartyAmount,
            rptRelationship:p.relatedPartyRelationship,
            rptBoardDate:p.relatedPartyBoardApproval,
            rptBlocks:p.rptBlocks,
          } : {},
        };
        const idx = newDocs.findIndex(d=>d.type===p.type&&(p.srn?d.srn===p.srn:d.fileName===p.fileName));
        if (idx >= 0) newDocs[idx] = rec; else newDocs.push(rec);
      });

      const newFilingStatus = {...(ex.filingStatus||{})};
      Object.entries(autoFiled).forEach(([ruleId, statusData]) => {
        newFilingStatus[ruleId] = {...(newFilingStatus[ruleId]||{}), ...statusData};
      });

      const updated = {
        ...ex, cin:targetCin, updatedAt:new Date().toISOString(),
        documents:newDocs, filingStatus:newFilingStatus,
      };
      await saveCompanyToBackend(updated);
      setFilingIntelligence({cin:targetCin, intelligence, crossIssues, parsedDocs});
      setShowIntelPanel(true);
      saveDocumentAnalysis(targetCin, parsedDocs, intelligence, crossIssues);
      setShowUpload(false); setSelCin(targetCin); setScreen("company"); setTab("compliances");
    } catch(e) { setUploadErr("Failed: "+e.message); console.error(e); }
    setUploading(false);
  };

  const updateStatus = async (cin, rid, data, ay) => {
    try {
      // Save with AY-specific key
      const ayKey = ay ? `${rid}__${ay}` : rid;
      await updateFilingStatusAPI(cin, ayKey, data);
      // Also update the bare key for the 2 most recent AYs for backward compat
      const recentAYs = AY_OPTIONS.slice(-3).map(a=>a.value);
      if (!ay || recentAYs.includes(ay)) {
        await updateFilingStatusAPI(cin, rid, data);
      }
      setEditStatus(null);
      setToast({msg:`✅ Status updated for ${rid.toUpperCase().replace(/__.*$/,"")}`, type:"success"});
    }
    catch(e) { alert("Failed to update: "+e.message); }
  };

  const sendReminder = async (payload) => {
    const res = await fetchWithTimeout(`${API_BASE}/send-reminder`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload),
    }, 15000);
    if (!res.ok) throw new Error(`Send failed: ${res.status}`);
    return res.json();
  };

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (dataLoading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#f0f4f8",flexDirection:"column",gap:16,fontFamily:"Inter,sans-serif"}}>
      <LogoImg height={52}/>
      <div className="spin" style={{width:26,height:26,marginTop:8}}/>
      <span style={{color:"#64748b",fontSize:12,fontWeight:500,marginTop:4}}>{loadingMsg}</span>
      <span style={{color:"#94a3b8",fontSize:10,marginTop:-8}}>Tip: Backend on Render free tier sleeps after 15 min of inactivity</span>
    </div>
  );

  return (
    <div style={{fontFamily:"'Inter',sans-serif",minHeight:"100vh",background:"#f0f4f8",color:"#0d2d4a"}}>
      <style>{CSS}</style>

      {/* NAVBAR */}
      <div style={{background:"#fff",borderBottom:"1px solid #e2e8f0",padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 6px rgba(13,45,74,.07)",height:62}}>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <LogoImg height={40} onClick={()=>{setScreen("dash");setSelCin(null);setDashTab("overview");}}/>
          <div style={{width:1,height:28,background:"#e2e8f0",flexShrink:0}}/>
          {screen==="dash"?(
            <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".6px"}}>Dashboard</div>
          ):screen==="company"&&company&&(
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:10,color:"#94a3b8",cursor:"pointer",fontWeight:500}} onClick={()=>{setScreen("dash");setSelCin(null);}}>Dashboard</span>
              <span style={{color:"#cbd5e1",fontSize:13}}>›</span>
              <span style={{fontSize:11,color:"#1a5f8a",fontWeight:700,maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{company.companyName}</span>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:8,padding:"5px 10px"}}>
            <span style={{fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px"}}>AY</span>
            <select value={selAY} onChange={e=>setSelAY(e.target.value)}
              style={{border:"none",background:"transparent",color:"#1a5f8a",fontWeight:700,fontSize:11,cursor:"pointer",fontFamily:"inherit",outline:"none"}}>
              {AY_OPTIONS.map(a=><option key={a.value} value={a.value}>{a.label||a.value}</option>)}
            </select>
          </div>
          {globalUpcoming.length>0&&(
            <div style={{display:"flex",alignItems:"center",gap:5,background:"#fffbeb",border:"1px solid #fde68a",borderRadius:7,padding:"5px 11px",cursor:"pointer"}} onClick={()=>{setScreen("dash");setDashTab("overview");}}>
              <span className="pls" style={{color:"#d97706",fontSize:10}}>●</span>
              <span style={{fontSize:10,fontWeight:700,color:"#d97706"}}>{globalUpcoming.length} due in 90d</span>
            </div>
          )}
          <button className="btn pri" onClick={()=>{setShowUpload(true);setUploadMode("mds");setUploadErr("");}}>+ Add / Update Company</button>
        </div>
      </div>

      {/* Backend error banner */}
      {backendErr&&(
        <div style={{background:"#fef2f2",borderBottom:"1px solid #fecaca",padding:"9px 24px",fontSize:11,color:"#dc2626",textAlign:"center",fontWeight:500,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
          ⚠ Backend: {backendErr}
          <button className="btn red" style={{fontSize:10,padding:"3px 10px"}} onClick={fetchCompanies}>Retry</button>
        </div>
      )}

      {/* CONTENT */}
      <div style={{maxWidth:1160,margin:"0 auto",padding:"24px 16px"}}>

        {/* DASHBOARD */}
        {screen==="dash"&&(
          <div className="up">
            {/* Dashboard tabs */}
            <div style={{display:"flex",borderBottom:"1px solid #e2e8f0",marginBottom:16,background:"#fff",borderRadius:"10px 10px 0 0",paddingLeft:4,boxShadow:"0 1px 3px rgba(13,45,74,.05)"}}>
              {[["overview","📊 Overview"],["multiyear","📅 Multi-Year Data"]].map(([k,l])=>(
                <button key={k} className={`tab${dashTab===k?" on":""}`} onClick={()=>setDashTab(k)}>{l}</button>
              ))}
            </div>

            {/* Overview tab */}
            {dashTab==="overview"&&(
              <div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:22}}>
                  {[
                    ["Companies",       companies.length,                                                          "#1a5f8a","🏢"],
                    ["Applicable Rules",companies.reduce((a,c)=>a+(COMPLIANCE_RULES.filter(r=>r.applies(c)).length),0),"#0d7a70","📋"],
                    ["Overdue",         companies.reduce((a,c)=>a+(coStats[c.cin]?.overdue||0),0),                 "#dc2626","⚠️"],
                    ["Due in 30 Days",  globalUpcoming.filter(x=>x.n<=30).length,                                  "#d97706","📅"],
                  ].map(([l,v,col,ic])=>(
                    <div key={l} className="card" style={{padding:"16px 18px",borderTop:`3px solid ${col}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                        <div>
                          <div style={{fontSize:28,fontWeight:800,color:col,fontFamily:"IBM Plex Mono,monospace",lineHeight:1.1}}>{v}</div>
                          <div style={{fontSize:10,color:"#64748b",marginTop:5,fontWeight:600,textTransform:"uppercase",letterSpacing:".4px"}}>{l}</div>
                        </div>
                        <span style={{fontSize:22,opacity:.45}}>{ic}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:16,alignItems:"start"}}>
                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",marginBottom:10,letterSpacing:".5px",textTransform:"uppercase"}}>Companies ({companies.length})</div>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {companies.length===0?(
                        <div className="card" style={{padding:"52px 20px",textAlign:"center"}}>
                          <div style={{fontSize:40,marginBottom:12}}>📂</div>
                          <div style={{fontSize:14,fontWeight:700,color:"#334155",marginBottom:6}}>No companies yet</div>
                          <div style={{fontSize:11,color:"#94a3b8",marginBottom:18}}>Upload an MDS Excel or AOC-4 / MGT-7 PDF to get started</div>
                          <button className="btn pri" onClick={()=>setShowUpload(true)}>+ Add Company</button>
                        </div>
                      ):companies.map(co=>{
                        const st=coStats[co.cin]||{};
                        const pct=st.total?Math.round((st.filed/st.total)*100):0;
                        return (
                          <div key={co.cin} className="card" style={{padding:"14px 16px",cursor:"pointer"}} onClick={()=>{setSelCin(co.cin);setScreen("company");setTab("compliances");setFilterCat("All");setFilterSt("All");setSearch("");}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:12,fontWeight:700,marginBottom:5,color:"#0d2d4a",lineHeight:1.3}}>{co.companyName}</div>
                                <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
                                  <span className="mono bg" style={{background:"#eff6ff",color:"#1a5f8a",fontSize:9,border:"1px solid #bfdbfe"}}>{co.cin}</span>
                                  <span className="bg" style={{background:"#f1f5f9",color:"#64748b",border:"1px solid #e2e8f0"}}>{co.companyType}</span>
                                  {co.isSmallCompany==="Yes"&&<span className="bg" style={{background:"#f0fdfa",color:"#0d7a70",border:"1px solid #99f6e4"}}>Small Co.</span>}
                                  {co.companyStatus&&<span className="bg" style={{background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0"}}>{co.companyStatus}</span>}
                                </div>
                              </div>
                              <div style={{display:"flex",gap:6,flexShrink:0}}>
                                {st.overdue>0&&<div style={{textAlign:"center",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"6px 11px"}}><div style={{fontSize:16,fontWeight:800,color:"#dc2626",fontFamily:"IBM Plex Mono,monospace"}}>{st.overdue}</div><div style={{fontSize:8,color:"#dc2626",fontWeight:700,marginTop:1}}>OVERD</div></div>}
                                {st.up30>0&&<div style={{textAlign:"center",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"6px 11px"}}><div style={{fontSize:16,fontWeight:800,color:"#d97706",fontFamily:"IBM Plex Mono,monospace"}}>{st.up30}</div><div style={{fontSize:8,color:"#d97706",fontWeight:700,marginTop:1}}>30D</div></div>}
                                <div style={{textAlign:"center",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:8,padding:"6px 11px"}}><div style={{fontSize:16,fontWeight:800,color:"#1a5f8a",fontFamily:"IBM Plex Mono,monospace"}}>{st.total}</div><div style={{fontSize:8,color:"#1a5f8a",fontWeight:700,marginTop:1}}>TOTAL</div></div>
                              </div>
                            </div>
                            <div style={{marginTop:10,paddingTop:9,borderTop:"1px solid #f1f5f9"}}>
                              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#94a3b8",marginBottom:5}}>
                                <span>AGM: <span style={{color:"#475569",fontWeight:600}}>{co.lastAGM||"-"}</span></span>
                                <span style={{color:"#1a5f8a",fontWeight:700}}>{pct}% filed ({st.filed||0}/{st.total})</span>
                              </div>
                              <div style={{height:4,background:"#f1f5f9",borderRadius:4,overflow:"hidden"}}>
                                <div style={{height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#1a5f8a,#00b4a6)",borderRadius:4,transition:".5s ease"}}/>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div style={{fontSize:10,fontWeight:700,color:"#94a3b8",marginBottom:10,letterSpacing:".5px",textTransform:"uppercase"}}>Upcoming (90 Days) · AY {selAY}</div>
                    <div className="card" style={{overflow:"hidden"}}>
                      <div style={{padding:"11px 14px",background:"linear-gradient(135deg,#1a5f8a,#0d2d4a)"}}>
                        <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.95)"}}>Compliance Deadlines</div>
                        <div style={{fontSize:9,color:"rgba(255,255,255,.45)",marginTop:1}}>Next 90 days · unfiled only · AY {selAY}</div>
                      </div>
                      {globalUpcoming.length===0?(
                        <div style={{padding:"28px 16px",textAlign:"center",color:"#94a3b8",fontSize:11}}>
                          <div style={{fontSize:24,marginBottom:6}}>✅</div>No deadlines in next 90 days
                        </div>
                      ):globalUpcoming.slice(0,12).map((item,i)=>{
                        const u=urgency(item.n);
                        return (
                          <div key={i} className="row" style={{padding:"10px 14px",borderBottom:i<Math.min(globalUpcoming.length,12)-1?"1px solid #f1f5f9":"none",cursor:"pointer"}} onClick={()=>{setSelCin(item.cin);setScreen("company");setTab("compliances");}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
                              <div style={{minWidth:0,flex:1}}>
                                <div style={{fontSize:10,fontWeight:700,color:"#1a5f8a",marginBottom:1}}>{item.rule.form}</div>
                                <div style={{fontSize:9,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name.length>28?item.name.slice(0,28)+"...":item.name}</div>
                              </div>
                              <div style={{textAlign:"right",flexShrink:0}}>
                                <div style={{fontSize:9,fontWeight:700,color:u.col,background:u.bg,padding:"2px 7px",borderRadius:5,border:`1px solid ${u.col}25`}}>{u.label}</div>
                                <div style={{fontSize:9,color:"#94a3b8",marginTop:2}}>{fmt(item.date)}</div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {globalUpcoming.length>12&&<div style={{padding:"8px 14px",textAlign:"center",fontSize:9,color:"#94a3b8",borderTop:"1px solid #f1f5f9",background:"#f8fafc"}}>+{globalUpcoming.length-12} more</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Multi-Year Data tab */}
            {dashTab==="multiyear"&&(
              <MultiYearTab
                companies={companies}
                fetchCompanies={fetchCompanies}
                handlePDF={handlePDF}
              />
            )}
          </div>
        )}

        {/* COMPANY DETAIL */}
        {screen==="company"&&company&&(
          <div className="up">
            {/* Header */}
            <div className="card" style={{padding:"16px 20px",marginBottom:14,borderTop:"3px solid #00b4a6",background:"linear-gradient(135deg,#fff 60%,#f0fdfa)"}}>
              <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:10}}>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:"#00b4a6",letterSpacing:".7px",textTransform:"uppercase",marginBottom:5}}>Company Profile</div>
                  <div style={{fontSize:18,fontWeight:800,letterSpacing:"-.4px",color:"#0d2d4a"}}>{company.companyName}</div>
                  <div style={{fontSize:10,color:"#94a3b8",marginTop:3,fontFamily:"IBM Plex Mono,monospace"}}>{company.cin}</div>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                  {company.companyStatus&&<span className="bg" style={{background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0"}}>{company.companyStatus}</span>}
                  {company.isSmallCompany==="Yes"&&<span className="bg" style={{background:"#f0fdfa",color:"#0d7a70",border:"1px solid #99f6e4"}}>Small Co.</span>}
                  <span className="bg" style={{background:"#f1f5f9",color:"#64748b",border:"1px solid #e2e8f0"}}>{company.companyType}</span>
                  <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("mds");setUploadErr("");}}>↑ Update MDS</button>
                  <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("aoc4");setUploadErr("");}}>+ AOC-4</button>
                  <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("mgt7");setUploadErr("");}}>+ MGT-7</button>
                  <button className="btn teal" onClick={()=>exportReport(company, applicable, selAY, calcDue)}>⬇ Export Report</button>
                  {filingIntelligence?.cin===company.cin&&(
                    <button className="btn" style={{borderColor:"#bfdbfe",color:"#1a5f8a"}} onClick={()=>setShowIntelPanel(true)}>📊 Intel Report</button>
                  )}
                  <button className="btn red" onClick={()=>setDelConfirm(company.cin)}>Remove</button>
                </div>
              </div>
            </div>

            {/* Info chips */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8,marginBottom:14}}>
              {[
                ["Incorporation",   company.incorporationDate||"-"],
                ["Last AGM",        company.lastAGM||"-"],
                ["Balance Sheet",   company.balanceSheetDate||"-"],
                ["ROC",             company.rocName||"-"],
                ["Paid-up Capital", company.paidUpCapital?`₹${(+company.paidUpCapital).toFixed(2)} Cr`:"-"],
                ["Net Worth",       company.networth?`₹${(+company.networth*10000000).toLocaleString("en-IN")}`:"-"],
              ].map(([l,v])=>(
                <div key={l} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:9,padding:"9px 12px"}}>
                  <div style={{fontSize:8,color:"#94a3b8",fontWeight:700,textTransform:"uppercase",letterSpacing:".5px",marginBottom:3}}>{l}</div>
                  <div style={{fontSize:11,fontWeight:600,color:"#334155"}}>{v}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div style={{display:"flex",borderBottom:"1px solid #e2e8f0",marginBottom:14,overflowX:"auto",background:"#fff",borderRadius:"10px 10px 0 0",paddingLeft:4,boxShadow:"0 1px 3px rgba(13,45,74,.05)"}}>
              {[["compliances","Compliances"],["directors","Directors"],["documents","Documents"],["financials","Financials"]].map(([k,l])=>(
                <button key={k} className={`tab${tab===k?" on":""}`} onClick={()=>setTab(k)}>
                  {l}{k==="compliances"&&<span style={{fontSize:9,marginLeft:3,fontWeight:700,color:tab===k?"#00b4a6":"#cbd5e1"}}>({applicable.length})</span>}
                </button>
              ))}
            </div>

            {/* COMPLIANCES TAB */}
            {tab==="compliances"&&(
              <div>
                <AGMClusterBanner
                  company={company}
                  applicable={applicable}
                  onEdit={(ruleId, current)=>setEditStatus({cin:company.cin, id:ruleId, current})}
                />

                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14,alignItems:"center"}}>
                  <input className="inp" style={{maxWidth:200,padding:"6px 10px",fontSize:10}} placeholder="Search forms..." value={search} onChange={e=>setSearch(e.target.value)}/>
                  <select className="inp" style={{width:"auto",padding:"6px 10px",fontSize:10}} value={filterSt} onChange={e=>setFilterSt(e.target.value)}>
                    <option value="All">All Status</option><option value="pending">Pending</option><option value="filed">Filed</option><option value="na">N/A</option>
                  </select>
                  <select className="inp" style={{width:"auto",padding:"6px 10px",fontSize:10}} value={filterCat} onChange={e=>setFilterCat(e.target.value)}>
                    <option value="All">All Categories</option>
                    {[...new Set(applicable.map(r=>r.cat))].map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                  <div style={{marginLeft:"auto",fontSize:10,color:"#64748b",fontWeight:600}}>
                    <span style={{color:"#1a5f8a",fontWeight:800}}>{applicable.filter(r=>(getAYStatus(company,r.id,selAY)?.status||"pending")==="filed").length}</span> / {applicable.length} filed
                    <span style={{color:"#94a3b8",marginLeft:8}}>· AY {selAY}</span>
                  </div>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))",gap:10}}>
                  {filtered.map(rule=>{
                    const col=CAT_COL[rule.cat]||{bg:"#f1f5f9",bd:"#e2e8f0",txt:"#64748b"};
                    const st=getAYStatus(company,rule.id,selAY)||{status:"pending"};
                    const hasNoData=!company.filingStatus?.[`${rule.id}__${selAY}`]&&!company.filingStatus?.[rule.id];
                    const {upcoming:u}=calcDue(rule, company);
                    const n=u?daysLeft(u.date):null;
                    const urg=urgency(n);
                    const isCluster=AGM_CLUSTER_IDS.includes(rule.id);
                    return (
                      <div key={rule.id} className="card" style={{padding:"14px 16px",position:"relative",borderLeft:`3px solid ${isCluster?"#f59e0b":col.txt+"50"}`}}>
                        {isCluster&&(
                          <div style={{position:"absolute",top:0,right:0,background:"#fde68a",color:"#92400e",fontSize:7,fontWeight:700,padding:"2px 7px",borderRadius:"0 12px 0 6px",letterSpacing:".5px"}}>AGM CLUSTER</div>
                        )}
                        <div style={{position:"absolute",top:12,right:12,display:"flex",gap:4}}>
                          {st.status==="filed"&&<span className="bg" style={{background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0"}}>✓ Filed</span>}
                          {st.status==="na"&&<span className="bg" style={{background:"#f1f5f9",color:"#94a3b8",border:"1px solid #e2e8f0"}}>N/A</span>}
                          {st.status==="pending"&&n!==null&&<span className="bg" style={{background:urg.bg,color:urg.col,border:`1px solid ${urg.col}30`}}>{urg.label}</span>}
                        </div>
                        <div style={{paddingRight:90}}>
                          <div style={{display:"flex",gap:5,alignItems:"center",marginBottom:4}}>
                            <span style={{fontWeight:800,fontSize:11,color:col.txt,fontFamily:"IBM Plex Mono,monospace"}}>{rule.form}</span>
                            <span className="bg" style={{background:col.bg,color:col.txt,border:`1px solid ${col.bd}`,fontSize:9}}>{rule.cat}</span>
                          </div>
                          <div style={{fontWeight:600,fontSize:11,marginBottom:9,color:"#334155",lineHeight:1.4}}>{rule.title}</div>
                        </div>
                        <div style={{height:1,background:"#f1f5f9",marginBottom:9}}/>
                        {hasNoData&&st.status==="pending"&&(
                          <div style={{background:"#f8fafc",border:"1px dashed #cbd5e1",borderRadius:6,padding:"5px 9px",marginBottom:7,display:"flex",alignItems:"center",gap:6,fontSize:9,color:"#94a3b8"}}>
                            <span style={{fontSize:11}}>📂</span>
                            <span>No filing data added for <strong style={{color:"#64748b"}}>AY {selAY}</strong> — click "Update Status" to add</span>
                          </div>
                        )}
                        <div style={{display:"flex",flexDirection:"column",gap:5,fontSize:10}}>
                          {u&&<div style={{display:"flex",gap:7}}><span style={{color:"#94a3b8",minWidth:52,fontWeight:700,textTransform:"uppercase",fontSize:8,letterSpacing:".4px",paddingTop:1}}>Next Due</span><span style={{color:"#334155",fontWeight:500}}>{fmt(u.date)} <span style={{color:"#94a3b8",fontSize:9}}>({u.label})</span></span></div>}
                          {st.status==="filed"&&<div style={{display:"flex",gap:7}}><span style={{color:"#94a3b8",minWidth:52,fontWeight:700,textTransform:"uppercase",fontSize:8,letterSpacing:".4px"}}>Filed</span><span style={{color:"#16a34a",fontWeight:600}}>{st.filedDate||"-"} {st.srn&&<span className="mono" style={{color:"#0d7a70",fontSize:9}}>{st.srn}</span>}</span></div>}
                          {st.notes&&<div style={{fontSize:9,color:"#94a3b8",fontStyle:"italic",marginTop:1}}>"{st.notes}"</div>}
                          <div style={{display:"flex",gap:7}}><span style={{color:"#94a3b8",minWidth:52,fontWeight:700,textTransform:"uppercase",fontSize:8,letterSpacing:".4px"}}>Law</span><span style={{color:"#94a3b8",fontSize:9}}>{rule.section}</span></div>
                        </div>
                        <div style={{marginTop:10}}>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            <button className="btn" style={{fontSize:10,padding:"4px 10px"}} onClick={()=>setEditStatus({cin:company.cin,id:rule.id,ay:selAY,current:st})}>
                              {st.status==="filed"?"Edit Status":"Update Status"}
                            </button>
                            {st.status!=="filed"&&st.status!=="na"&&(
                              <button className="btn" style={{fontSize:10,padding:"4px 10px",borderColor:"#bfdbfe",color:"#1a5f8a"}}
                                onClick={()=>setReminderModal({company, rule, dueDate:u?fmt(u.date):"-", daysLeft:n})}>
                                🔔 Remind
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {filtered.length===0&&(
                  <div style={{textAlign:"center",padding:"44px",color:"#94a3b8",background:"#fff",borderRadius:12,border:"1px solid #e2e8f0"}}>
                    <div style={{fontSize:28,marginBottom:8}}>🔎</div>
                    <div style={{fontSize:12,fontWeight:600}}>No compliances match filters</div>
                  </div>
                )}
              </div>
            )}

            {/* DIRECTORS TAB */}
            {tab==="directors"&&(
              <div>
                {!(company.directors||[]).length?(
                  <div style={{textAlign:"center",padding:"44px",color:"#94a3b8",fontSize:11,background:"#fff",borderRadius:12,border:"1px solid #e2e8f0"}}>
                    No directors data — upload MDS Excel or MGT-7 PDF to populate
                  </div>
                ):(
                  <div className="card" style={{overflow:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                      <thead>
                        <tr style={{background:"#f8fafc",borderBottom:"2px solid #e2e8f0"}}>
                          {["#","DIN/PAN","Name","Designation","Category","Appointed","Cessation"].map(h=>(
                            <th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:9,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(company.directors||[]).map((d,i)=>(
                          <tr key={i} className="row" style={{borderBottom:i<company.directors.length-1?"1px solid #f1f5f9":"none"}}>
                            <td style={{padding:"10px 14px",color:"#94a3b8",fontSize:10}}>{i+1}</td>
                            <td style={{padding:"10px 14px",fontFamily:"IBM Plex Mono,monospace",fontSize:10,color:"#1a5f8a",fontWeight:600}}>{d["DIN/PAN"]||"-"}</td>
                            <td style={{padding:"10px 14px",fontWeight:600,color:"#0d2d4a"}}>{d["Name"]||"-"}</td>
                            <td style={{padding:"10px 14px",color:"#64748b"}}>{d["Designation"]||"-"}</td>
                            <td style={{padding:"10px 14px",color:"#94a3b8"}}>{d["Category"]||"-"}</td>
                            <td style={{padding:"10px 14px",color:"#64748b",whiteSpace:"nowrap"}}>{d["Date of Appointment"]||"-"}</td>
                            <td style={{padding:"10px 14px",color:(d["Cessation Date"]&&d["Cessation Date"]!=="-")?"#dc2626":"#94a3b8"}}>{d["Cessation Date"]||"-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* DOCUMENTS TAB */}
            {tab==="documents"&&(
              <div>
                <div style={{display:"flex",gap:6,justifyContent:"flex-end",marginBottom:12}}>
                  <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("aoc4");setUploadErr("");}}>+ AOC-4 PDF</button>
                  <button className="btn" onClick={()=>{setShowUpload(true);setUploadMode("mgt7");setUploadErr("");}}>+ MGT-7 PDF</button>
                </div>
                {!(company.documents||[]).length?(
                  <div style={{textAlign:"center",padding:"44px",color:"#94a3b8",fontSize:11,background:"#fff",borderRadius:12,border:"1px solid #e2e8f0"}}>No documents uploaded yet</div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {(company.documents||[]).map((doc,i)=>{
                      const si=doc.signInfo;
                      const signStatus=si?.signStatus||(si?.isSignedCopy?"signed":si?.isDraft?"draft":"unknown");
                      const signBg=signStatus==="signed"?"#f0fdf4":signStatus==="draft"?"#fef2f2":"#fffbeb";
                      const signBd=signStatus==="signed"?"#bbf7d0":signStatus==="draft"?"#fecaca":"#fde68a";
                      const signCol=signStatus==="signed"?"#16a34a":signStatus==="draft"?"#dc2626":"#d97706";
                      const signLbl=signStatus==="signed"?"✓ Signed MCA copy":signStatus==="draft"?"✗ Unsigned/Draft":"? Unverified";
                      return (
                        <div key={i} className="card" style={{padding:"13px 16px"}}>
                          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
                            <div style={{display:"flex",gap:12,alignItems:"flex-start",flex:1,minWidth:0}}>
                              <div style={{width:38,height:38,borderRadius:9,background:doc.type==="aoc4"?"#eff6ff":doc.type==="auditor_report"?"#f0fdf4":doc.type==="aoc2"?"#fdf4ff":"#f0fdfa",border:`1px solid ${doc.type==="aoc4"?"#bfdbfe":doc.type==="auditor_report"?"#bbf7d0":doc.type==="aoc2"?"#e9d5ff":"#99f6e4"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                                {doc.type==="aoc4"?"📊":doc.type==="auditor_report"?"🔍":doc.type==="aoc2"?"🤝":"📋"}
                              </div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:11,fontWeight:700,color:"#1a5f8a"}}>{doc.form||doc.type.toUpperCase()} <span className="mono" style={{fontSize:10,color:"#94a3b8",fontWeight:400}}>{doc.srn}</span></div>
                                <div style={{fontSize:10,color:"#94a3b8",marginTop:2,wordBreak:"break-word"}}>{doc.fileName} · FY {doc.fyFrom?.slice(6)||"-"} – {doc.fyTo?.slice(6)||"-"}</div>
                                {doc.type==="auditor_report"&&doc.extra&&(
                                  <div style={{marginTop:5,display:"flex",gap:5,flexWrap:"wrap"}}>
                                    <span className="bg" style={{background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",fontSize:9}}>{doc.extra.opinion||"Opinion N/A"}</span>
                                    <span className="bg" style={{background:"#eff6ff",color:"#1a5f8a",border:"1px solid #bfdbfe",fontSize:9}}>CARO: {doc.extra.caro||"N/A"}</span>
                                    {doc.extra.qualifications===0&&<span className="bg" style={{background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",fontSize:9}}>No qualifications</span>}
                                  </div>
                                )}
                                {doc.type==="aoc2"&&doc.extra&&(
                                  <div style={{marginTop:5,display:"flex",gap:5,flexWrap:"wrap"}}>
                                    <span className="bg" style={{background:"#fdf4ff",color:"#7c3aed",border:"1px solid #e9d5ff",fontSize:9}}>Arm's length: {doc.extra.arm||0}</span>
                                    {doc.extra.rptName&&<span className="bg" style={{background:"#f8fafc",color:"#64748b",border:"1px solid #e2e8f0",fontSize:9}}>{doc.extra.rptName}</span>}
                                    {doc.extra.rptAmount>0&&<span className="bg" style={{background:"#f8fafc",color:"#334155",border:"1px solid #e2e8f0",fontSize:9}}>₹{doc.extra.rptAmount.toLocaleString()}</span>}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end",flexShrink:0}}>
                              <span style={{fontSize:9,fontWeight:700,color:signCol,background:signBg,border:`1px solid ${signBd}`,padding:"2px 8px",borderRadius:5,whiteSpace:"nowrap"}}>{signLbl}</span>
                              {doc.filingDate&&<span className="bg" style={{background:"#f0fdf4",color:"#16a34a",border:"1px solid #bbf7d0",fontSize:9}}>Filed: {doc.filingDate}</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* FINANCIALS TAB */}
            {tab==="financials"&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div className="card" style={{padding:"15px 18px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#1a5f8a",marginBottom:12,paddingBottom:8,borderBottom:"2px solid #eff6ff"}}>Capital Structure</div>
                  {[
                    ["Authorised Capital", company.authorisedCapital?(+company.authorisedCapital*10000000).toLocaleString("en-IN"):"-"],
                    ["Paid-up Capital",    company.paidUpCapital?(+company.paidUpCapital*10000000).toLocaleString("en-IN"):"-"],
                    ["Net Worth",          company.networth?(+company.networth*10000000).toLocaleString("en-IN"):"-"],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}>
                      <span style={{fontSize:10,color:"#64748b"}}>{l}</span>
                      <span style={{fontSize:11,fontWeight:700,fontFamily:"IBM Plex Mono,monospace",color:"#0d2d4a"}}>₹{v}</span>
                    </div>
                  ))}
                </div>
                <div className="card" style={{padding:"15px 18px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#0d7a70",marginBottom:12,paddingBottom:8,borderBottom:"2px solid #f0fdfa"}}>P&L Summary</div>
                  {[
                    ["Turnover",        company.turnover?(+company.turnover*10000000).toLocaleString("en-IN"):"-"],
                    ["Net Profit/Loss", company.netProfit?(+company.netProfit*10000000).toLocaleString("en-IN"):"-"],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}>
                      <span style={{fontSize:10,color:"#64748b"}}>{l}</span>
                      <span style={{fontSize:11,fontWeight:700,fontFamily:"IBM Plex Mono,monospace",color:"#0d2d4a"}}>₹{v}</span>
                    </div>
                  ))}
                </div>
                <div className="card" style={{padding:"15px 18px",gridColumn:"1/-1"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"#d97706",marginBottom:12,paddingBottom:8,borderBottom:"2px solid #fffbeb"}}>Manual Entry — Financial Data</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:10}}>
                    {[["turnover","Turnover (₹ Cr)"],["networth","Net Worth (₹ Cr)"],["netProfit","Net Profit (₹ Cr)"]].map(([k,l])=>(
                      <div key={k}>
                        <label style={{fontSize:8,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".5px",display:"block",marginBottom:4}}>{l}</label>
                        <input className="inp" type="number" step="0.0001" placeholder="0.0000" value={company[k]||""} onChange={async e=>{
                          const updated={...company,[k]:e.target.value};
                          try { await saveCompanyToBackend(updated); } catch { alert("Save failed"); }
                        }}/>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:9,color:"#94a3b8",marginBottom:10}}>Enter in Crore (₹ Cr). These values determine applicability of CSR and XBRL filings.</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(215px,1fr))",gap:6}}>
                    {[
                      ["PaidUp ≥ ₹500 Cr → XBRL",  +company.paidUpCapital>=500],
                      ["Turnover ≥ ₹500 Cr → XBRL", +company.turnover>=500],
                      ["NW ≥ ₹500 Cr → CSR",         +company.networth>=500],
                      ["Turnover ≥ ₹1000 Cr → CSR",  +company.turnover>=1000],
                      ["Net Profit ≥ ₹5 Cr → CSR",   +company.netProfit>=5],
                    ].map(([l,v])=>(
                      <div key={l} style={{fontSize:9,color:v?"#dc2626":"#16a34a",background:v?"#fef2f2":"#f0fdf4",padding:"5px 9px",borderRadius:5,border:`1px solid ${v?"#fecaca":"#bbf7d0"}`,fontWeight:600}}>
                        {v?"⚠ ":"✓ "}{l}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODALS */}
      {showUpload&&(
        <UploadModal mode={uploadMode} setMode={setUploadMode} onMds={handleMDS} onPdf={handlePDF}
          onMulti={handleMultiPDF} loading={uploading} err={uploadErr} onClose={()=>!uploading&&setShowUpload(false)}/>
      )}

      {editStatus&&(()=>{
        const rule = COMPLIANCE_RULES.find(r=>r.id===editStatus.id);
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(13,45,74,.55)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(4px)"}} onClick={e=>e.target===e.currentTarget&&setEditStatus(null)}>
            <div style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:14,padding:"22px",width:"100%",maxWidth:440,boxShadow:"0 24px 64px rgba(13,45,74,.18)"}} className="up">
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                <div style={{width:34,height:34,borderRadius:8,background:"linear-gradient(135deg,#1a5f8a,#00b4a6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>📋</div>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:"#0d2d4a"}}>{rule?.form}</div>
                  <div style={{fontSize:9,color:"#94a3b8"}}>{rule?.title}</div>
                </div>
                <button className="btn" style={{marginLeft:"auto",padding:"4px 10px"}} onClick={()=>setEditStatus(null)}>✕</button>
              </div>
              <EditForm
                init={editStatus.current}
                rule={rule}
                onSave={d=>updateStatus(editStatus.cin,editStatus.id,d,editStatus.ay||selAY)}
                onCancel={()=>setEditStatus(null)}
                onPdfUpload={async (file,parsed)=>{ await handlePDF(file, parsed.type); }}
              />
            </div>
          </div>
        );
      })()}

      {reminderModal&&(
        <ReminderModal
          company={reminderModal.company}
          rule={reminderModal.rule}
          dueDate={reminderModal.dueDate}
          daysLeft={reminderModal.daysLeft}
          onClose={()=>setReminderModal(null)}
          onSend={sendReminder}
        />
      )}

      {showIntelPanel&&filingIntelligence&&(
        <FilingIntelligencePanel
          data={filingIntelligence}
          company={company||db.companies[filingIntelligence.cin]}
          onClose={()=>setShowIntelPanel(false)}
        />
      )}

      {toast&&<Toast msg={toast.msg} type={toast.type} onClose={()=>setToast(null)}/>}

      {delConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(13,45,74,.55)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(4px)"}} onClick={e=>e.target===e.currentTarget&&setDelConfirm(null)}>
          <div style={{background:"#fff",border:"1px solid #fecaca",borderRadius:14,padding:"28px",width:"100%",maxWidth:360,textAlign:"center",boxShadow:"0 24px 64px rgba(13,45,74,.18)"}} className="up">
            <div style={{width:52,height:52,borderRadius:14,background:"#fef2f2",border:"1px solid #fecaca",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,margin:"0 auto 14px"}}>⚠️</div>
            <div style={{fontSize:15,fontWeight:700,marginBottom:6,color:"#0d2d4a"}}>Remove Company?</div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:22,lineHeight:1.6}}>
              All data for <strong style={{color:"#0d2d4a"}}>{db?.companies[delConfirm]?.companyName}</strong> will be permanently removed.
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"center"}}>
              <button className="btn" style={{padding:"8px 20px"}} onClick={()=>setDelConfirm(null)}>Cancel</button>
              <button className="btn red" style={{padding:"8px 20px"}} onClick={()=>deleteCompany(delConfirm)}>Yes, Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
