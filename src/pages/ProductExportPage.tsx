import { useState } from "react";
import { createAdminClient } from "../lib/shopifyClient";
import { desktopApi, type StoreRecord } from "../lib/desktopApi";
import type { AppSettings } from "../lib/appSettings";
import { startExport, exportStatus, downloadExport, type ExportFormat, type ExportOperation } from "../lib/product-export/productExport";
import { saveResponse } from "../lib/fileSave";
import "./common.css";

interface Props { activeStore: StoreRecord | null; settings: AppSettings; onHistoryChanged: () => void; }
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

export default function ProductExportPage({activeStore,settings,onHistoryChanged}:Props){
  const [statusFilter,setStatusFilter]=useState("all"); const [query,setQuery]=useState("");
  const [format,setFormat]=useState<ExportFormat>(settings.export.defaultFormat);
  const [operation,setOperation]=useState<ExportOperation|null>(null); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [message,setMessage]=useState("");
  async function run(){if(!activeStore){setError("Select an active store first.");return;}setBusy(true);setError("");setMessage("");
    let history=await desktopApi.saveHistory({storeId:activeStore.id,kind:"product-export",name:`products-export-${new Date().toISOString().slice(0,10)}`,status:"RUNNING",total:0,processed:0,createdCount:0,updatedCount:0,skippedCount:0,failedCount:0,detailsJson:JSON.stringify({statusFilter,query,format})});
    try{const admin=createAdminClient(activeStore.id);let op=await startExport(admin,statusFilter,query);setOperation(op);
      while(!["COMPLETED","FAILED","CANCELED","EXPIRED"].includes(op.status)){await sleep(1800);op=await exportStatus(admin,op.id);setOperation(op);}
      if(op.status!=="COMPLETED")throw new Error(`Export ended with ${op.status}${op.errorCode?`: ${op.errorCode}`:""}.`);
      const delimiter=settings.export.csvDelimiter==="semicolon"?";":settings.export.csvDelimiter==="tab"?"\t":",";
      const response=await downloadExport(admin,op.id,format,activeStore.domain,{delimiter,includeBom:settings.export.csvEncoding==="utf8-bom"});
      const path=await saveResponse(response,`products-export.${format}`);
      history=await desktopApi.saveHistory({id:history.id,storeId:activeStore.id,kind:"product-export",name:`products-export-${new Date().toISOString().slice(0,10)}`,status:"COMPLETED",total:Number(op.rootObjectCount||0),processed:Number(op.rootObjectCount||0),createdCount:0,updatedCount:0,skippedCount:0,failedCount:0,filePath:path||"",detailsJson:JSON.stringify({statusFilter,query,format,operation:op})});
      setMessage(path?`Export saved to ${path}`:"Export completed. File saving was cancelled.");onHistoryChanged();
    }catch(reason){await desktopApi.saveHistory({id:history.id,storeId:activeStore.id,kind:"product-export",name:history.name,status:"FAILED",total:Number(operation?.rootObjectCount||0),processed:0,createdCount:0,updatedCount:0,skippedCount:0,failedCount:1,detailsJson:JSON.stringify({error:String(reason)})});setError(String(reason));onHistoryChanged();}finally{setBusy(false);}}
  return <div className="page-stack">
    <section className="page-hero"><div><span className="eyebrow">PRODUCT EXPORT</span><h2>Export complete Shopify product data</h2><p>Products, variants, inventory, images, SEO, and metafields are prepared with Shopify Bulk Operations.</p></div><aside><small>ACTIVE STORE</small><strong>{activeStore?.name||"No store"}</strong><span>{activeStore?.domain}</span></aside></section>
    {message&&<div className="notice notice-success">✓ {message}</div>}{error&&<div className="notice notice-error">! {error}</div>}
    <section className="page-card"><header><div><h3>Export options</h3><p>Use a Shopify search query to narrow the result.</p></div></header><div className="page-card-body"><div className="form-grid">
      <div className="field"><label>Product status</label><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="archived">Archived</option></select></div>
      <div className="field"><label>File format</label><select value={format} onChange={e=>setFormat(e.target.value as ExportFormat)}><option value="csv">CSV</option><option value="xlsx">XLSX</option><option value="json">JSON</option></select></div>
      <div className="field field-wide"><label>Shopify search query</label><input value={query} onChange={e=>setQuery(e.target.value)} placeholder='vendor:"Hausone" OR tag:featured' /><small>Leave blank to export every product in the selected status.</small></div>
    </div><div className="form-actions"><button className="button-primary" disabled={busy||!activeStore} onClick={()=>void run()}>{busy?"Preparing export...":"Start Product Export"}</button></div></div></section>
    {operation&&<section className="page-card"><header><div><h3>Bulk operation</h3><p>{operation.id}</p></div><span className={`status-pill ${operation.status==="COMPLETED"?"status-success":operation.status==="FAILED"?"status-error":"status-running"}`}>{operation.status}</span></header><div className="page-card-body"><div className="stats-row"><div className="mini-stat"><span>Root products</span><strong>{operation.rootObjectCount}</strong></div><div className="mini-stat"><span>Total objects</span><strong>{operation.objectCount}</strong></div><div className="mini-stat"><span>File size</span><strong>{operation.fileSize||"—"}</strong></div><div className="mini-stat"><span>Error</span><strong>{operation.errorCode||"0"}</strong></div></div></div></section>}
  </div>;
}
