import { useEffect, useState } from "react";
import type { AppSettings } from "../lib/appSettings";
import { desktopApi, type StoreRecord } from "../lib/desktopApi";
import "./common.css";

interface SettingsPageProps {
  activeStore: StoreRecord | null;
  settings: AppSettings;
  onSettingsChanged: (settings: AppSettings) => void;
}

export default function SettingsPage({ activeStore, settings, onSettingsChanged }: SettingsPageProps) {
  const [draft, setDraft] = useState(settings);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(settings), [settings, activeStore?.id]);

  async function save() {
    if (!activeStore) return;
    setBusy(true); setMessage(""); setError("");
    try {
      await desktopApi.saveSettings(activeStore.id, draft as unknown as Record<string, unknown>);
      onSettingsChanged(draft);
      setMessage("Store settings were saved.");
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  if (!activeStore) return <div className="notice notice-warning">Add and activate a store before editing settings.</div>;

  return <div className="page-stack">
    <section className="page-hero"><div><span className="eyebrow">STORE DEFAULTS</span><h2>Settings for {activeStore.name}</h2><p>Every connected store keeps its own import, collection, export, and history preferences.</p></div><aside><small>ACTIVE STORE</small><strong>{activeStore.domain}</strong></aside></section>
    {message && <div className="notice notice-success">✓ {message}</div>}{error && <div className="notice notice-error">! {error}</div>}

    <section className="page-card"><header><div><h3>Product import</h3><p>Defaults used by the desktop product workflow.</p></div></header><div className="page-card-body"><div className="form-grid">
      <div className="field"><label>Import mode</label><select value={draft.product.importMode} onChange={e=>setDraft({...draft,product:{...draft.product,importMode:e.target.value as AppSettings["product"]["importMode"]}})}><option value="upsert">Create or update</option><option value="create_only">Create only</option><option value="update_only">Update only</option></select></div>
      <div className="field"><label>Match method</label><select value={draft.product.matchMethod} onChange={e=>setDraft({...draft,product:{...draft.product,matchMethod:e.target.value as AppSettings["product"]["matchMethod"]}})}><option value="handle_then_sku">Handle, then SKU</option><option value="handle">Handle only</option><option value="sku">SKU only</option></select></div>
      <div className="field"><label>Product status</label><select value={draft.product.productStatus} onChange={e=>setDraft({...draft,product:{...draft.product,productStatus:e.target.value as AppSettings["product"]["productStatus"]}})}><option value="from_file">From file</option><option value="active">Active</option><option value="draft">Draft</option></select></div>
      <div className="field"><label>Inventory mode</label><select value={draft.product.inventoryMode} onChange={e=>setDraft({...draft,product:{...draft.product,inventoryMode:e.target.value as AppSettings["product"]["inventoryMode"]}})}><option value="from_file">From file</option><option value="default_quantity">Fixed quantity</option><option value="skip">Do not update inventory</option></select></div>
      <div className="field"><label>Batch size</label><input type="number" min="1" max="25" value={draft.product.batchSize} onChange={e=>setDraft({...draft,product:{...draft.product,batchSize:Number(e.target.value)}})} /></div>
      <div className="field"><label>Default quantity</label><input type="number" min="0" value={draft.product.defaultQuantity} onChange={e=>setDraft({...draft,product:{...draft.product,defaultQuantity:Number(e.target.value)}})} /></div>
      <label className="checkbox-row"><input type="checkbox" checked={draft.product.preserveExistingMedia} onChange={e=>setDraft({...draft,product:{...draft.product,preserveExistingMedia:e.target.checked}})} /><span><strong>Preserve existing media</strong><small>Do not remove current Shopify media on updates.</small></span></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.product.createMetafieldDefinitions} onChange={e=>setDraft({...draft,product:{...draft.product,createMetafieldDefinitions:e.target.checked}})} /><span><strong>Create metafield definitions</strong><small>Create missing definitions before import.</small></span></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.product.continueOnError} onChange={e=>setDraft({...draft,product:{...draft.product,continueOnError:e.target.checked}})} /><span><strong>Continue after errors</strong></span></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.product.requireTest} onChange={e=>setDraft({...draft,product:{...draft.product,requireTest:e.target.checked}})} /><span><strong>Require safe test import</strong></span></label>
    </div></div></section>

    <section className="page-card"><header><div><h3>Collection import</h3><p>Shopify hybrid collection source behavior.</p></div></header><div className="page-card-body"><div className="form-grid">
      <div className="field"><label>Import mode</label><select value={draft.collection.mode} onChange={e=>setDraft({...draft,collection:{...draft.collection,mode:e.target.value as AppSettings["collection"]["mode"]}})}><option value="upsert">Create or update</option><option value="create-only">Create only</option><option value="update-only">Update only</option></select></div>
      <div className="field"><label>Batch size</label><input type="number" min="1" max="25" value={draft.collection.batchSize} onChange={e=>setDraft({...draft,collection:{...draft.collection,batchSize:Number(e.target.value)}})} /></div>
      <div className="field"><label>Broken image policy</label><select value={draft.collection.imageFailurePolicy} onChange={e=>setDraft({...draft,collection:{...draft.collection,imageFailurePolicy:e.target.value as AppSettings["collection"]["imageFailurePolicy"]}})}><option value="skip-image">Skip image and continue</option><option value="fail">Fail collection</option></select></div>
      <div className="field"><label>Source update</label><select value={draft.collection.replaceSources ? "replace" : "append"} onChange={e=>setDraft({...draft,collection:{...draft.collection,replaceSources:e.target.value==="replace"}})}><option value="replace">Replace sources</option><option value="append">Append sources</option></select></div>
      <label className="checkbox-row"><input type="checkbox" checked={draft.collection.includeImage} onChange={e=>setDraft({...draft,collection:{...draft.collection,includeImage:e.target.checked}})} /><span><strong>Import collection images</strong></span></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.collection.includeMetafields} onChange={e=>setDraft({...draft,collection:{...draft.collection,includeMetafields:e.target.checked}})} /><span><strong>Import collection metafields</strong></span></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.collection.continueOnError} onChange={e=>setDraft({...draft,collection:{...draft.collection,continueOnError:e.target.checked}})} /><span><strong>Continue after errors</strong></span></label>
      <label className="checkbox-row"><input type="checkbox" checked={draft.collection.requireTest} onChange={e=>setDraft({...draft,collection:{...draft.collection,requireTest:e.target.checked}})} /><span><strong>Require safe test import</strong></span></label>
    </div></div></section>

    <section className="page-card"><header><div><h3>Export and history</h3></div></header><div className="page-card-body"><div className="form-grid">
      <div className="field"><label>Default export format</label><select value={draft.export.defaultFormat} onChange={e=>setDraft({...draft,export:{...draft.export,defaultFormat:e.target.value as AppSettings["export"]["defaultFormat"]}})}><option value="csv">CSV</option><option value="xlsx">XLSX</option><option value="json">JSON</option></select></div>
      <div className="field"><label>CSV delimiter</label><select value={draft.export.csvDelimiter} onChange={e=>setDraft({...draft,export:{...draft.export,csvDelimiter:e.target.value as AppSettings["export"]["csvDelimiter"]}})}><option value="comma">Comma</option><option value="semicolon">Semicolon</option><option value="tab">TAB</option></select></div>
      <div className="field"><label>CSV encoding</label><select value={draft.export.csvEncoding} onChange={e=>setDraft({...draft,export:{...draft.export,csvEncoding:e.target.value as AppSettings["export"]["csvEncoding"]}})}><option value="utf8-bom">UTF-8 BOM</option><option value="utf8">UTF-8</option></select></div>
      <div className="field"><label>History retention days</label><input type="number" min="0" value={draft.historyRetentionDays} onChange={e=>setDraft({...draft,historyRetentionDays:Number(e.target.value)})} /><small>0 disables automatic retention cleanup.</small></div>
    </div><div className="form-actions"><button className="button-primary" disabled={busy} onClick={()=>void save()}>{busy?"Saving...":"Save Settings"}</button></div></div></section>
  </div>;
}
