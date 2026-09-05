import { useEffect, useRef, useState } from "react";
import { desktopApi, type StoreRecord } from "../lib/desktopApi";
import { downloadShopifyTheme, listShopifyThemes, themeErrorMessage, type ShopifyTheme, type ThemeExportProgress } from "../lib/themeExport";
import "./ThemeDownloadCard.css";

interface Props { store: StoreRecord | null; onHistoryChanged: () => void; }
const roles: Record<string, string> = { MAIN: "Active", UNPUBLISHED: "Draft", DEVELOPMENT: "Development", DEMO: "Trial" };
const roleLabel = (role: string) => roles[role] || role;
const dateLabel = (value: string) => new Date(value).toLocaleString();
const sizeLabel = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`;

export default function ThemeDownloadCard({ store, onHistoryChanged }: Props) {
  const [themes, setThemes] = useState<ShopifyTheme[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<ThemeExportProgress | null>(null);
  const [refresh, setRefresh] = useState(0);
  const downloadController = useRef<AbortController | null>(null);
  const selected = themes.find(theme => theme.id === selectedId);
  const storeId = store?.id;
  const tokenPresent = store?.tokenPresent;

  useEffect(() => {
    const controller = new AbortController();
    setThemes([]); setSelectedId(""); setError(""); setMessage(""); setProgress(null);
    if (!storeId || !tokenPresent) return () => controller.abort();
    setLoading(true);
    void listShopifyThemes(storeId, controller.signal)
      .then(result => { if (!controller.signal.aborted) setThemes(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(themeErrorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [storeId, tokenPresent, refresh]);

  useEffect(() => () => { downloadController.current?.abort(); }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function download() {
    if (!store || !selected || busy || downloadController.current) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setBusy(true); setMessage(""); setError(""); setProgress(null);
    try {
      const result = await downloadShopifyTheme(store, selected, setProgress, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.path) { setMessage("Theme ZIP save was cancelled."); return; }
      setMessage(`Theme ZIP ready: ${result.path} · ${result.fileCount} files (${sizeLabel(result.bytes)}).`);
      // A history failure must not misreport a successfully downloaded archive.
      try {
        await desktopApi.saveHistory({
          storeId: store.id, kind: "theme-export", name: `Theme ZIP: ${selected.name}`,
          status: "COMPLETED", total: result.fileCount, processed: result.fileCount,
          createdCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0,
          detailsJson: JSON.stringify({ themeId: selected.id, themeName: selected.name, role: selected.role, bytes: result.bytes }),
          filePath: result.path,
        });
        if (!controller.signal.aborted) onHistoryChanged();
      } catch {
        if (!controller.signal.aborted) setMessage(`Theme ZIP ready: ${result.path} · ${result.fileCount} files. Activity history could not be updated.`);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(themeErrorMessage(reason));
    } finally {
      if (downloadController.current === controller) {
        downloadController.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  function cancel() {
    downloadController.current?.abort();
    downloadController.current = null;
    setBusy(false); setProgress(null); setMessage("Theme download cancelled. No ZIP was saved.");
  }
  const phaseLabel = progress?.phase === "listing" ? "Reading selected theme files…"
    : progress?.phase === "verifying" ? "Checking that all theme files are complete…"
    : progress?.phase === "saving" ? "Preparing theme ZIP…"
    : `Downloading ${progress?.completed || 0} / ${progress?.total || 0} files`;
  const percent = progress?.total ? Math.round(progress.completed / progress.total * 100) : 0;

  return <article className="page-card theme-download-card" aria-busy={busy || loading}>
    <header>
      <div className="theme-download-heading">
        <span className="theme-download-icon" aria-hidden="true"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="14" rx="2"/><path d="M3 8h18M8 5.5h.01M5.5 5.5h.01M12 11v10m-4-4 4 4 4-4"/></svg></span>
        <div><h3>Download Shopify theme</h3><p>Choose one theme and download its files as a Shopify theme ZIP.</p></div>
      </div>
      <span className="status-pill status-success">THEME ZIP</span>
    </header>
    <div className="page-card-body theme-download-body">
      {!store ? <div className="notice">Select a Shopify store to download a theme.</div>
        : !store.tokenPresent ? <div className="notice notice-warning">Add this store's access token in Stores before loading themes.</div>
        : <>
          <div className="theme-download-store"><strong>{store.name}</strong><span>{store.domain}</span></div>
          <div className="theme-download-controls">
            <div className="field">
              <label htmlFor="theme-download-select">Theme to download</label>
              <select id="theme-download-select" value={selectedId} disabled={loading || busy || !themes.length} onChange={event => { setSelectedId(event.target.value); setMessage(""); setError(""); setProgress(null); }}>
                <option value="">{loading ? "Loading themes…" : "Choose a theme…"}</option>
                {themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name} · {roleLabel(theme.role)} · #{theme.id.split("/").pop()}</option>)}
              </select>
              <small>Only the selected theme is included in the ZIP.</small>
            </div>
            <button className="button-secondary" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>{loading ? "Loading…" : "Refresh themes"}</button>
          </div>
          {selected && <div className="theme-download-selection">
            <div><strong>{selected.name}</strong><span className={`status-pill ${selected.role === "MAIN" ? "status-success" : ""}`}>{roleLabel(selected.role)}</span></div>
            <p>Theme ID: {selected.id.split("/").pop()} <span>·</span> Last updated: {dateLabel(selected.updatedAt)}</p>
          </div>}
          {selected && (selected.processing || selected.processingFailed) && <div className="notice notice-warning">This theme is not ready. Check its status in Shopify and refresh after processing is complete.</div>}
          {!loading && !error && !themes.length && <div className="notice">No themes were returned for this store.</div>}
          <div className="theme-download-includes"><strong>Included</strong><p>Liquid files, templates, sections, blocks, snippets, CSS, JavaScript, theme assets, language files, and theme settings.</p><small>Product data, orders, app data, and media stored outside the theme are separate from a theme ZIP.</small></div>
          {busy && progress && <div className="theme-download-progress" role="status" aria-live="polite">
            <div><strong>{phaseLabel}</strong><span>{sizeLabel(progress.bytes)}</span></div>
            <progress max={100} value={percent} aria-label="Theme file download progress" />
            <small>{progress.filename || "Keep this page open until the download is ready."}</small>
          </div>}
          {message && <div className="notice notice-success" role="status">{message}</div>}
          {error && <div className="notice notice-error" role="alert">{error}</div>}
          <div className="form-actions">
            {busy && <button className="button-secondary" disabled={progress?.phase === "saving"} onClick={cancel}>Cancel download</button>}
            <button className="button-primary" disabled={busy || loading || !selected || selected.processing || selected.processingFailed} onClick={() => void download()}>{busy ? "Preparing theme ZIP…" : "Download Selected Theme ZIP"}</button>
          </div>
        </>}
    </div>
  </article>;
}
