// Run: node --test tests/theme-export.test.mjs (after npm ci).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), 'theme-export-test-'));
const outfile = path.join(temporary, 'subject.mjs');
await build({
  stdin: { contents: 'export * from "./src/lib/themeExport"; export * from "./src/lib/browserZip";', resolveDir: root },
  outfile, bundle: true, platform: 'node', format: 'esm',
  plugins: [{ name: 'api-fixture', setup(builder) {
    builder.onResolve({ filter: /\/(desktopApi|webApi)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const desktopApi = new Proxy({}, { get: (_, key) => (...args) => globalThis.__themeApi[key](...args) });
      export const webApi = desktopApi;
      export const isTauriRuntime = () => false;
    ` }));
  } }],
});
const { downloadShopifyTheme, listShopifyThemes, themeErrorMessage, createStoredZip, parseZip } = await import(pathToFileURL(outfile));
after(() => rm(temporary, { recursive: true, force: true }));

const store = { id: 'store-1', domain: 'test.myshopify.com', tokenPresent: true };
const theme = { id: 'gid://shopify/OnlineStoreTheme/222', name: 'Kopie von 08022026', role: 'UNPUBLISHED', updatedAt: '2026-09-05T10:00:00Z', processing: false, processingFailed: false };
function file(filename, bytes, kind = 'Text') {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { filename, bytes, size: String(bytes.length), checksumMd5: createHash('md5').update(bytes).digest('hex'),
    body: kind === 'Text' ? { __typename: 'OnlineStoreThemeFileBodyText', content: bytes.toString('utf8') }
      : kind === 'Base64' ? { __typename: 'OnlineStoreThemeFileBodyBase64', contentBase64: bytes.toString('base64') }
      : { __typename: 'OnlineStoreThemeFileBodyUrl', url: 'https://cdn.shopify.com/test.png' },
  };
}
const defaults = () => [
  file('layout/theme.liquid', '{{ content_for_header }}\nİçerik: ä ö ü €\n{{ content_for_layout }}'),
  file('config/settings_data.json', '{"current":{"title":"ä"}}'),
  file('templates/index.json', '{}'),
  file('assets/logo.png', Buffer.from([137, 80, 78, 71, 0, 255, 24, 96]), 'Base64'),
  file('assets/font.woff2', Buffer.from([0, 3, 255, 2, 1]), 'Url'),
  file('assets/empty.css', ''),
];
function fixture(files = defaults(), hooks = {}) {
  const state = { calls: [], saves: [], manifestPass: 0 };
  const connection = (nodes, hasNextPage = false, endCursor = null) => ({ nodes, userErrors: [], pageInfo: { hasNextPage, endCursor } });
  globalThis.__themeApi = {
    async graphql(storeId, query, variables, apiVersion) {
      state.calls.push({ storeId, query, variables, apiVersion });
      const overridden = await hooks.graphql?.(query, variables, state);
      if (overridden) return overridden;
      if (query.includes('ThemeDownloadList')) return { data: { themes: connection([theme]) } };
      assert.equal(storeId, store.id);
      assert.equal(variables.id, theme.id, 'No other theme may be read');
      assert.equal(apiVersion, '2026-07');
      if (query.includes('Manifest')) {
        if (!variables.after) state.manifestPass += 1;
        const start = variables.after ? Number(variables.after) : 0;
        const nodes = files.slice(start, start + 3).map(({ body, bytes, ...metadata }) => metadata);
        return { data: { theme: { ...theme, files: connection(nodes, start + 3 < files.length, String(start + 3)) } } };
      }
      return { data: { theme: { files: connection(files.filter(f => variables.filenames.includes(f.filename)).map(({ bytes, ...node }) => node)) } } };
    },
    async themeFileChunk(storeId, themeId, filename, offset, checksum) {
      state.calls.push({ storeId, themeId, filename, offset });
      assert.equal(themeId, theme.id);
      const selected = files.find(f => f.filename === filename);
      assert.equal(selected.checksumMd5, checksum);
      const bytes = selected.bytes.subarray(offset, offset + 512 * 1024);
      const part = { offset, nextOffset: offset + bytes.length, totalSize: selected.bytes.length, sourceSize: Number(selected.size),
        contentSha256: createHash('sha256').update(selected.bytes).digest('hex'), checksumMd5: checksum, base64Data: bytes.toString('base64') };
      return hooks.chunk ? hooks.chunk(part, state) : part;
    },
    async saveZipEntries(name, entries) { state.saves.push({ name, entries, zip: createStoredZip(entries) }); return name; },
  };
  return state;
}
test('downloads only selected theme; all paginated files round-trip as UTF-8 and binary ZIP entries', async () => {
  const files = defaults();
  const state = fixture(files);
  const updates = [];
  const result = await downloadShopifyTheme(store, theme, p => updates.push(p));
  assert.equal(state.saves.length, 1);
  assert.equal(result.fileCount, files.length);
  assert.match(result.path, /Kopie-von-08022026-222-/);
  const entries = await parseZip(state.saves[0].zip);
  assert.deepEqual(entries.map(e => e.name), files.map(f => f.filename));
  for (const entry of entries) assert.deepEqual(Buffer.from(entry.base64Data, 'base64'), files.find(f => f.filename === entry.name).bytes);
  assert.equal(state.manifestPass, 2);
  assert.equal(updates.at(-1).phase, 'saving');
  assert.equal(updates.at(-1).completed, files.length);
});
test('large files are assembled from bounded chunks without sending content via GraphQL bridge', async () => {
  const bytes = Buffer.alloc(1200 * 1024, 201);
  const files = [...defaults(), file('assets/large.bin', bytes, 'Base64')];
  const state = fixture(files);
  await downloadShopifyTheme(store, theme, () => {});
  assert.deepEqual(state.calls.filter(c => c.filename === 'assets/large.bin').map(c => c.offset), [0, 524288, 1048576]);
  assert(!state.calls.some(c => c.variables?.filenames?.includes('assets/large.bin')));
  assert.deepEqual(Buffer.from(state.saves[0].entries.at(-1).base64Data, 'base64'), bytes);
});
test('themes paginate and active/draft themes with identical names retain distinct IDs', async () => {
  const other = { ...theme, id: 'gid://shopify/OnlineStoreTheme/111', role: 'MAIN' };
  fixture(defaults(), { graphql: async (_query, variables) => ({ data: { themes: { nodes: [variables.after ? other : theme], pageInfo: { hasNextPage: !variables.after, endCursor: 'next' } } } }) });
  assert.deepEqual((await listShopifyThemes(store.id)).map(t => t.id), [other.id, theme.id]);
});
test('missing read_themes scope explains how to fix access and never saves', async () => {
  const state = fixture(defaults(), { graphql: async () => ({ errors: [{ message: 'Access denied for theme field. Required access: read_themes.' }] }) });
  await assert.rejects(downloadShopifyTheme(store, theme, () => {}), /read_themes/);
  assert.match(themeErrorMessage(new Error('Access denied')), /read_themes/);
  assert.equal(state.saves.length, 0);
});
test('a missing or truncated file prevents an incomplete ZIP', async () => {
  const state = fixture(defaults(), { graphql: async query => query.includes('Contents') ? { data: { theme: { files: { nodes: [], userErrors: [], pageInfo: { hasNextPage: false } } } } } : null });
  await assert.rejects(downloadShopifyTheme(store, theme, () => {}), /missing/);
  assert.equal(state.saves.length, 0);
  const files = defaults(); files[0].body.content = 'short';
  const truncated = fixture(files);
  await assert.rejects(downloadShopifyTheme(store, theme, () => {}), /Incomplete file/);
  assert.equal(truncated.saves.length, 0);
});
test('theme edits detected during final verification prevent a mixed ZIP', async () => {
  const files = defaults();
  const state = fixture(files, { graphql: async (query, variables, state) => {
    if (query.includes('Manifest') && !variables.after && state.manifestPass === 1) files[0].checksumMd5 = 'changed';
  } });
  await assert.rejects(downloadShopifyTheme(store, theme, () => {}), /edited during download/);
  assert.equal(state.saves.length, 0);
});
test('cancelling an in-flight request prevents subsequent work and ZIP saving', async () => {
  const controller = new AbortController();
  const state = fixture(defaults(), { graphql: async () => { controller.abort(); } });
  await assert.rejects(downloadShopifyTheme(store, theme, () => {}, controller.signal), { name: 'AbortError' });
  assert.equal(state.calls.length, 1);
  assert.equal(state.saves.length, 0);
});
test('unsafe paths and a theme without layout/theme.liquid cannot be archived', async () => {
  for (const files of [[...defaults(), file('../secret.txt', 'x')], defaults().slice(1)]) {
    const state = fixture(files);
    await assert.rejects(downloadShopifyTheme(store, theme, () => {}), /path|layout\/theme.liquid/);
    assert.equal(state.saves.length, 0);
  }
});
test('repeated pagination cursor stops safely instead of looping forever', async () => {
  fixture(defaults(), { graphql: async () => ({ data: { themes: { nodes: [theme], pageInfo: { hasNextPage: true, endCursor: 'same' } } } }) });
  await assert.rejects(listShopifyThemes(store.id), /incomplete page/);
});
test('settings JSON with a different metadata size is re-read and archived without changing a byte', async () => {
  const text = '\uFEFF/* Shopify generated header */\r\n{\r\n "current": {"title":"İ ä €", "url":"https://example.com/a//b", "text":"/* keep */",},\r\n "presets": {},\r\n}\r\n';
  for (const reported of [0, 35, Buffer.byteLength(text) + 100]) {
    const files = defaults();
    files[1] = file('config/settings_data.json', text);
    files[1].size = String(reported);
    files[1].checksumMd5 = createHash('md5').update('stored representation').digest('hex');
    const state = fixture(files);
    const result = await downloadShopifyTheme(store, theme, () => {});
    const saved = state.saves[0].entries.find(e => e.name === files[1].filename);
    assert.deepEqual(Buffer.from(saved.base64Data, 'base64'), Buffer.from(text));
    assert.equal(result.bytes, files.reduce((sum, file) => sum + file.bytes.length, 0));
    assert.equal(state.calls.filter(c => c.filename === files[1].filename).length, 2);
  }
});
test('large JSON chunks use actual content size while retaining source revision metadata', async () => {
  const files = defaults();
  files[1] = file('config/settings_data.json', JSON.stringify({current:{text:'ü'.repeat(310000)}}));
  files[1].size = String(400 * 1024);
  const state = fixture(files);
  await downloadShopifyTheme(store, theme, () => {});
  assert.deepEqual(state.calls.filter(c => c.filename === files[1].filename).map(c => c.offset), [0, 524288, 0]);
  assert.deepEqual(Buffer.from(state.saves[0].entries.find(e => e.name === files[1].filename).base64Data, 'base64'), files[1].bytes);
});
test('JSON returned as URL or base64 supports representation size differences', async () => {
  for (const kind of ['Url', 'Base64']) {
    const files = defaults();
    files[1] = file('config/settings_data.json', '{"current": {"text":"ä"}, "presets": {}}', kind);
    files[1].size = '20';
    const state = fixture(files);
    await downloadShopifyTheme(store, theme, () => {});
    assert.deepEqual(Buffer.from(state.saves[0].entries.find(e => e.name === files[1].filename).base64Data, 'base64'), files[1].bytes);
  }
});
test('malformed or truncated JSON remains an error even if the metadata size matches', async () => {
  for (const content of ['{"current":', '/* not closed {"current":{}}', '{"current": "not closed}', 'null']) {
    const files = defaults(); files[1] = file('config/settings_data.json', content);
    const state = fixture(files);
    await assert.rejects(downloadShopifyTheme(store, theme, () => {}), /JSON is invalid or incomplete/);
    assert.equal(state.saves.length, 0);
  }
});
test('a corrupt chunk cannot pass by keeping the same length or source checksum', async () => {
  const files = defaults(); files[1].size = '1';
  const state = fixture(files, { chunk: part => ({ ...part, base64Data: Buffer.alloc(Buffer.from(part.base64Data, 'base64').length, 32).toString('base64') }) });
  await assert.rejects(downloadShopifyTheme(store, theme, () => {}), /content verification failed/);
  assert.equal(state.saves.length, 0);
});
test('JSON content changing on the independent read cannot produce a ZIP', async () => {
  const files = defaults(); files[1].size = '1';
  const state = fixture(files, { chunk: (part, state) => {
    if (state.calls.filter(c => c.filename === files[1].filename).length > 1) return { ...part, contentSha256: 'f'.repeat(64) };
    return part;
  } });
  await assert.rejects(downloadShopifyTheme(store, theme, () => {}), /JSON changed during verification/);
  assert.equal(state.saves.length, 0);
});
