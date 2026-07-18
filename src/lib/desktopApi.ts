import { invoke } from "@tauri-apps/api/core";

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

export const desktopApi = {
  listStores: () => invoke<StoreRecord[]>("list_stores"),
  saveStore: (input: SaveStoreInput) => invoke<StoreRecord>("save_store", { input }),
  setActiveStore: (storeId: string) => invoke<void>("set_active_store", { storeId }),
  deleteStore: (storeId: string) => invoke<void>("delete_store", { storeId }),
  testStore: (storeId: string) => invoke<Record<string, unknown>>("test_store_connection", { storeId }),
  graphql: (
    storeId: string,
    query: string,
    variables: Record<string, unknown> = {},
    apiVersion?: string,
  ) =>
    invoke<Record<string, unknown>>("shopify_graphql", {
      storeId,
      query,
      variables,
      apiVersion: apiVersion || null,
    }),
  httpGetText: (url: string) => invoke<string>("http_get_text", { url }),
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
