import { createStoredZip, parseZip, type BrowserZipEntry } from "./browserZip";
import type { DiagnosticsResult, HistoryInput, HistoryRecord, SaveStoreInput, StoreRecord } from "./desktopApi";

async function bridge<T>(action: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/bridge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
    signal,
  });
  const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` })) as {ok?:boolean;result?:T;error?:string};
  if (!response.ok || !data.ok) {
    if (response.status === 401 && data.error === "AUTH_REQUIRED") window.dispatchEvent(new Event("shopify-tools-auth-required"));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data.result as T;
}

function downloadBytes(defaultName: string, bytes: Uint8Array, type = "application/octet-stream"): string {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = defaultName; anchor.style.display = "none";
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return defaultName;
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text); let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input"); input.type = "file"; input.accept = accept; input.style.display = "none";
    let settled = false;
    const finish = (file: File | null) => { if (settled) return; settled = true; input.remove(); window.removeEventListener("focus", onFocus); resolve(file); };
    const onFocus = () => setTimeout(() => { if (!input.files?.length) finish(null); }, 500);
    input.addEventListener("change", () => finish(input.files?.[0] || null), { once: true });
    window.addEventListener("focus", onFocus, { once: true }); document.body.appendChild(input); input.click();
  });
}

export const webAuthApi = {
  status: () => bridge<{configured:boolean;loggedIn:boolean}>("auth_status"),
  login: (password: string) => bridge<{loggedIn:boolean}>("login", { password }),
  logout: () => bridge<void>("logout"),
};

export const webApi = {
  themeFileChunk: (storeId: string, themeId: string, filename: string, offset: number, checksumMd5: string | null, signal?: AbortSignal) =>
    bridge<{base64Data:string;offset:number;nextOffset:number;totalSize:number;sourceSize:number;contentSha256:string|null;checksumMd5:string|null}>("theme_file_chunk", { storeId, themeId, filename, offset, checksumMd5 }, signal),
  listStores: () => bridge<StoreRecord[]>("list_stores"),
  saveStore: (input: SaveStoreInput) => bridge<StoreRecord>("save_store", { input }),
  setActiveStore: (storeId: string) => bridge<void>("set_active_store", { storeId }),
  deleteStore: (storeId: string) => bridge<void>("delete_store", { storeId }),
  testStore: (storeId: string) => bridge<Record<string, unknown>>("test_store", { storeId }),
  graphql: (storeId: string, query: string, variables: Record<string, unknown> = {}, apiVersion?: string) => bridge<Record<string, unknown>>("graphql", { storeId, query, variables, apiVersion: apiVersion || null }),
  httpGetText: async (url: string) => {
    try { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`); return await response.text(); }
    catch { return bridge<string>("http_get_text", { url }); }
  },
  httpGetBinary: async (url: string) => {
    try { const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`); const bytes = new Uint8Array(await response.arrayBuffer()); let binary=""; const chunk=0x8000; for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk)); return btoa(binary); }
    catch { return bridge<string>("http_get_binary", { url }); }
  },
  httpPutBinary: async (url: string, contentType: string, base64Data: string) => {
    const bytes = base64ToBytes(base64Data);
    try { const response = await fetch(url,{method:"PUT",headers:{"Content-Type":contentType},body:bytes}); if(!response.ok)throw new Error(`HTTP ${response.status}`); }
    catch { await bridge<void>("http_put_binary", { url, contentType, base64Data }); }
  },
  httpPostMultipart: async (url: string, parameters: Array<{name:string;value:string}>, fileName: string, contentType: string, base64Data: string) => {
    try { const form=new FormData(); for(const parameter of parameters)form.append(parameter.name,parameter.value); form.append("file",new Blob([base64ToBytes(base64Data)],{type:contentType}),fileName); const response=await fetch(url,{method:"POST",body:form}); if(!response.ok)throw new Error(`HTTP ${response.status}`); }
    catch { await bridge<void>("http_post_multipart", { url, parameters, fileName, contentType, base64Data }); }
  },
  saveZipEntries: async (defaultName: string, entries: BrowserZipEntry[]) => downloadBytes(defaultName, createStoredZip(entries), "application/zip"),
  pickZipEntries: async () => { const file = await pickFile(".zip,application/zip"); return file ? parseZip(new Uint8Array(await file.arrayBuffer())) : []; },
  getSettings: (storeId: string) => bridge<Record<string, unknown>>("get_settings", { storeId }),
  saveSettings: (storeId: string, values: Record<string, unknown>) => bridge<void>("save_settings", { storeId, values }),
  listHistory: (storeId?: string, limit = 100) => bridge<HistoryRecord[]>("list_history", { storeId: storeId || null, limit }),
  saveHistory: (input: HistoryInput) => bridge<HistoryRecord>("save_history", { input }),
  deleteHistory: (historyId: string) => bridge<void>("delete_history", { historyId }),
  clearHistory: (storeId?: string) => bridge<number>("clear_history", { storeId: storeId || null }),
  saveTextFile: async (defaultName: string, content: string) => downloadBytes(defaultName, new TextEncoder().encode(content), "text/plain;charset=utf-8"),
  saveBinaryFile: async (defaultName: string, base64Data: string) => downloadBytes(defaultName, base64ToBytes(base64Data)),
  createBackup: async () => {
    const backup = await bridge<Record<string, unknown>>("backup_export");
    const name = `shopify-web-backup-${new Date().toISOString().slice(0,10)}.zip`;
    const entries = [{name:"backup.json",base64Data:textToBase64(JSON.stringify(backup,null,2))}];
    return downloadBytes(name, createStoredZip(entries), "application/zip");
  },
  restoreBackup: async () => {
    const file = await pickFile(".zip,application/zip"); if (!file) return { cancelled: true } as Record<string, unknown>;
    const entries = await parseZip(new Uint8Array(await file.arrayBuffer()));
    const backupEntry = entries.find((x) => x.name === "backup.json"); if (!backupEntry) throw new Error("backup.json was not found in the archive.");
    const text = new TextDecoder().decode(base64ToBytes(backupEntry.base64Data));
    return bridge<Record<string, unknown>>("backup_import", { backup: JSON.parse(text) });
  },
  diagnostics: () => bridge<DiagnosticsResult>("diagnostics"),
};
