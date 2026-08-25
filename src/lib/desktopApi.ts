import { invoke } from "@tauri-apps/api/core";
import { webApi } from "./webApi";

export interface StoreRecord {
  id: string;
  name: string;
  website: string;
  domain: string;
  apiVersion: string;
  isActive: boolean;
  tokenPresent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaveStoreInput {
  id?: string;
  name: string;
  website: string;
  domain: string;
  apiVersion: string;
  accessToken?: string;
  setActive?: boolean;
}

export interface HistoryRecord {
  id: string;
  storeId: string;
  kind: string;
  name: string;
  status: string;
  total: number;
  processed: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  detailsJson: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryInput {
  id?: string;
  storeId: string;
  kind: string;
  name: string;
  status: string;
  total: number;
  processed: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  detailsJson?: string;
  filePath?: string;
}

export interface DiagnosticsResult {
  appVersion: string;
  osName: string;
  osVersion: string;
  architecture: string;
  appDataPath: string;
  databasePath: string;
  databaseSize: number;
  storeCount: number;
  historyCount: number;
  databaseOk: boolean;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

const tauriApi = {
  listStores: () => invoke<StoreRecord[]>("list_stores"),
  saveStore: (input: SaveStoreInput) => invoke<StoreRecord>("save_store", { input }),
  setActiveStore: (storeId: string) => invoke<void>("set_active_store", { storeId }),
  deleteStore: (storeId: string) => invoke<void>("delete_store", { storeId }),
  testStore: (storeId: string) => invoke<Record<string, unknown>>("test_store_connection", { storeId }),
  graphql: (storeId: string, query: string, variables: Record<string, unknown> = {}, apiVersion?: string) =>
    invoke<Record<string, unknown>>("shopify_graphql", { storeId, query, variables, apiVersion: apiVersion || null }),
  httpGetText: (url: string) => invoke<string>("http_get_text", { url }),
  httpGetBinary: (url: string) => invoke<string>("http_get_binary", { url }),
  httpPutBinary: (url: string, contentType: string, base64Data: string) => invoke<void>("http_put_binary", { url, contentType, base64Data }),
  httpPostMultipart: (url: string, parameters: Array<{name:string;value:string}>, fileName: string, contentType: string, base64Data: string) => invoke<void>("http_post_multipart", { url, parameters, fileName, contentType, base64Data }),
  saveZipEntries: (defaultName: string, entries: Array<{name:string;base64Data:string}>) => invoke<string | null>("save_zip_entries", { defaultName, entries }),
  pickZipEntries: () => invoke<Array<{name:string;base64Data:string}>>("pick_zip_entries"),
  getSettings: (storeId: string) => invoke<Record<string, unknown>>("get_settings", { storeId }),
  saveSettings: (storeId: string, values: Record<string, unknown>) => invoke<void>("save_settings", { storeId, values }),
  listHistory: (storeId?: string, limit = 100) => invoke<HistoryRecord[]>("list_history", { storeId: storeId || null, limit }),
  saveHistory: (input: HistoryInput) => invoke<HistoryRecord>("save_history", { input }),
  deleteHistory: (historyId: string) => invoke<void>("delete_history", { historyId }),
  clearHistory: (storeId?: string) => invoke<number>("clear_history", { storeId: storeId || null }),
  saveTextFile: (defaultName: string, content: string) => invoke<string | null>("save_text_file", { defaultName, content }),
  saveBinaryFile: (defaultName: string, base64Data: string) => invoke<string | null>("save_binary_file", { defaultName, base64Data }),
  createBackup: () => invoke<string | null>("create_backup"),
  restoreBackup: () => invoke<Record<string, unknown>>("restore_backup"),
  diagnostics: () => invoke<DiagnosticsResult>("diagnostics"),
};

function choose<K extends keyof typeof tauriApi>(key: K): (typeof tauriApi)[K] {
  return (isTauriRuntime() ? tauriApi[key] : webApi[key]) as (typeof tauriApi)[K];
}

export const desktopApi = {
  listStores: (...args: Parameters<typeof tauriApi.listStores>) => choose("listStores")(...args),
  saveStore: (...args: Parameters<typeof tauriApi.saveStore>) => choose("saveStore")(...args),
  setActiveStore: (...args: Parameters<typeof tauriApi.setActiveStore>) => choose("setActiveStore")(...args),
  deleteStore: (...args: Parameters<typeof tauriApi.deleteStore>) => choose("deleteStore")(...args),
  testStore: (...args: Parameters<typeof tauriApi.testStore>) => choose("testStore")(...args),
  graphql: (...args: Parameters<typeof tauriApi.graphql>) => choose("graphql")(...args),
  httpGetText: (...args: Parameters<typeof tauriApi.httpGetText>) => choose("httpGetText")(...args),
  httpGetBinary: (...args: Parameters<typeof tauriApi.httpGetBinary>) => choose("httpGetBinary")(...args),
  httpPutBinary: (...args: Parameters<typeof tauriApi.httpPutBinary>) => choose("httpPutBinary")(...args),
  httpPostMultipart: (...args: Parameters<typeof tauriApi.httpPostMultipart>) => choose("httpPostMultipart")(...args),
  saveZipEntries: (...args: Parameters<typeof tauriApi.saveZipEntries>) => choose("saveZipEntries")(...args),
  pickZipEntries: (...args: Parameters<typeof tauriApi.pickZipEntries>) => choose("pickZipEntries")(...args),
  getSettings: (...args: Parameters<typeof tauriApi.getSettings>) => choose("getSettings")(...args),
  saveSettings: (...args: Parameters<typeof tauriApi.saveSettings>) => choose("saveSettings")(...args),
  listHistory: (...args: Parameters<typeof tauriApi.listHistory>) => choose("listHistory")(...args),
  saveHistory: (...args: Parameters<typeof tauriApi.saveHistory>) => choose("saveHistory")(...args),
  deleteHistory: (...args: Parameters<typeof tauriApi.deleteHistory>) => choose("deleteHistory")(...args),
  clearHistory: (...args: Parameters<typeof tauriApi.clearHistory>) => choose("clearHistory")(...args),
  saveTextFile: (...args: Parameters<typeof tauriApi.saveTextFile>) => choose("saveTextFile")(...args),
  saveBinaryFile: (...args: Parameters<typeof tauriApi.saveBinaryFile>) => choose("saveBinaryFile")(...args),
  createBackup: (...args: Parameters<typeof tauriApi.createBackup>) => choose("createBackup")(...args),
  restoreBackup: (...args: Parameters<typeof tauriApi.restoreBackup>) => choose("restoreBackup")(...args),
  diagnostics: (...args: Parameters<typeof tauriApi.diagnostics>) => choose("diagnostics")(...args),
};
