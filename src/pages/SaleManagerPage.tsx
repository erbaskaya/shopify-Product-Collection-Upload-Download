import { useEffect, useMemo, useState } from "react";
import type { StoreRecord } from "../lib/desktopApi";
import { desktopApi } from "../lib/desktopApi";
import { createAdminClient } from "../lib/shopifyClient";
import {
  applySalePlan,
  buildSalePlan,
  listSaleCollections,
  listSaleVendors,
  searchSaleProducts,
  type SaleCollectionRef,
  type SaleFilterMode,
  type SaleOperation,
  type SaleProductRef,
  type SaleVariantRow,
} from "../lib/admin-tools/sale-manager";
import "./SaleManagerPage.css";

interface Props { stores: StoreRecord[] }
interface ProgressState { storeName: string; current: number; total: number; message: string }

export default function SaleManagerPage({ stores }: Props) {
  const connectedStores = useMemo(()=>stores.filter(s=>s.tokenPresent),[stores]);
  const [referenceStoreId,setReferenceStoreId]=useState("");
  const [targetStoreIds,setTargetStoreIds]=useState<string[]>([]);
  const [filterMode,setFilterMode]=useState<SaleFilterMode>("collection");
  const [operation,setOperation]=useState<SaleOperation>("apply");
  const [discountPercent,setDiscountPercent]=useState(20);
  const [testMode,setTestMode]=useState(true);
  const [collections,setCollections]=useState<SaleCollectionRef[]>([]);
  const [vendors,setVendors]=useState<string[]>([]);
  const [collectionHandle,setCollectionHandle]=useState("");
  const [vendor,setVendor]=useState("");
  const [searchTerm,setSearchTerm]=useState("");
  const [searchResults,setSearchResults]=useState<SaleProductRef[]>([]);
  const [selectedProducts,setSelectedProducts]=useState<SaleProductRef[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [logs,setLogs]=useState<string[]>([]);
  const [progress,setProgress]=useState<ProgressState>({storeName:"",current:0,total:0,message:""});

  useEffect(()=>{
    if (!referenceStoreId && connectedStores[0]) setReferenceStoreId(connectedStores[0].id);
    if (!targetStoreIds.length && connectedStores.length) setTargetStoreIds(connectedStores.map(s=>s.id));
  },[connectedStores,referenceStoreId,targetStoreIds.length]);

  const referenceStore = connectedStores.find(s=>s.id===referenceStoreId)||connectedStores[0]||null;

  async function loadReferenceOptions(){
    if(!referenceStore)return;
    setBusy(true);setError("");
    try{
      const admin=createAdminClient(referenceStore.id,referenceStore.apiVersion);
      const [cs,vs]=await Promise.all([listSaleCollections(admin),listSaleVendors(admin)]);
      setCollections(cs);setVendors(vs);
      if(!collectionHandle&&cs[0])setCollectionHandle(cs[0].handle);
      if(!vendor&&vs[0])setVendor(vs[0]);
      setMessage(`Loaded ${cs.length} collections and ${vs.length} vendors from ${referenceStore.name}.`);
    }catch(e){setError(String(e))}finally{setBusy(false)}
  }

  async function searchProducts(){
    if(!referenceStore)return;
    setBusy(true);setError("");
    try{setSearchResults(await searchSaleProducts(createAdminClient(referenceStore.id,referenceStore.apiVersion),searchTerm));}
    catch(e){setError(String(e))}finally{setBusy(false)}
  }

  function toggleTarget(id:string){setTargetStoreIds(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id])}
  function toggleProduct(p:SaleProductRef){setSelectedProducts(v=>v.some(x=>x.handle===p.handle)?v.filter(x=>x.handle!==p.handle):[...v,p])}
  function addLog(text:string){setLogs(v=>[...v.slice(-499),`[${new Date().toLocaleTimeString()}] ${text}`])}

  async function run(){
    const targets=connectedStores.filter(s=>targetStoreIds.includes(s.id));
    if(!targets.length)return setError("Select at least one target store.");
    if(filterMode==="collection"&&!collectionHandle)return setError("Select a collection.");
    if(filterMode==="vendor"&&!vendor)return setError("Select a vendor.");
    if(filterMode==="products"&&!selectedProducts.length)return setError("Select at least one product.");
    if(operation==="apply"&&(discountPercent<=0||discountPercent>=100))return setError("Discount percentage must be between 0 and 100.");
    setBusy(true);setError("");setMessage("");setLogs([]);setProgress({storeName:"",current:0,total:0,message:""});
    let totalUpdated=0,totalSkipped=0,totalFailed=0,totalProducts=0;
    try{
      for(const store of targets){
        addLog(`${store.name}: building Sale plan...`);
        const admin=createAdminClient(store.id,store.apiVersion);
        const rows=await buildSalePlan(admin,{
          operation,discountPercent,filterMode,collectionHandle,vendor,
          productHandles:selectedProducts.map(p=>p.handle),minimumInventory:10,
        });
        const productCount=new Set(rows.map(r=>r.productId)).size;
        totalProducts+=productCount;
        const eligible=rows.filter(r=>r.eligible);
        const skipped=rows.length-eligible.length;
        addLog(`${store.name}: ${productCount} products · ${eligible.length} eligible variants · ${skipped} skipped variants.`);
        if(testMode){
          let current=0;
          const groups=groupRows(rows);
          for(const group of groups){
            current+=1;
            const ok=group.filter(r=>r.eligible).length;
            const reason=group.find(r=>!r.eligible)?.reason||"";
            setProgress({storeName:store.name,current,total:groups.length,message:group[0]?.productTitle||""});
            addLog(`${store.name} · ${current}/${groups.length} · TEST · ${group[0]?.productTitle||""} · ${ok?`${ok} variant(s) would change`:`SKIP ${reason}`}`);
          }
          totalSkipped+=skipped;
        }else{
          const result=await applySalePlan(admin,rows,(current,total,title,status)=>{
            setProgress({storeName:store.name,current,total,message:title});
            addLog(`${store.name} · ${current}/${total} · ${title} · ${status}`);
          });
          totalUpdated+=result.updated;totalSkipped+=result.skipped;totalFailed+=result.failed;
          if(result.errors.length)result.errors.slice(0,20).forEach(x=>addLog(`ERROR · ${x}`));
          await desktopApi.saveHistory({
            storeId:store.id,kind:operation==="apply"?"sale_apply":"sale_remove",name:`Sale Manager · ${operation}`,
            status:result.failed?"COMPLETED_WITH_ERRORS":"COMPLETED",total:rows.length,processed:rows.length,
            createdCount:0,updatedCount:result.updated,skippedCount:result.skipped,failedCount:result.failed,
            detailsJson:JSON.stringify({filterMode,collectionHandle,vendor,productHandles:selectedProducts.map(p=>p.handle),discountPercent}),
          });
        }
      }
      setMessage(testMode
        ? `TEST completed. ${totalProducts} products were evaluated. No Shopify prices were changed.`
        : `Completed. Updated variants: ${totalUpdated} · Skipped: ${totalSkipped} · Failed: ${totalFailed}`);
    }catch(e){setError(String(e));addLog(`ERROR · ${String(e)}`)}finally{setBusy(false)}
  }

  const pct=progress.total?Math.round(progress.current/progress.total*100):0;
  return <div className="page-stack sale-page">
    <section className="page-hero"><div><span className="eyebrow">CATALOG · SALE PRICING</span><h2>Sale Manager</h2><p>Moves the current price to Compare-at Price and calculates the discounted Price. Shopify Smart Collections can then include discounted products automatically.</p></div><aside><small>STOCK RULE</small><strong>Only stock &gt; 10</strong></aside></section>
    {error&&<div className="error-box">{error}</div>}{message&&<div className="success-box">{message}</div>}
    <div className="sale-grid">
      <section className="page-card"><header><div><h3>Reference store & product lookup</h3><p>Collections, vendors and product search come from this store.</p></div></header><div className="page-card-body sale-compact"><div className="tool-field"><label>Reference store</label><select value={referenceStoreId} onChange={e=>setReferenceStoreId(e.target.value)}>{connectedStores.map(s=><option key={s.id} value={s.id}>{s.name} · {s.domain}</option>)}</select></div><div className="tool-actions"><button className="button-secondary" disabled={busy||!referenceStore} onClick={()=>void loadReferenceOptions()}>Load / refresh lists</button></div></div></section>
      <section className="page-card"><header><div><h3>Target stores</h3><p>Price changes run independently in every selected store.</p></div></header><div className="page-card-body sale-store-list">{connectedStores.map(s=><label className="sale-store-check" key={s.id}><input type="checkbox" checked={targetStoreIds.includes(s.id)} onChange={()=>toggleTarget(s.id)}/><span><strong>{s.name}</strong><small>{s.domain}</small></span></label>)}</div></section>
      <section className="page-card"><header><div><h3>Product selection</h3><p>Filter by collection, vendor/brand or selected products.</p></div></header><div className="page-card-body sale-compact"><div className="tool-field"><label>Selection method</label><select value={filterMode} onChange={e=>setFilterMode(e.target.value as SaleFilterMode)}><option value="collection">Collection</option><option value="vendor">Vendor / brand</option><option value="products">Select products</option></select></div>{filterMode==="collection"&&<div className="tool-field"><label>Collection</label><select value={collectionHandle} onChange={e=>setCollectionHandle(e.target.value)}><option value="">Select collection</option>{collections.map(c=><option key={c.id} value={c.handle}>{c.title}</option>)}</select></div>}{filterMode==="vendor"&&<div className="tool-field"><label>Vendor / brand</label><select value={vendor} onChange={e=>setVendor(e.target.value)}><option value="">Select vendor</option>{vendors.map(v=><option key={v} value={v}>{v}</option>)}</select></div>}{filterMode==="products"&&<><div className="sale-search-row"><div className="tool-field"><label>Product search</label><input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Title, handle or SKU"/></div><button className="button-secondary" disabled={busy||!referenceStore} onClick={()=>void searchProducts()}>Search</button></div>{searchResults.length>0&&<div className="sale-results">{searchResults.map(p=><label key={p.id}><input type="checkbox" checked={selectedProducts.some(x=>x.handle===p.handle)} onChange={()=>toggleProduct(p)}/><span><strong>{p.title}</strong><small>{p.vendor} · {p.handle}</small></span></label>)}</div>}<small className="sale-selected">Selected products: {selectedProducts.length}</small></>}</div></section>
      <section className="page-card"><header><div><h3>Operation & percentage</h3><p>Apply a Sale price or restore the Compare-at Price back to Price.</p></div></header><div className="page-card-body sale-compact"><div className="tool-field"><label>Operation</label><select value={operation} onChange={e=>setOperation(e.target.value as SaleOperation)}><option value="apply">Apply Sale discount</option><option value="remove">Remove Sale discount</option></select></div>{operation==="apply"&&<div className="tool-field"><label>Discount percentage</label><input type="number" min="1" max="99" step="1" value={discountPercent} onChange={e=>setDiscountPercent(Number(e.target.value))}/><small>Example: €100 → Price €80 / Compare-at €100 for 20%.</small></div>}<label className="sale-test"><input type="checkbox" checked={testMode} onChange={e=>setTestMode(e.target.checked)}/><span><strong>Test mode first</strong><small>No prices are written to Shopify.</small></span></label><div className="notice notice-warning">When applying a Sale discount, variants with stock 0–10 are skipped. Only stock 11+ is discounted. Removing Sale ignores the stock rule so prices can always be restored.</div><div className="tool-actions"><button className="button-primary" disabled={busy||!connectedStores.length} onClick={()=>void run()}>{busy?"Working...":"Start operation"}</button></div></div></section>
    </div>
    {(busy||logs.length>0)&&<section className="page-card"><header><div><h3>Operation progress</h3><p>{progress.storeName?`${progress.storeName} · ${progress.current} / ${progress.total} products · ${pct}%`:"Waiting..."}</p></div><strong className="sale-progress-count">{progress.current}/{progress.total}</strong></header><div className="page-card-body"><div className="progress-bar"><span style={{width:`${pct}%`}}/></div><div className="sale-current">{progress.message}</div><div className="sale-log">{logs.map((l,i)=><div key={`${i}-${l}`}>{l}</div>)}</div></div></section>}
  </div>
}

function groupRows(rows:SaleVariantRow[]){const m=new Map<string,SaleVariantRow[]>();for(const r of rows){const a=m.get(r.productId)||[];a.push(r);m.set(r.productId,a)}return Array.from(m.values())}
