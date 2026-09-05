import { desktopApi, isTauriRuntime, type StoreRecord } from "./desktopApi";
import { webApi } from "./webApi";
import type { BrowserZipEntry } from "./browserZip";

// Pin only this feature; do not change the API version of other store operations.
const API_VERSION = "2026-07";
const BATCH_BYTES = 384 * 1024;
const MAX_THEME_BYTES = 250 * 1024 * 1024;
export interface ShopifyTheme {
  id: string;
  name: string;
  role: string;
  updatedAt: string;
  processing: boolean;
  processingFailed: boolean;
}
interface ThemeFile {
  filename: string;
  size: number;
  checksumMd5: string | null;
  body?: { __typename: string; content?: string; contentBase64?: string; url?: string };
}
type ApiThemeFile = Omit<ThemeFile, "size"> & { size: string | number };
function normalizeFile(file: ApiThemeFile): ThemeFile {
  // Shopify's UnsignedInt64 scalar is serialized as a decimal string.
  if (typeof file.size !== "number" && (typeof file.size !== "string" || !/^\d+$/.test(file.size))) throw new Error(`Invalid file size: ${file.filename}`);
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid file size: ${file.filename}`);
  return { ...file, size };
}
interface Connection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  userErrors?: Array<{ code: string; filename: string }>;
}
export interface ThemeExportProgress {
  phase: "listing" | "downloading" | "verifying" | "saving";
  total: number;
  completed: number;
  bytes: number;
  filename: string;
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Theme download cancelled.", "AbortError");
}
async function pause(ms: number, signal?: AbortSignal) {
  checkCancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export function themeErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/access.denied|read_themes|HTTP 403|forbidden/i.test(message)) {
    return "Theme access is missing. Enable the read_themes Admin API scope for this store's Shopify app, update its installation, and reconnect the store if Shopify issues a new token. Then refresh the themes.";
  }
  return message;
}
async function retry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    checkCancelled(signal);
    try {
      const result = await operation();
      checkCancelled(signal);
      return result;
    } catch (reason) {
      checkCancelled(signal);
      const message = reason instanceof Error ? reason.message : String(reason);
      if (attempt >= 3 || !/throttl|429|HTTP 5\d\d|Shopify HTTP 5\d\d|network|fetch|timed? ?out/i.test(message)) throw reason;
      await pause(1000 * 2 ** attempt, signal);
    }
  }
}
async function graphql<T>(storeId: string, query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return retry(async () => {
    const result = await desktopApi.graphql(storeId, query, variables, API_VERSION) as {
      data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };
    if (result.errors?.length) throw new Error(result.errors.map(e => `${e.extensions?.code || ""} ${e.message}`).join("; "));
    if (!result.data) throw new Error("Shopify returned no theme data.");
    return result.data;
  }, signal);
}
function nextCursor<T>(connection: Connection<T>, seen: Set<string>): string | null {
  if (!connection.pageInfo.hasNextPage) return null;
  const cursor = connection.pageInfo.endCursor;
  if (!cursor || seen.has(cursor)) throw new Error("Shopify returned an incomplete page. Please refresh and try again.");
  seen.add(cursor);
  return cursor;
}
export async function listShopifyThemes(storeId: string, signal?: AbortSignal): Promise<ShopifyTheme[]> {
  const themes: ShopifyTheme[] = [];
  const seen = new Set<string>();
  let after: string | null = null;
  do {
    const data: { themes: Connection<ShopifyTheme> } = await graphql(storeId, `query ThemeDownloadList($after: String) {
      themes(first: 50, after: $after) {
        nodes { id name role updatedAt processing processingFailed }
        pageInfo { hasNextPage endCursor }
      }
    }`, { after }, signal);
    themes.push(...data.themes.nodes);
    after = nextCursor(data.themes, seen);
  } while (after);
  return themes.sort((a, b) => Number(b.role === "MAIN") - Number(a.role === "MAIN") || a.name.localeCompare(b.name));
}
function validateFilename(name: string) {
  if (!name || name.startsWith("/") || /[\\\x00-\x1f:*?]/.test(name) || name.split("/").some(p => !p || p === "." || p === "..")) {
    throw new Error(`Invalid theme file path: ${name}`);
  }
}
function validateFiles(connection: Pick<Connection<ThemeFile>, "userErrors">) {
  if (connection.userErrors?.length) {
    throw new Error(`Shopify could not read theme files: ${connection.userErrors.map(e => `${e.filename || "file"}: ${e.code}`).join("; ")}`);
  }
}
async function fileManifest(storeId: string, themeId: string, signal?: AbortSignal) {
  const files = new Map<string, ThemeFile>();
  const seen = new Set<string>();
  let after: string | null = null;
  let totalBytes = 0;
  do {
    const data: { theme: (ShopifyTheme & { files: Connection<ApiThemeFile> }) | null } = await graphql(storeId, `query ThemeDownloadManifest($id: ID!, $after: String) {
      theme(id: $id) {
        id name role updatedAt processing processingFailed
        files(first: 100, after: $after) {
          nodes { filename size checksumMd5 }
          pageInfo { hasNextPage endCursor }
          userErrors { code filename }
        }
      }
    }`, { id: themeId, after }, signal);
    if (!data.theme) throw new Error("The selected theme no longer exists. Refresh the theme list.");
    if (data.theme.processing || data.theme.processingFailed) throw new Error("This theme is not ready for download. Wait for Shopify to finish processing it, then refresh.");
    validateFiles(data.theme.files);
    for (const rawFile of data.theme.files.nodes) {
      const file = normalizeFile(rawFile);
      validateFilename(file.filename);
      if (files.has(file.filename)) throw new Error("The theme changed during listing. Please try again.");
      if (!Number.isSafeInteger(file.size) || file.size < 0) throw new Error(`Invalid file size: ${file.filename}`);
      files.set(file.filename, file);
      totalBytes += file.size;
      if (totalBytes > MAX_THEME_BYTES) throw new Error("This theme exceeds the 250 MB browser export limit. Download this theme from Shopify Admin instead.");
    }
    after = nextCursor(data.theme.files, seen);
  } while (after);
  if (!files.has("layout/theme.liquid")) throw new Error("The selected theme has no layout/theme.liquid. A complete Shopify theme ZIP cannot be created.");
  return files;
}
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function validateDownloadedBytes(file: ThemeFile, bytes: Uint8Array) {
  if (file.filename.toLowerCase().endsWith(".json")) {
    try {
      // Validate a copy only. Keep comments, whitespace, BOM, URLs and every
      // original setting byte unchanged in the ZIP.
      const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        .replace(/^\uFEFF/, "")
        .replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, token => token.startsWith('"') ? token : " ")
        .replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, token => token.startsWith('"') ? token : "");
      const value = JSON.parse(json);
      if (value === null || typeof value !== "object") throw new Error("JSON object or array expected");
    } catch {
      throw new Error(`Theme JSON is invalid or incomplete: ${file.filename}. No ZIP was saved.`);
    }
  } else if (bytes.length !== file.size) {
    throw new Error(`Incomplete file: ${file.filename} (expected ${file.size} bytes, received ${bytes.length}). No ZIP was saved.`);
  }
}
async function chunkedFile(storeId: string, themeId: string, file: ThemeFile, signal?: AbortSignal): Promise<string> {
  let output: Uint8Array | null = null;
  let contentSha256: string | null = null;
  const isJson = file.filename.toLowerCase().endsWith(".json");
  let offset = 0;
  do {
    const part = await retry(() => webApi.themeFileChunk(storeId, themeId, file.filename, offset, file.checksumMd5, signal), signal);
    if (part.sourceSize === undefined) throw new Error("Update api/bridge.py together with the theme download files, then try again.");
    if (part.sourceSize !== file.size || part.checksumMd5 !== file.checksumMd5) throw new Error(`Theme changed during download: ${file.filename}. Please try again.`);
    if (!Number.isSafeInteger(part.totalSize) || part.totalSize < 0 || part.totalSize > MAX_THEME_BYTES || (!isJson && part.totalSize !== file.size)) throw new Error(`Invalid downloaded size: ${file.filename}`);
    if (isJson && !/^[a-f0-9]{64}$/.test(part.contentSha256 || "")) throw new Error(`Missing JSON content verification: ${file.filename}`);
    if (!output) {
      output = new Uint8Array(part.totalSize);
      contentSha256 = part.contentSha256;
    } else if (part.totalSize !== output.length || part.contentSha256 !== contentSha256) {
      throw new Error(`Theme file content changed between download chunks: ${file.filename}. Please try again.`);
    }
    const bytes = fromBase64(part.base64Data);
    if (part.offset !== offset || part.nextOffset !== offset + bytes.length || part.nextOffset > output.length || (output.length > 0 && !bytes.length)) {
      throw new Error(`Incomplete download: ${file.filename}`);
    }
    output.set(bytes, offset);
    offset = part.nextOffset;
  } while (offset < output.length);
  if (contentSha256) {
    const digest = await crypto.subtle.digest("SHA-256", output);
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    if (actual !== contentSha256) throw new Error(`Theme file content verification failed: ${file.filename}. No ZIP was saved.`);
  }
  validateDownloadedBytes(file, output);
  if (isJson && output.length !== file.size) {
    // A metadata size difference is not proof of truncation. Read again and
    // compare the digest of the complete body before accepting that difference.
    const confirm = await retry(() => webApi.themeFileChunk(storeId, themeId, file.filename, 0, file.checksumMd5, signal), signal);
    if (confirm.sourceSize !== file.size || confirm.checksumMd5 !== file.checksumMd5 || confirm.totalSize !== output.length || confirm.contentSha256 !== contentSha256) {
      throw new Error(`Theme JSON changed during verification: ${file.filename}. Please try again.`);
    }
  }
  checkCancelled(signal);
  return toBase64(output);
}
async function bodyToBase64(file: ThemeFile, storeId: string, themeId: string, signal?: AbortSignal): Promise<string> {
  const body = file.body;
  let base64Data: string;
  if (body?.__typename === "OnlineStoreThemeFileBodyText" && typeof body.content === "string") base64Data = toBase64(new TextEncoder().encode(body.content));
  else if (body?.__typename === "OnlineStoreThemeFileBodyBase64" && typeof body.contentBase64 === "string") base64Data = body.contentBase64;
  else if (body?.__typename === "OnlineStoreThemeFileBodyUrl" && body.url) {
    if (!isTauriRuntime()) return chunkedFile(storeId, themeId, file, signal);
    base64Data = await retry(() => desktopApi.httpGetBinary(body.url!), signal);
  } else {
    throw new Error(`Shopify did not return the content of ${file.filename}. No ZIP was saved.`);
  }
  const bytes = fromBase64(base64Data);
  validateDownloadedBytes(file, bytes);
  if (bytes.length !== file.size) {
    let confirmed: string;
    if (!isTauriRuntime()) {
      confirmed = await chunkedFile(storeId, themeId, file, signal);
    } else {
      const data = await graphql<{ theme: { files: Connection<ApiThemeFile> } | null }>(storeId, `query ThemeDownloadConfirm($id: ID!, $filenames: [String!]!) {
        theme(id: $id) { files(first: 1, filenames: $filenames) {
          nodes { filename size checksumMd5 body { __typename
            ... on OnlineStoreThemeFileBodyText { content }
            ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
            ... on OnlineStoreThemeFileBodyUrl { url }
          } }
          pageInfo { hasNextPage endCursor }
          userErrors { code filename }
        } }
      }`, { id: themeId, filenames: [file.filename] }, signal);
      if (!data.theme) throw new Error("The selected theme no longer exists.");
      validateFiles(data.theme.files);
      const raw = data.theme.files.nodes[0];
      if (!raw || raw.filename !== file.filename || Number(raw.size) !== file.size || raw.checksumMd5 !== file.checksumMd5) throw new Error(`Theme JSON changed during verification: ${file.filename}`);
      const repeat = raw.body;
      if (repeat?.__typename === "OnlineStoreThemeFileBodyText" && typeof repeat.content === "string") confirmed = toBase64(new TextEncoder().encode(repeat.content));
      else if (repeat?.__typename === "OnlineStoreThemeFileBodyBase64" && typeof repeat.contentBase64 === "string") confirmed = repeat.contentBase64;
      else if (repeat?.__typename === "OnlineStoreThemeFileBodyUrl" && repeat.url) confirmed = await retry(() => desktopApi.httpGetBinary(repeat.url!), signal);
      else throw new Error(`Shopify did not return the content of ${file.filename}. No ZIP was saved.`);
    }
    if (confirmed !== base64Data) throw new Error(`Theme JSON changed during verification: ${file.filename}. Please try again.`);
  }
  return base64Data;
}
export function themeZipName(store: Pick<StoreRecord, "domain">, theme: ShopifyTheme): string {
  const clean = (value: string) => value.normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, "-").replace(/[. -]+$/g, "").slice(0, 80) || "theme";
  return `${clean(store.domain.replace(/\.myshopify\.com$/, ""))}-${clean(theme.name)}-${theme.id.split("/").pop()}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
}

export async function downloadShopifyTheme(store: StoreRecord, theme: ShopifyTheme, onProgress: (progress: ThemeExportProgress) => void, signal?: AbortSignal) {
  if (!/^gid:\/\/shopify\/OnlineStoreTheme\/\d+$/.test(theme.id)) throw new Error("Select a valid Shopify theme.");
  const progress: ThemeExportProgress = { phase: "listing", total: 0, completed: 0, bytes: 0, filename: "" };
  const report = () => { checkCancelled(signal); onProgress({ ...progress }); };
  report();
  const files = await fileManifest(store.id, theme.id, signal);
  progress.total = files.size;
  progress.phase = "downloading";
  report();
  const entries: BrowserZipEntry[] = [];
  const pending = [...files.values()];
  const addEntry = (file: ThemeFile, base64Data: string) => {
    checkCancelled(signal);
    const bytes = fromBase64(base64Data);
    validateDownloadedBytes(file, bytes);
    if (progress.bytes + bytes.length > MAX_THEME_BYTES) throw new Error("The downloaded theme exceeds the 250 MB browser export limit.");
    entries.push({ name: file.filename, base64Data });
    progress.completed += 1;
    progress.bytes += bytes.length;
    progress.filename = file.filename;
    report();
  };
  while (pending.length) {
    checkCancelled(signal);
    const first = pending[0];
    if (first.size > BATCH_BYTES && !isTauriRuntime()) {
      progress.filename = first.filename; report();
      addEntry(first, await chunkedFile(store.id, theme.id, first, signal));
      pending.shift();
      continue;
    }
    const batch: ThemeFile[] = [];
    let bytes = 0;
    while (pending.length && batch.length < 20 && (!batch.length || bytes + pending[0].size <= BATCH_BYTES)) {
      const file = pending.shift()!; batch.push(file); bytes += file.size;
    }
    // Small batches stay below Vercel's response limit even with JSON escaping.
    const data = await graphql<{ theme: { files: Connection<ApiThemeFile> } | null }>(store.id, `query ThemeDownloadContents($id: ID!, $filenames: [String!]!) {
      theme(id: $id) {
        files(first: 50, filenames: $filenames) {
          nodes { filename size checksumMd5 body {
            __typename
            ... on OnlineStoreThemeFileBodyText { content }
            ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
            ... on OnlineStoreThemeFileBodyUrl { url }
          } }
          pageInfo { hasNextPage endCursor }
          userErrors { code filename }
        }
      }
    }`, { id: theme.id, filenames: batch.map(f => f.filename) }, signal);
    if (!data.theme) throw new Error("The selected theme no longer exists.");
    validateFiles(data.theme.files);
    const received = new Map(data.theme.files.nodes.map(f => [f.filename, normalizeFile(f)]));
    for (const expected of batch) {
      const file = received.get(expected.filename);
      if (!file || file.size !== expected.size || file.checksumMd5 !== expected.checksumMd5) throw new Error(`Theme changed or file is missing: ${expected.filename}. Please try again.`);
      addEntry(file, await bodyToBase64(file, store.id, theme.id, signal));
    }
  }
  progress.phase = "verifying"; progress.filename = ""; report();
  const finalManifest = await fileManifest(store.id, theme.id, signal);
  if (files.size !== finalManifest.size || [...files].some(([name, file]) => {
    const current = finalManifest.get(name);
    return !current || current.size !== file.size || current.checksumMd5 !== file.checksumMd5;
  })) throw new Error("The theme was edited during download. Please download it again to get a consistent ZIP.");
  progress.phase = "saving"; report();
  // Yield so the browser can paint the last progress update before ZIP assembly.
  await pause(30, signal);
  const path = await desktopApi.saveZipEntries(themeZipName(store, theme), entries);
  return { path, fileCount: entries.length, bytes: progress.bytes };
}
