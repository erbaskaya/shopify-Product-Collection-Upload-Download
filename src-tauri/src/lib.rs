use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use keyring::Entry;
use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use sysinfo::System;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const KEYRING_SERVICE: &str = "de.hausone.shopify-product-collection-upload";

#[derive(Clone)]
struct AppState {
    db_path: Arc<PathBuf>,
    http: Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreRecord {
    id: String,
    name: String,
    website: String,
    domain: String,
    api_version: String,
    is_active: bool,
    token_present: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveStoreInput {
    id: Option<String>,
    name: String,
    website: String,
    domain: String,
    api_version: String,
    access_token: Option<String>,
    set_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryRecord {
    id: String,
    store_id: String,
    kind: String,
    name: String,
    status: String,
    total: i64,
    processed: i64,
    created_count: i64,
    updated_count: i64,
    skipped_count: i64,
    failed_count: i64,
    details_json: String,
    file_path: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryInput {
    id: Option<String>,
    store_id: String,
    kind: String,
    name: String,
    status: String,
    total: i64,
    processed: i64,
    created_count: i64,
    updated_count: i64,
    skipped_count: i64,
    failed_count: i64,
    details_json: Option<String>,
    file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsResult {
    app_version: String,
    os_name: String,
    os_version: String,
    architecture: String,
    app_data_path: String,
    database_path: String,
    database_size: u64,
    store_count: i64,
    history_count: i64,
    database_ok: bool,
}

fn normalize_domain(value: &str) -> Result<String, String> {
    let mut domain = value.trim().to_lowercase();
    domain = domain
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_string();

    if domain.is_empty() || !domain.ends_with(".myshopify.com") {
        return Err("Shopify domain must end with .myshopify.com".into());
    }

    if domain.contains('/') || domain.contains(' ') {
        return Err("Shopify domain is invalid.".into());
    }

    Ok(domain)
}

fn normalize_api_version(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        "2026-04".to_string()
    } else {
        value.to_string()
    }
}

fn open_db(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn init_db(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let connection = open_db(path)?;
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS stores (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              website TEXT NOT NULL DEFAULT '',
              domain TEXT NOT NULL UNIQUE,
              api_version TEXT NOT NULL DEFAULT '2026-04',
              is_active INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
              store_id TEXT PRIMARY KEY,
              values_json TEXT NOT NULL DEFAULT '{}',
              updated_at TEXT NOT NULL,
              FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS history (
              id TEXT PRIMARY KEY,
              store_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              name TEXT NOT NULL,
              status TEXT NOT NULL,
              total INTEGER NOT NULL DEFAULT 0,
              processed INTEGER NOT NULL DEFAULT 0,
              created_count INTEGER NOT NULL DEFAULT 0,
              updated_count INTEGER NOT NULL DEFAULT 0,
              skipped_count INTEGER NOT NULL DEFAULT 0,
              failed_count INTEGER NOT NULL DEFAULT 0,
              details_json TEXT NOT NULL DEFAULT '{}',
              file_path TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(store_id) REFERENCES stores(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_history_store_created
              ON history(store_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS app_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              level TEXT NOT NULL,
              source TEXT NOT NULL,
              message TEXT NOT NULL,
              details_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );
            "#,
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn token_entry(store_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, store_id).map_err(|error| error.to_string())
}

fn get_store_token(store_id: &str) -> Result<String, String> {
    let token = token_entry(store_id)?
        .get_password()
        .map_err(|error| {
            format!(
                "The access token is not saved for this store. Credential vault error: {error}"
            )
        })?;

    if token.trim().is_empty() {
        return Err("The saved access token is empty. Open Stores and save the token again.".into());
    }

    Ok(token)
}

fn store_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoreRecord> {
    let id: String = row.get(0)?;
    let token_present = token_entry(&id)
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    Ok(StoreRecord {
        id,
        name: row.get(1)?,
        website: row.get(2)?,
        domain: row.get(3)?,
        api_version: row.get(4)?,
        is_active: row.get::<_, i64>(5)? == 1,
        token_present,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn get_store_by_id(db_path: &Path, store_id: &str) -> Result<StoreRecord, String> {
    let connection = open_db(db_path)?;
    connection
        .query_row(
            "SELECT id, name, website, domain, api_version, is_active, created_at, updated_at FROM stores WHERE id = ?1",
            params![store_id],
            store_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Store was not found.".to_string())
}

async fn graphql_for_store(
    state: &AppState,
    store_id: &str,
    query: &str,
    variables: Value,
    api_version_override: Option<&str>,
) -> Result<Value, String> {
    let store = get_store_by_id(&state.db_path, store_id)?;
    let token = get_store_token(store_id)?;
    let api_version = api_version_override
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&store.api_version);
    let endpoint = format!(
        "https://{}/admin/api/{}/graphql.json",
        store.domain, api_version
    );

    let response = state
        .http
        .post(endpoint)
        .header("X-Shopify-Access-Token", token)
        .header("Content-Type", "application/json")
        .json(&json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|error| format!("Shopify connection failed: {error}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Shopify response could not be read: {error}"))?;

    if !status.is_success() {
        return Err(format!("Shopify returned HTTP {status}: {text}"));
    }

    serde_json::from_str(&text)
        .map_err(|error| format!("Shopify returned invalid JSON: {error}"))
}

fn load_stores(db_path: &Path) -> Result<Vec<StoreRecord>, String> {
    let connection = open_db(db_path)?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, website, domain, api_version, is_active, created_at, updated_at FROM stores ORDER BY is_active DESC, name ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], store_from_row)
        .map_err(|error| error.to_string())?;

    let mut stores = Vec::new();
    for row in rows {
        stores.push(row.map_err(|error| error.to_string())?);
    }
    Ok(stores)
}

#[tauri::command]
fn list_stores(state: State<'_, AppState>) -> Result<Vec<StoreRecord>, String> {
    load_stores(&state.db_path)
}

#[tauri::command]
fn save_store(state: State<'_, AppState>, input: SaveStoreInput) -> Result<StoreRecord, String> {
    let domain = normalize_domain(&input.domain)?;
    let api_version = normalize_api_version(&input.api_version);
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Store name is required.".into());
    }

    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let connection = open_db(&state.db_path)?;
    let existing_created: Option<String> = connection
        .query_row(
            "SELECT created_at FROM stores WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let created_at = existing_created.unwrap_or_else(|| now.clone());

    let active_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM stores WHERE is_active = 1", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let set_active = input.set_active.unwrap_or(false) || active_count == 0;

    if set_active {
        connection
            .execute("UPDATE stores SET is_active = 0", [])
            .map_err(|error| error.to_string())?;
    }

    connection
        .execute(
            r#"
            INSERT INTO stores(id, name, website, domain, api_version, is_active, created_at, updated_at)
            VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              website = excluded.website,
              domain = excluded.domain,
              api_version = excluded.api_version,
              is_active = CASE WHEN excluded.is_active = 1 THEN 1 ELSE stores.is_active END,
              updated_at = excluded.updated_at
            "#,
            params![
                id,
                name,
                input.website.trim(),
                domain,
                api_version,
                if set_active { 1 } else { 0 },
                created_at,
                now
            ],
        )
        .map_err(|error| {
            if error.to_string().contains("UNIQUE constraint failed: stores.domain") {
                "This Shopify domain is already saved.".to_string()
            } else {
                error.to_string()
            }
        })?;

    if let Some(token) = input.access_token {
        let token = token.trim();
        if !token.is_empty() {
            let entry = token_entry(&id)?;
            entry
                .set_password(token)
                .map_err(|error| format!("Access token could not be saved securely: {error}"))?;

            let verified = entry
                .get_password()
                .map_err(|error| format!("Access token was written but could not be read back: {error}"))?;

            if verified != token {
                return Err("Access token verification failed after saving it to the credential vault.".into());
            }
        }
    }

    get_store_by_id(&state.db_path, &id)
}

#[tauri::command]
fn set_active_store(state: State<'_, AppState>, store_id: String) -> Result<(), String> {
    let connection = open_db(&state.db_path)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("UPDATE stores SET is_active = 0", [])
        .map_err(|error| error.to_string())?;
    let affected = transaction
        .execute(
            "UPDATE stores SET is_active = 1, updated_at = ?2 WHERE id = ?1",
            params![store_id, Utc::now().to_rfc3339()],
        )
        .map_err(|error| error.to_string())?;
    if affected == 0 {
        return Err("Store was not found.".into());
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_store(state: State<'_, AppState>, store_id: String) -> Result<(), String> {
    let connection = open_db(&state.db_path)?;
    let was_active: bool = connection
        .query_row(
            "SELECT is_active FROM stores WHERE id = ?1",
            params![store_id],
            |row| Ok(row.get::<_, i64>(0)? == 1),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(false);

    connection
        .execute("DELETE FROM stores WHERE id = ?1", params![store_id])
        .map_err(|error| error.to_string())?;
    if let Ok(entry) = token_entry(&store_id) {
        let _ = entry.delete_credential();
    }

    if was_active {
        let next_id: Option<String> = connection
            .query_row(
                "SELECT id FROM stores ORDER BY name ASC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some(next_id) = next_id {
            connection
                .execute("UPDATE stores SET is_active = 1 WHERE id = ?1", params![next_id])
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
async fn test_store_connection(
    state: State<'_, AppState>,
    store_id: String,
) -> Result<Value, String> {
    let query = r#"
      query DesktopConnectionTest {
        shop {
          name
          myshopifyDomain
          currencyCode
        }
        locations(first: 100) {
          nodes {
            id
            name
            isActive
          }
        }
        productsCount(limit: null) { count }
        collectionsCount(limit: null) { count }
      }
    "#;

    let result = graphql_for_store(&state, &store_id, query, json!({}), Some("2026-07")).await?;
    if let Some(errors) = result.get("errors") {
        return Err(format!("Shopify GraphQL error: {errors}"));
    }
    Ok(result)
}

#[tauri::command]
async fn shopify_graphql(
    state: State<'_, AppState>,
    store_id: String,
    query: String,
    variables: Value,
    api_version: Option<String>,
) -> Result<Value, String> {
    graphql_for_store(
        &state,
        &store_id,
        &query,
        variables,
        api_version.as_deref(),
    )
    .await
}

#[tauri::command]
async fn http_get_text(state: State<'_, AppState>, url: String) -> Result<String, String> {
    let response = state
        .http
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("Download failed with HTTP {status}: {text}"));
    }
    Ok(text)
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ZipEntryTransfer {
    name: String,
    base64_data: String,
}

#[tauri::command]
async fn http_get_binary(state: State<'_, AppState>, url: String) -> Result<String, String> {
    let response = state.http.get(url).send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("Download failed with HTTP {status}"));
    }
    Ok(BASE64.encode(bytes))
}

#[tauri::command]
async fn http_put_binary(
    state: State<'_, AppState>,
    url: String,
    content_type: String,
    base64_data: String,
) -> Result<(), String> {
    let bytes = BASE64.decode(base64_data).map_err(|error| error.to_string())?;
    let response = state.http.put(url).header("Content-Type", content_type).body(bytes).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Upload failed with HTTP {}", response.status()));
    }
    Ok(())
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MultipartParameter { name: String, value: String }

#[tauri::command]
async fn http_post_multipart(
    state: State<'_, AppState>,
    url: String,
    parameters: Vec<MultipartParameter>,
    file_name: String,
    content_type: String,
    base64_data: String,
) -> Result<(), String> {
    let bytes = BASE64.decode(base64_data).map_err(|error| error.to_string())?;
    let mut form = reqwest::multipart::Form::new();
    for parameter in parameters { form = form.text(parameter.name, parameter.value); }
    let part = reqwest::multipart::Part::bytes(bytes).file_name(file_name).mime_str(&content_type).map_err(|error| error.to_string())?;
    form = form.part("file", part);
    let response = state.http.post(url).multipart(form).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() { return Err(format!("Multipart upload failed with HTTP {}", response.status())); }
    Ok(())
}

#[tauri::command]
fn save_zip_entries(default_name: String, entries: Vec<ZipEntryTransfer>) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new().set_file_name(&default_name).save_file();
    let Some(path) = path else { return Ok(None); };
    let file = File::create(&path).map_err(|error| error.to_string())?;
    let mut zip = ZipWriter::new(file);
    for entry in entries {
        let bytes = BASE64.decode(entry.base64_data).map_err(|error| error.to_string())?;
        zip.start_file(entry.name, SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).map_err(|error| error.to_string())?;
        zip.write_all(&bytes).map_err(|error| error.to_string())?;
    }
    zip.finish().map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn pick_zip_entries() -> Result<Vec<ZipEntryTransfer>, String> {
    let path = rfd::FileDialog::new().add_filter("ZIP archive", &["zip"]).pick_file();
    let Some(path) = path else { return Ok(Vec::new()); };
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut output = Vec::new();
    for index in 0..archive.len() {
        let mut item = archive.by_index(index).map_err(|error| error.to_string())?;
        if item.is_dir() { continue; }
        let mut bytes = Vec::new();
        item.read_to_end(&mut bytes).map_err(|error| error.to_string())?;
        output.push(ZipEntryTransfer { name: item.name().to_string(), base64_data: BASE64.encode(bytes) });
    }
    Ok(output)
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>, store_id: String) -> Result<Value, String> {
    let connection = open_db(&state.db_path)?;
    let value: Option<String> = connection
        .query_row(
            "SELECT values_json FROM settings WHERE store_id = ?1",
            params![store_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    match value {
        Some(value) => serde_json::from_str(&value).map_err(|error| error.to_string()),
        None => Ok(json!({})),
    }
}

#[tauri::command]
fn save_settings(state: State<'_, AppState>, store_id: String, values: Value) -> Result<(), String> {
    let connection = open_db(&state.db_path)?;
    connection
        .execute(
            r#"
            INSERT INTO settings(store_id, values_json, updated_at)
            VALUES(?1, ?2, ?3)
            ON CONFLICT(store_id) DO UPDATE SET
              values_json = excluded.values_json,
              updated_at = excluded.updated_at
            "#,
            params![store_id, values.to_string(), Utc::now().to_rfc3339()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn history_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryRecord> {
    Ok(HistoryRecord {
        id: row.get(0)?,
        store_id: row.get(1)?,
        kind: row.get(2)?,
        name: row.get(3)?,
        status: row.get(4)?,
        total: row.get(5)?,
        processed: row.get(6)?,
        created_count: row.get(7)?,
        updated_count: row.get(8)?,
        skipped_count: row.get(9)?,
        failed_count: row.get(10)?,
        details_json: row.get(11)?,
        file_path: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

fn load_history(
    db_path: &Path,
    store_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<HistoryRecord>, String> {
    let connection = open_db(db_path)?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let mut output = Vec::new();

    if let Some(store_id) = store_id {
        let mut statement = connection
            .prepare(
                r#"SELECT id, store_id, kind, name, status, total, processed,
                created_count, updated_count, skipped_count, failed_count,
                details_json, file_path, created_at, updated_at
                FROM history WHERE store_id = ?1 ORDER BY created_at DESC LIMIT ?2"#,
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![store_id, limit], history_from_row)
            .map_err(|error| error.to_string())?;
        for row in rows {
            output.push(row.map_err(|error| error.to_string())?);
        }
    } else {
        let mut statement = connection
            .prepare(
                r#"SELECT id, store_id, kind, name, status, total, processed,
                created_count, updated_count, skipped_count, failed_count,
                details_json, file_path, created_at, updated_at
                FROM history ORDER BY created_at DESC LIMIT ?1"#,
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![limit], history_from_row)
            .map_err(|error| error.to_string())?;
        for row in rows {
            output.push(row.map_err(|error| error.to_string())?);
        }
    }

    Ok(output)
}

#[tauri::command]
fn list_history(
    state: State<'_, AppState>,
    store_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<HistoryRecord>, String> {
    load_history(&state.db_path, store_id, limit)
}

#[tauri::command]
fn save_history(state: State<'_, AppState>, input: HistoryInput) -> Result<HistoryRecord, String> {
    let connection = open_db(&state.db_path)?;
    let now = Utc::now().to_rfc3339();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing_created: Option<String> = connection
        .query_row(
            "SELECT created_at FROM history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let created_at = existing_created.unwrap_or_else(|| now.clone());

    connection
        .execute(
            r#"
            INSERT INTO history(
              id, store_id, kind, name, status, total, processed,
              created_count, updated_count, skipped_count, failed_count,
              details_json, file_path, created_at, updated_at
            ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
            ON CONFLICT(id) DO UPDATE SET
              status=excluded.status, total=excluded.total, processed=excluded.processed,
              created_count=excluded.created_count, updated_count=excluded.updated_count,
              skipped_count=excluded.skipped_count, failed_count=excluded.failed_count,
              details_json=excluded.details_json, file_path=excluded.file_path,
              updated_at=excluded.updated_at
            "#,
            params![
                id,
                input.store_id,
                input.kind,
                input.name,
                input.status,
                input.total,
                input.processed,
                input.created_count,
                input.updated_count,
                input.skipped_count,
                input.failed_count,
                input.details_json.unwrap_or_else(|| "{}".into()),
                input.file_path.unwrap_or_default(),
                created_at,
                now
            ],
        )
        .map_err(|error| error.to_string())?;

    connection
        .query_row(
            r#"SELECT id, store_id, kind, name, status, total, processed,
            created_count, updated_count, skipped_count, failed_count,
            details_json, file_path, created_at, updated_at FROM history WHERE id=?1"#,
            params![id],
            history_from_row,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_history(state: State<'_, AppState>, history_id: String) -> Result<(), String> {
    let connection = open_db(&state.db_path)?;
    connection
        .execute("DELETE FROM history WHERE id = ?1", params![history_id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_history(state: State<'_, AppState>, store_id: Option<String>) -> Result<usize, String> {
    let connection = open_db(&state.db_path)?;
    if let Some(store_id) = store_id {
        connection
            .execute("DELETE FROM history WHERE store_id = ?1", params![store_id])
            .map_err(|error| error.to_string())
    } else {
        connection
            .execute("DELETE FROM history", [])
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn save_text_file(default_name: String, content: String) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .save_file();
    let Some(path) = path else { return Ok(None); };
    fs::write(&path, content.as_bytes()).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn save_binary_file(default_name: String, base64_data: String) -> Result<Option<String>, String> {
    let bytes = BASE64
        .decode(base64_data)
        .map_err(|error| format!("Invalid file data: {error}"))?;
    let path = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .save_file();
    let Some(path) = path else { return Ok(None); };
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn create_backup(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_file_name(&format!("shopify-desktop-backup-{}.zip", Utc::now().format("%Y-%m-%d")))
        .save_file();
    let Some(path) = path else { return Ok(None); };

    let connection = open_db(&state.db_path)?;
    let stores = load_stores(&state.db_path)?;
    let history = load_history(&state.db_path, None, Some(100_000))?;

    let mut settings = Vec::<Value>::new();
    let mut statement = connection
        .prepare("SELECT store_id, values_json, updated_at FROM settings")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "storeId": row.get::<_, String>(0)?,
                "values": serde_json::from_str::<Value>(&row.get::<_, String>(1)?).unwrap_or(json!({})),
                "updatedAt": row.get::<_, String>(2)?,
            }))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        settings.push(row.map_err(|error| error.to_string())?);
    }

    let backup = json!({
        "format": "hausone-shopify-desktop-backup",
        "version": 1,
        "createdAt": Utc::now().to_rfc3339(),
        "tokensIncluded": false,
        "stores": stores,
        "settings": settings,
        "history": history,
    });

    let file = File::create(&path).map_err(|error| error.to_string())?;
    let mut zip = ZipWriter::new(file);
    zip.start_file("backup.json", SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated))
        .map_err(|error| error.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&backup).unwrap().as_bytes())
        .map_err(|error| error.to_string())?;
    zip.finish().map_err(|error| error.to_string())?;

    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn restore_backup(state: State<'_, AppState>) -> Result<Value, String> {
    let path = rfd::FileDialog::new()
        .add_filter("Shopify Desktop Backup", &["zip"])
        .pick_file();
    let Some(path) = path else { return Ok(json!({"cancelled": true})); };

    let file = File::open(&path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let mut backup_file = archive.by_name("backup.json").map_err(|_| "backup.json was not found in the archive.".to_string())?;
    let mut text = String::new();
    backup_file.read_to_string(&mut text).map_err(|error| error.to_string())?;
    let backup: Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    if backup.get("format").and_then(Value::as_str) != Some("hausone-shopify-desktop-backup") {
        return Err("This is not a supported backup file.".into());
    }

    let connection = open_db(&state.db_path)?;
    let transaction = connection.unchecked_transaction().map_err(|error| error.to_string())?;

    let stores = backup.get("stores").and_then(Value::as_array).cloned().unwrap_or_default();
    for item in &stores {
        let store: StoreRecord = serde_json::from_value(item.clone()).map_err(|error| error.to_string())?;
        transaction.execute(
            r#"INSERT INTO stores(id,name,website,domain,api_version,is_active,created_at,updated_at)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name,website=excluded.website,
            domain=excluded.domain,api_version=excluded.api_version,updated_at=excluded.updated_at"#,
            params![store.id, store.name, store.website, store.domain, store.api_version, if store.is_active {1} else {0}, store.created_at, store.updated_at]
        ).map_err(|error| error.to_string())?;
    }

    let settings = backup.get("settings").and_then(Value::as_array).cloned().unwrap_or_default();
    for item in &settings {
        let store_id = item.get("storeId").and_then(Value::as_str).unwrap_or("");
        let values = item.get("values").cloned().unwrap_or(json!({}));
        let updated_at = item.get("updatedAt").and_then(Value::as_str).unwrap_or("");
        if !store_id.is_empty() {
            transaction.execute(
                "INSERT INTO settings(store_id,values_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(store_id) DO UPDATE SET values_json=excluded.values_json,updated_at=excluded.updated_at",
                params![store_id, values.to_string(), updated_at]
            ).map_err(|error| error.to_string())?;
        }
    }

    let history = backup.get("history").and_then(Value::as_array).cloned().unwrap_or_default();
    for item in &history {
        let record: HistoryRecord = serde_json::from_value(item.clone()).map_err(|error| error.to_string())?;
        transaction.execute(
            r#"INSERT INTO history(id,store_id,kind,name,status,total,processed,created_count,updated_count,skipped_count,failed_count,details_json,file_path,created_at,updated_at)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
            ON CONFLICT(id) DO UPDATE SET status=excluded.status,processed=excluded.processed,
            created_count=excluded.created_count,updated_count=excluded.updated_count,
            skipped_count=excluded.skipped_count,failed_count=excluded.failed_count,
            details_json=excluded.details_json,file_path=excluded.file_path,updated_at=excluded.updated_at"#,
            params![record.id,record.store_id,record.kind,record.name,record.status,record.total,record.processed,record.created_count,record.updated_count,record.skipped_count,record.failed_count,record.details_json,record.file_path,record.created_at,record.updated_at]
        ).map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(json!({
        "cancelled": false,
        "stores": stores.len(),
        "settings": settings.len(),
        "history": history.len(),
        "tokensRestored": false
    }))
}

#[tauri::command]
fn diagnostics(app: AppHandle, state: State<'_, AppState>) -> Result<DiagnosticsResult, String> {
    let connection = open_db(&state.db_path)?;
    let store_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM stores", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let history_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM history", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let database_ok = connection.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .map(|value| value == "ok")
        .unwrap_or(false);
    let database_size = fs::metadata(&*state.db_path).map(|item| item.len()).unwrap_or(0);

    let mut system = System::new_all();
    system.refresh_all();

    Ok(DiagnosticsResult {
        app_version: app.package_info().version.to_string(),
        os_name: System::name().unwrap_or_else(|| std::env::consts::OS.into()),
        os_version: System::os_version().unwrap_or_default(),
        architecture: std::env::consts::ARCH.into(),
        app_data_path: state.db_path.parent().unwrap_or(Path::new("")).to_string_lossy().to_string(),
        database_path: state.db_path.to_string_lossy().to_string(),
        database_size,
        store_count,
        history_count,
        database_ok,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let db_path = app_data_dir.join("shopify-desktop.sqlite");
            init_db(&db_path)?;
            app.manage(AppState {
                db_path: Arc::new(db_path),
                http: Client::builder()
                    .user_agent("Hausone Shopify Desktop/1.0")
                    .build()
                    .map_err(|error| error.to_string())?,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_stores,
            save_store,
            set_active_store,
            delete_store,
            test_store_connection,
            shopify_graphql,
            http_get_text,
            http_get_binary,
            http_put_binary,
            http_post_multipart,
            save_zip_entries,
            pick_zip_entries,
            get_settings,
            save_settings,
            list_history,
            save_history,
            delete_history,
            clear_history,
            save_text_file,
            save_binary_file,
            create_backup,
            restore_backup,
            diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
