import { useEffect, useState } from "react";
import { desktopApi, type SaveStoreInput, type StoreRecord } from "../lib/desktopApi";
import "./common.css";

interface StoresPageProps {
  stores: StoreRecord[];
  onStoresChanged: () => Promise<void> | void;
}

const EMPTY_FORM: SaveStoreInput = {
  name: "",
  website: "",
  domain: "",
  apiVersion: "2026-04",
  accessToken: "",
  setActive: false,
};

export default function StoresPage({ stores, onStoresChanged }: StoresPageProps) {
  const [form, setForm] = useState<SaveStoreInput>(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (stores.length === 0 && !editing) {
      setForm({
        ...EMPTY_FORM,
        name: "Hausone",
        website: "https://hausone.de",
        domain: "87b099-3.myshopify.com",
        apiVersion: "2026-04",
        setActive: true,
      });
    }
  }, [stores.length, editing]);

  function editStore(store: StoreRecord) {
    setEditing(store.id);
    setForm({
      id: store.id,
      name: store.name,
      website: store.website,
      domain: store.domain,
      apiVersion: store.apiVersion,
      accessToken: "",
      setActive: store.isActive,
    });
    setMessage("");
    setError("");
    setTestResult(null);
  }

  function resetForm() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMessage("");
    setError("");
    setTestResult(null);
  }

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const saved = await desktopApi.saveStore(form);
      setMessage(`${saved.name} was saved. The access token is stored in the operating system credential vault.`);
      await onStoresChanged();
      editStore(saved);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function test(storeId: string) {
    setBusy(true);
    setMessage("");
    setError("");
    setTestResult(null);
    try {
      const result = await desktopApi.testStore(storeId);
      setTestResult(result);
      const shop = (result.data as { shop?: { name?: string } } | undefined)?.shop;
      setMessage(`Connection succeeded${shop?.name ? `: ${shop.name}` : ""}.`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function activate(storeId: string) {
    setBusy(true);
    setError("");
    try {
      await desktopApi.setActiveStore(storeId);
      await onStoresChanged();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function remove(store: StoreRecord) {
    if (!window.confirm(`Delete ${store.name} from this computer? Shopify data will not be deleted.`)) return;
    setBusy(true);
    setError("");
    try {
      await desktopApi.deleteStore(store.id);
      if (editing === store.id) resetForm();
      await onStoresChanged();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-hero">
        <div>
          <span className="eyebrow">MULTI-STORE MANAGEMENT</span>
          <h2>Connect and manage multiple Shopify stores</h2>
          <p>Each store has its own secure access token, API version, settings, history, inventory location, and active workspace.</p>
        </div>
        <aside><small>CONNECTED STORES</small><strong>{stores.length}</strong></aside>
      </section>

      {message && <div className="notice notice-success">✓ {message}</div>}
      {error && <div className="notice notice-error">! {error}</div>}

      <section className="page-card">
        <header>
          <div><h3>{editing ? "Edit store" : "Add a store"}</h3><p>Tokens are never written into the project source or export files.</p></div>
          {editing && <button className="button-secondary" type="button" onClick={resetForm}>New Store</button>}
        </header>
        <div className="page-card-body">
          <div className="form-grid">
            <div className="field"><label>Store name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Hausone" /></div>
            <div className="field"><label>Public website</label><input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://hausone.de" /></div>
            <div className="field"><label>Shopify domain</label><input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="store.myshopify.com" /></div>
            <div className="field"><label>Default Admin API version</label><input value={form.apiVersion} onChange={(e) => setForm({ ...form, apiVersion: e.target.value })} placeholder="2026-04" /><small>Product operations use this version. Hybrid collection operations automatically use Shopify Admin API 2026-07.</small></div>
            <div className="field field-wide">
              <label>Admin API access token</label>
              <input type="password" autoComplete="new-password" value={form.accessToken ?? ""} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} placeholder={editing ? "Leave blank to keep the saved token" : "shpat_..."} />
              <small>The token is stored in Windows Credential Manager or macOS Keychain. Because the token shared in chat is exposed, rotate it in Shopify after the connection is verified.</small>
            </div>
            <label className="checkbox-row field-wide"><input type="checkbox" checked={Boolean(form.setActive)} onChange={(e) => setForm({ ...form, setActive: e.target.checked })} /><span><strong>Set as active store</strong><small>Product and collection operations use the active store by default.</small></span></label>
          </div>
          <div className="form-actions">
            <button className="button-primary" type="button" disabled={busy || !form.name.trim() || !form.domain.trim()} onClick={() => void save()}>{busy ? "Saving..." : editing ? "Save Changes" : "Add Store"}</button>
          </div>
        </div>
      </section>

      <section className="page-card">
        <header><div><h3>Saved stores</h3><p>Switch the active store without restarting the application.</p></div></header>
        {stores.length === 0 ? <div className="empty-state"><strong>No stores connected</strong><p>Add the first store above. Hausone fields are prefilled, but the token must be entered securely.</p></div> : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Store</th><th>Domain</th><th>API</th><th>Token</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{stores.map((store) => (
                <tr key={store.id}>
                  <td><strong>{store.name}</strong><br/><small>{store.website || "No public website"}</small></td>
                  <td className="monospace">{store.domain}</td><td>{store.apiVersion}</td>
                  <td><span className={`status-pill ${store.tokenPresent ? "status-success" : "status-error"}`}>{store.tokenPresent ? "Securely saved" : "Missing"}</span></td>
                  <td><span className={`status-pill ${store.isActive ? "status-success" : ""}`}>{store.isActive ? "Active" : "Inactive"}</span></td>
                  <td><div className="toolbar-group">
                    {!store.isActive && <button className="button-text" disabled={busy} onClick={() => void activate(store.id)}>Activate</button>}
                    <button className="button-text" disabled={busy} onClick={() => editStore(store)}>Edit</button>
                    <button className="button-text" disabled={busy || !store.tokenPresent} onClick={() => void test(store.id)}>Test</button>
                    <button className="button-text" disabled={busy} onClick={() => void remove(store)}>Delete</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {testResult && <section className="page-card"><header><div><h3>Connection response</h3><p>Live Shopify Admin API data.</p></div></header><div className="page-card-body"><pre className="monospace" style={{whiteSpace:"pre-wrap",fontSize:11}}>{JSON.stringify(testResult, null, 2)}</pre></div></section>}
    </div>
  );
}
