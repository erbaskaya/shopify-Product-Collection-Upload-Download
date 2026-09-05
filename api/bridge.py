from http.server import BaseHTTPRequestHandler
import base64
import hashlib
import hmac
import json
import os
import platform
import re
import secrets
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone, timedelta

import psycopg
from psycopg.rows import dict_row

DB_URL = os.getenv("DATABASE_URL", "")
PANEL_PASSWORD = os.getenv("PANEL_PASSWORD", "")
SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-key")
APP_ENCRYPTION_KEY = os.getenv("APP_ENCRYPTION_KEY", SECRET_KEY)
SESSION_COOKIE = "shopify_tools_session"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def derive_key():
    return hashlib.sha256(APP_ENCRYPTION_KEY.encode("utf-8")).digest()


def _keystream(nonce: bytes, length: int) -> bytes:
    key = derive_key()
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(output[:length])


def encrypt_token(text: str) -> str:
    if not text:
        return ""
    nonce = secrets.token_bytes(16)
    raw = text.encode("utf-8")
    stream = _keystream(nonce, len(raw))
    cipher = bytes(a ^ b for a, b in zip(raw, stream))
    tag = hmac.new(derive_key(), b"token-v1" + nonce + cipher, hashlib.sha256).digest()
    return "v1." + ".".join(base64.urlsafe_b64encode(x).decode("ascii").rstrip("=") for x in (nonce, cipher, tag))


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def decrypt_token(value: str) -> str:
    if not value:
        return ""
    try:
        version, nonce_s, cipher_s, tag_s = value.split(".", 3)
        if version != "v1":
            raise ValueError("Unsupported token format")
        nonce, cipher, tag = map(_b64decode, (nonce_s, cipher_s, tag_s))
        expected = hmac.new(derive_key(), b"token-v1" + nonce + cipher, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            raise ValueError("Token integrity check failed")
        stream = _keystream(nonce, len(cipher))
        raw = bytes(a ^ b for a, b in zip(cipher, stream))
        return raw.decode("utf-8")
    except Exception as exc:
        raise RuntimeError(f"Saved access token could not be decrypted: {exc}")


def sign_session(exp: int) -> str:
    body = str(exp)
    sig = hmac.new(SECRET_KEY.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def parse_cookies(header: str):
    result = {}
    for part in (header or "").split(";"):
        if "=" in part:
            k, v = part.strip().split("=", 1)
            result[k] = v
    return result


def session_valid(cookie_header: str) -> bool:
    token = parse_cookies(cookie_header).get(SESSION_COOKIE, "")
    try:
        exp_s, sig = token.split(".", 1)
        expected = hmac.new(SECRET_KEY.encode(), exp_s.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, expected) and int(exp_s) > int(datetime.now(timezone.utc).timestamp())
    except Exception:
        return False


def db():
    if not DB_URL:
        raise RuntimeError("DATABASE_URL is not configured. Connect a PostgreSQL/Neon database in Vercel.")
    return psycopg.connect(DB_URL, row_factory=dict_row)


def init_db(conn):
    with conn.cursor() as cur:
        cur.execute("""
        CREATE TABLE IF NOT EXISTS spc_stores (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          website TEXT NOT NULL DEFAULT '',
          domain TEXT NOT NULL UNIQUE,
          api_version TEXT NOT NULL DEFAULT '2026-04',
          is_active BOOLEAN NOT NULL DEFAULT FALSE,
          token_enc TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS spc_settings (
          store_id TEXT PRIMARY KEY REFERENCES spc_stores(id) ON DELETE CASCADE,
          values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS spc_history (
          id TEXT PRIMARY KEY,
          store_id TEXT NOT NULL REFERENCES spc_stores(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          total BIGINT NOT NULL DEFAULT 0,
          processed BIGINT NOT NULL DEFAULT 0,
          created_count BIGINT NOT NULL DEFAULT 0,
          updated_count BIGINT NOT NULL DEFAULT 0,
          skipped_count BIGINT NOT NULL DEFAULT 0,
          failed_count BIGINT NOT NULL DEFAULT 0,
          details_json TEXT NOT NULL DEFAULT '{}',
          file_path TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_spc_history_store_created
          ON spc_history(store_id, created_at DESC);
        """)
    conn.commit()


def normalize_domain(value: str) -> str:
    domain = (value or "").strip().lower()
    for prefix in ("https://", "http://"):
        if domain.startswith(prefix):
            domain = domain[len(prefix):]
    domain = domain.rstrip("/")
    if not domain.endswith(".myshopify.com") or "/" in domain or " " in domain:
        raise ValueError("Shopify domain must be like store.myshopify.com")
    return domain


def store_row(row):
    return {
        "id": row["id"], "name": row["name"], "website": row["website"], "domain": row["domain"],
        "apiVersion": row["api_version"], "isActive": bool(row["is_active"]),
        "tokenPresent": bool(row.get("token_enc")), "createdAt": row["created_at"], "updatedAt": row["updated_at"]
    }


def history_row(row):
    return {
        "id": row["id"], "storeId": row["store_id"], "kind": row["kind"], "name": row["name"],
        "status": row["status"], "total": int(row["total"]), "processed": int(row["processed"]),
        "createdCount": int(row["created_count"]), "updatedCount": int(row["updated_count"]),
        "skippedCount": int(row["skipped_count"]), "failedCount": int(row["failed_count"]),
        "detailsJson": row["details_json"], "filePath": row["file_path"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"]
    }


def get_store_with_token(conn, store_id):
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM spc_stores WHERE id=%s", (store_id,))
        row = cur.fetchone()
    if not row:
        raise ValueError("Store was not found.")
    token = decrypt_token(row.get("token_enc") or "")
    if not token:
        raise ValueError("Access token is missing for this store.")
    return row, token


def shopify_graphql(conn, store_id, query, variables, api_version=None):
    store, token = get_store_with_token(conn, store_id)
    version = (api_version or store["api_version"] or "2026-04").strip()
    url = f"https://{store['domain']}/admin/api/{version}/graphql.json"
    body = json_bytes({"query": query, "variables": variables or {}})
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Shopify-Access-Token": token,
        "User-Agent": "ShopifyToolsPanel-Web/2.1"
    })
    try:
        with urllib.request.urlopen(request, timeout=55) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"Shopify HTTP {exc.code}: {detail[:1200]}")


THEME_CHUNK_BYTES = 512 * 1024
THEME_MAX_BYTES = 250 * 1024 * 1024


def theme_cdn_url(url):
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    allowed = ("shopify.com", "shopifycdn.com", "shopifycdn.net", "myshopify.com")
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or parsed.port not in (None, 443)
            or not any(host == domain or host.endswith("." + domain) for domain in allowed)):
        raise ValueError("Shopify returned an unsupported theme asset URL.")
    return url


class ThemeAssetRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        theme_cdn_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def theme_url_chunk(url, offset, size):
    """Read a bounded CDN range. Never send the store's access token to a CDN."""
    end = min(size, offset + THEME_CHUNK_BYTES)
    req = urllib.request.Request(theme_cdn_url(url), headers={
        "Range": f"bytes={offset}-{end - 1}", "Accept-Encoding": "identity"
    })
    with urllib.request.build_opener(ThemeAssetRedirect()).open(req, timeout=25) as response:
        if response.status == 206:
            match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
            if not match or tuple(map(int, match.groups())) != (offset, end - 1, size):
                raise ValueError("Theme asset range changed or is incomplete. Please retry.")
        elif response.status == 200:
            length = response.headers.get("Content-Length")
            if length is not None and int(length) != size:
                raise ValueError("Theme asset size changed during download. Please retry.")
            # Some CDN responses ignore Range. Discard the prefix in bounded blocks.
            remaining = offset
            while remaining:
                block = response.read(min(65536, remaining))
                if not block:
                    raise ValueError("Theme asset download was incomplete.")
                remaining -= len(block)
        else:
            raise ValueError(f"Unexpected theme asset HTTP {response.status}")
        data = response.read(end - offset)
        if len(data) != end - offset:
            raise ValueError("Theme asset download was incomplete.")
        return data


def theme_file_chunk(conn, payload):
    """Large theme files bypass the 4.5 MB Vercel JSON response limit."""
    theme_id = str(payload.get("themeId") or "")
    filename = str(payload.get("filename") or "")
    offset = payload.get("offset", 0)
    if not re.fullmatch(r"gid://shopify/OnlineStoreTheme/\d+", theme_id):
        raise ValueError("Invalid theme ID.")
    if (not filename or re.search(r"[\\\x00-\x1f:*?]", filename)
            or any(part in ("", ".", "..") for part in filename.split("/"))):
        raise ValueError("Invalid theme filename.")
    if type(offset) is not int or offset < 0 or offset > THEME_MAX_BYTES:
        raise ValueError("Invalid theme file offset.")
    result = shopify_graphql(conn, payload["storeId"], """query ThemeDownloadChunk($id: ID!, $filenames: [String!]!) {
      theme(id: $id) {
        files(first: 1, filenames: $filenames) {
          nodes { filename size checksumMd5 body {
            __typename
            ... on OnlineStoreThemeFileBodyText { content }
            ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
            ... on OnlineStoreThemeFileBodyUrl { url }
          } }
          userErrors { code filename }
        }
      }
    }""", {"id": theme_id, "filenames": [filename]}, "2026-07")
    if result.get("errors"):
        raise ValueError("; ".join(str(e.get("message", "Shopify error")) for e in result["errors"]))
    theme = (result.get("data") or {}).get("theme")
    if not theme:
        raise ValueError("The selected theme no longer exists.")
    files = theme.get("files") or {}
    if files.get("userErrors"):
        raise ValueError("Shopify could not read the selected theme file: " + str(files["userErrors"]))
    nodes = files.get("nodes") or []
    if len(nodes) != 1 or nodes[0].get("filename") != filename:
        raise ValueError("The selected theme file is missing.")
    node = nodes[0]
    size = int(node["size"])
    if size < 0 or size > THEME_MAX_BYTES or offset > size or (size > 0 and offset == size):
        raise ValueError("Theme file size or offset is out of range.")
    if node.get("checksumMd5") != payload.get("checksumMd5"):
        raise ValueError("Theme changed during download. Please try again.")
    body = node.get("body") or {}
    kind = body.get("__typename")
    if kind == "OnlineStoreThemeFileBodyText" and isinstance(body.get("content"), str):
        content = body["content"].encode("utf-8")
    elif kind == "OnlineStoreThemeFileBodyBase64" and isinstance(body.get("contentBase64"), str):
        content = base64.b64decode(body["contentBase64"], validate=True)
    elif kind == "OnlineStoreThemeFileBodyUrl" and body.get("url"):
        content = None
    else:
        raise ValueError("Shopify did not return the theme file content.")
    if content is not None:
        if len(content) != size:
            raise ValueError("Theme file download was incomplete.")
        if node.get("checksumMd5") and hashlib.md5(content).hexdigest() != node["checksumMd5"].lower():
            raise ValueError("Theme file checksum did not match. Please retry.")
        data = content[offset:offset + THEME_CHUNK_BYTES]
    else:
        data = theme_url_chunk(body["url"], offset, size) if size else b""
    return {"base64Data": base64.b64encode(data).decode("ascii"), "offset": offset,
            "nextOffset": offset + len(data), "totalSize": size, "checksumMd5": node.get("checksumMd5")}


def safe_external_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Only http/https URLs are allowed.")
    host = parsed.hostname.lower()
    if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1") or host.endswith(".local"):
        raise ValueError("Local/private URLs are not allowed.")
    return url


def external_request(url, method="GET", data=None, headers=None, timeout=55):
    safe_external_url(url)
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read()
        raise RuntimeError(f"HTTP {exc.code}: {detail[:1000].decode('utf-8', 'replace')}")


def backup_export(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM spc_stores ORDER BY is_active DESC, name ASC")
        stores = [store_row(row) for row in cur.fetchall()]
        cur.execute("SELECT store_id, values_json, updated_at FROM spc_settings")
        settings = [{"storeId": r["store_id"], "values": r["values_json"], "updatedAt": r["updated_at"]} for r in cur.fetchall()]
        cur.execute("SELECT * FROM spc_history ORDER BY created_at DESC LIMIT 100000")
        history = [history_row(row) for row in cur.fetchall()]
    return {
        "format": "hausone-shopify-desktop-backup", "version": 1, "createdAt": now_iso(),
        "tokensIncluded": False, "stores": stores, "settings": settings, "history": history
    }


def backup_import(conn, backup):
    if backup.get("format") != "hausone-shopify-desktop-backup":
        raise ValueError("This is not a supported backup file.")
    stores = backup.get("stores") or []
    settings = backup.get("settings") or []
    history = backup.get("history") or []
    with conn.cursor() as cur:
        for s in stores:
            cur.execute("""
              INSERT INTO spc_stores(id,name,website,domain,api_version,is_active,token_enc,created_at,updated_at)
              VALUES(%s,%s,%s,%s,%s,%s,'',%s,%s)
              ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,website=EXCLUDED.website,
                domain=EXCLUDED.domain,api_version=EXCLUDED.api_version,updated_at=EXCLUDED.updated_at
            """, (s["id"], s["name"], s.get("website", ""), normalize_domain(s["domain"]), s.get("apiVersion", "2026-04"), bool(s.get("isActive")), s.get("createdAt", now_iso()), s.get("updatedAt", now_iso())))
        for item in settings:
            if item.get("storeId"):
                cur.execute("""INSERT INTO spc_settings(store_id,values_json,updated_at) VALUES(%s,%s::jsonb,%s)
                ON CONFLICT(store_id) DO UPDATE SET values_json=EXCLUDED.values_json,updated_at=EXCLUDED.updated_at""",
                (item["storeId"], json.dumps(item.get("values") or {}), item.get("updatedAt") or now_iso()))
        for r in history:
            cur.execute("""INSERT INTO spc_history(id,store_id,kind,name,status,total,processed,created_count,updated_count,skipped_count,failed_count,details_json,file_path,created_at,updated_at)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,processed=EXCLUDED.processed,
              created_count=EXCLUDED.created_count,updated_count=EXCLUDED.updated_count,skipped_count=EXCLUDED.skipped_count,
              failed_count=EXCLUDED.failed_count,details_json=EXCLUDED.details_json,file_path=EXCLUDED.file_path,updated_at=EXCLUDED.updated_at""",
            (r["id"], r["storeId"], r["kind"], r["name"], r["status"], r.get("total", 0), r.get("processed", 0), r.get("createdCount", 0), r.get("updatedCount", 0), r.get("skippedCount", 0), r.get("failedCount", 0), r.get("detailsJson", "{}"), r.get("filePath", ""), r.get("createdAt", now_iso()), r.get("updatedAt", now_iso())))
    conn.commit()
    return {"cancelled": False, "stores": len(stores), "settings": len(settings), "history": len(history), "tokensRestored": False}


def handle_action(action, payload):
    if action == "auth_status":
        return {"configured": bool(PANEL_PASSWORD), "loggedIn": False}
    if action == "login":
        return None
    if action == "logout":
        return None

    with db() as conn:
        init_db(conn)
        if action == "list_stores":
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM spc_stores ORDER BY is_active DESC, name ASC")
                return [store_row(row) for row in cur.fetchall()]
        if action == "save_store":
            x = payload.get("input") or {}
            store_id = x.get("id") or secrets.token_hex(16)
            name = (x.get("name") or "").strip()
            if not name:
                raise ValueError("Store name is required.")
            domain = normalize_domain(x.get("domain") or "")
            api_version = (x.get("apiVersion") or "2026-04").strip() or "2026-04"
            now = now_iso()
            with conn.cursor() as cur:
                cur.execute("SELECT created_at, token_enc FROM spc_stores WHERE id=%s", (store_id,))
                old = cur.fetchone()
                cur.execute("SELECT COUNT(*) AS c FROM spc_stores WHERE is_active=TRUE")
                active_count = int(cur.fetchone()["c"])
                set_active = bool(x.get("setActive")) or active_count == 0
                if set_active:
                    cur.execute("UPDATE spc_stores SET is_active=FALSE")
                token_enc = (old or {}).get("token_enc", "")
                access_token = (x.get("accessToken") or "").strip()
                if access_token:
                    if not access_token.startswith("shpat_"):
                        raise ValueError("Admin API access token should start with shpat_.")
                    token_enc = encrypt_token(access_token)
                cur.execute("""
                  INSERT INTO spc_stores(id,name,website,domain,api_version,is_active,token_enc,created_at,updated_at)
                  VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
                  ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,website=EXCLUDED.website,domain=EXCLUDED.domain,
                    api_version=EXCLUDED.api_version,is_active=CASE WHEN EXCLUDED.is_active THEN TRUE ELSE spc_stores.is_active END,
                    token_enc=EXCLUDED.token_enc,updated_at=EXCLUDED.updated_at
                """, (store_id, name, (x.get("website") or "").strip(), domain, api_version, set_active, token_enc, (old or {}).get("created_at", now), now))
            conn.commit()
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM spc_stores WHERE id=%s", (store_id,))
                return store_row(cur.fetchone())
        if action == "set_active_store":
            store_id = payload["storeId"]
            with conn.cursor() as cur:
                cur.execute("UPDATE spc_stores SET is_active=FALSE")
                cur.execute("UPDATE spc_stores SET is_active=TRUE,updated_at=%s WHERE id=%s", (now_iso(), store_id))
                if cur.rowcount == 0:
                    raise ValueError("Store was not found.")
            conn.commit(); return None
        if action == "delete_store":
            store_id = payload["storeId"]
            with conn.cursor() as cur:
                cur.execute("SELECT is_active FROM spc_stores WHERE id=%s", (store_id,)); row = cur.fetchone()
                was_active = bool(row and row["is_active"])
                cur.execute("DELETE FROM spc_stores WHERE id=%s", (store_id,))
                if was_active:
                    cur.execute("UPDATE spc_stores SET is_active=TRUE WHERE id=(SELECT id FROM spc_stores ORDER BY name ASC LIMIT 1)")
            conn.commit(); return None
        if action == "test_store":
            query = """query WebConnectionTest { shop { name myshopifyDomain currencyCode } locations(first:100){nodes{id name isActive}} productsCount(limit:null){count} collectionsCount(limit:null){count} }"""
            return shopify_graphql(conn, payload["storeId"], query, {}, "2026-07")
        if action == "graphql":
            return shopify_graphql(conn, payload["storeId"], payload["query"], payload.get("variables") or {}, payload.get("apiVersion"))
        if action == "theme_file_chunk":
            return theme_file_chunk(conn, payload)
        if action == "get_settings":
            with conn.cursor() as cur:
                cur.execute("SELECT values_json FROM spc_settings WHERE store_id=%s", (payload["storeId"],)); row = cur.fetchone()
            return row["values_json"] if row else {}
        if action == "save_settings":
            with conn.cursor() as cur:
                cur.execute("""INSERT INTO spc_settings(store_id,values_json,updated_at) VALUES(%s,%s::jsonb,%s)
                ON CONFLICT(store_id) DO UPDATE SET values_json=EXCLUDED.values_json,updated_at=EXCLUDED.updated_at""",
                (payload["storeId"], json.dumps(payload.get("values") or {}), now_iso()))
            conn.commit(); return None
        if action == "list_history":
            limit = min(max(int(payload.get("limit") or 100), 1), 500)
            with conn.cursor() as cur:
                if payload.get("storeId"):
                    cur.execute("SELECT * FROM spc_history WHERE store_id=%s ORDER BY created_at DESC LIMIT %s", (payload["storeId"], limit))
                else:
                    cur.execute("SELECT * FROM spc_history ORDER BY created_at DESC LIMIT %s", (limit,))
                return [history_row(r) for r in cur.fetchall()]
        if action == "save_history":
            x = payload.get("input") or {}; now = now_iso(); history_id = x.get("id") or secrets.token_hex(16)
            with conn.cursor() as cur:
                cur.execute("SELECT created_at FROM spc_history WHERE id=%s", (history_id,)); old = cur.fetchone()
                cur.execute("""INSERT INTO spc_history(id,store_id,kind,name,status,total,processed,created_count,updated_count,skipped_count,failed_count,details_json,file_path,created_at,updated_at)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,total=EXCLUDED.total,processed=EXCLUDED.processed,
                created_count=EXCLUDED.created_count,updated_count=EXCLUDED.updated_count,skipped_count=EXCLUDED.skipped_count,
                failed_count=EXCLUDED.failed_count,details_json=EXCLUDED.details_json,file_path=EXCLUDED.file_path,updated_at=EXCLUDED.updated_at""",
                (history_id, x["storeId"], x["kind"], x["name"], x["status"], int(x.get("total",0)), int(x.get("processed",0)), int(x.get("createdCount",0)), int(x.get("updatedCount",0)), int(x.get("skippedCount",0)), int(x.get("failedCount",0)), x.get("detailsJson") or "{}", x.get("filePath") or "", (old or {}).get("created_at", now), now))
            conn.commit()
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM spc_history WHERE id=%s", (history_id,)); return history_row(cur.fetchone())
        if action == "delete_history":
            with conn.cursor() as cur: cur.execute("DELETE FROM spc_history WHERE id=%s", (payload["historyId"],))
            conn.commit(); return None
        if action == "clear_history":
            with conn.cursor() as cur:
                if payload.get("storeId"): cur.execute("DELETE FROM spc_history WHERE store_id=%s", (payload["storeId"],))
                else: cur.execute("DELETE FROM spc_history")
                count = cur.rowcount
            conn.commit(); return count
        if action == "backup_export":
            return backup_export(conn)
        if action == "backup_import":
            return backup_import(conn, payload.get("backup") or {})
        if action == "diagnostics":
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS c FROM spc_stores"); stores = int(cur.fetchone()["c"])
                cur.execute("SELECT COUNT(*) AS c FROM spc_history"); hist = int(cur.fetchone()["c"])
            return {"appVersion":"2.1.0-web","osName":"Vercel Web","osVersion":"Serverless","architecture":platform.machine() or "web","appDataPath":"PostgreSQL / Neon","databasePath":"DATABASE_URL (secret)","databaseSize":0,"storeCount":stores,"historyCount":hist,"databaseOk":True}

    if action in ("http_get_text", "http_get_binary", "http_put_binary", "http_post_multipart"):
        pass
    raise ValueError(f"Unknown action: {action}")


def handle_external(action, payload):
    if action == "http_get_text":
        _, _, data = external_request(payload["url"])
        return data.decode("utf-8", "replace")
    if action == "http_get_binary":
        _, _, data = external_request(payload["url"])
        return base64.b64encode(data).decode("ascii")
    if action == "http_put_binary":
        data = base64.b64decode(payload["base64Data"])
        external_request(payload["url"], "PUT", data, {"Content-Type": payload.get("contentType") or "application/octet-stream"})
        return None
    if action == "http_post_multipart":
        boundary = "----ShopifyTools" + secrets.token_hex(12)
        parts = bytearray()
        for p in payload.get("parameters") or []:
            parts.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{p['name']}\"\r\n\r\n{p['value']}\r\n".encode())
        file_bytes = base64.b64decode(payload["base64Data"])
        parts.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{payload['fileName']}\"\r\nContent-Type: {payload.get('contentType') or 'application/octet-stream'}\r\n\r\n".encode())
        parts.extend(file_bytes); parts.extend(f"\r\n--{boundary}--\r\n".encode())
        external_request(payload["url"], "POST", bytes(parts), {"Content-Type": f"multipart/form-data; boundary={boundary}"})
        return None
    raise ValueError("Unknown external action")


class handler(BaseHTTPRequestHandler):
    def _send(self, status, value, extra_headers=None):
        body = json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra_headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/bridge"):
            self._send(200, {"ok": True, "result": {"status": "ok", "version": "2.1.0-web"}})
        else:
            self._send(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            action = payload.get("action", "")

            if action == "auth_status":
                self._send(200, {"ok": True, "result": {"configured": bool(PANEL_PASSWORD), "loggedIn": session_valid(self.headers.get("Cookie", ""))}}); return
            if action == "login":
                if not PANEL_PASSWORD:
                    raise RuntimeError("PANEL_PASSWORD is not configured in Vercel.")
                if not hmac.compare_digest(str(payload.get("password") or ""), PANEL_PASSWORD):
                    self._send(401, {"ok": False, "error": "Incorrect panel password."}); return
                exp = int((datetime.now(timezone.utc) + timedelta(hours=12)).timestamp())
                cookie = f"{SESSION_COOKIE}={sign_session(exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200"
                self._send(200, {"ok": True, "result": {"loggedIn": True}}, {"Set-Cookie": cookie}); return
            if action == "logout":
                cookie = f"{SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
                self._send(200, {"ok": True, "result": None}, {"Set-Cookie": cookie}); return

            if not session_valid(self.headers.get("Cookie", "")):
                self._send(401, {"ok": False, "error": "AUTH_REQUIRED"}); return

            if action.startswith("http_"):
                result = handle_external(action, payload)
            else:
                result = handle_action(action, payload)
            self._send(200, {"ok": True, "result": result})
        except Exception as exc:
            self._send(400, {"ok": False, "error": str(exc)})
