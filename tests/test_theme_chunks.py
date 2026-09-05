"""Run: python -m unittest discover -s tests -p 'test_theme_chunks.py' -v."""
import base64
import hashlib
import importlib.util
import io
import json
import socket
import ssl
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("theme_bridge", Path(__file__).resolve().parents[1] / "api" / "bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ThemeChunkTests(unittest.TestCase):
    def fixture(self, content, kind="Text"):
        checksum = hashlib.md5(content).hexdigest()
        body = {"__typename": "OnlineStoreThemeFileBody" + kind}
        if kind == "Text": body["content"] = content.decode("utf-8")
        elif kind == "Base64": body["contentBase64"] = base64.b64encode(content).decode()
        else: body["url"] = "https://cdn.shopify.com/test.bin"
        node = {"filename": "assets/test.bin", "size": str(len(content)), "checksumMd5": checksum, "body": body}
        response = {"data": {"theme": {"files": {"nodes": [node], "userErrors": []}}}}
        payload = {"storeId": "store-1", "themeId": "gid://shopify/OnlineStoreTheme/222", "filename": node["filename"], "offset": 0, "checksumMd5": checksum}
        return response, payload

    def test_text_and_binary_round_trip_and_payload_limit(self):
        for kind, content in [("Text", ("İ ä €\n" * 180000).encode()), ("Base64", bytes(range(256)) * 5000)]:
            response, payload = self.fixture(content, kind)
            chunks = []
            with patch.object(bridge, "shopify_graphql", return_value=response) as graphql:
                while payload["offset"] < len(content):
                    result = bridge.theme_file_chunk(None, payload)
                    self.assertLess(len(json.dumps(result)), 750000)
                    chunks.append(base64.b64decode(result["base64Data"]))
                    payload["offset"] = result["nextOffset"]
                self.assertEqual(b"".join(chunks), content)
                self.assertEqual(graphql.call_args.args[1], "store-1")
                self.assertEqual(graphql.call_args.args[3]["id"], payload["themeId"])

    def test_changed_checksum_and_corrupt_content_rejected(self):
        response, payload = self.fixture(b"abc")
        with patch.object(bridge, "shopify_graphql", return_value=response):
            with self.assertRaisesRegex(ValueError, "changed"):
                bridge.theme_file_chunk(None, {**payload, "checksumMd5": "old"})
            response["data"]["theme"]["files"]["nodes"][0]["body"]["content"] = "xyz"
            with self.assertRaisesRegex(ValueError, "checksum"):
                bridge.theme_file_chunk(None, payload)

    def test_access_denied_and_missing_files_propagate(self):
        _, payload = self.fixture(b"abc")
        for response, expected in [({"errors": [{"message": "Access denied: read_themes"}]}, "read_themes"),
                                   ({"data": {"theme": None}}, "no longer exists"),
                                   ({"data": {"theme": {"files": {"nodes": [], "userErrors": []}}}}, "missing")]:
            with patch.object(bridge, "shopify_graphql", return_value=response):
                with self.assertRaisesRegex(ValueError, expected): bridge.theme_file_chunk(None, payload)

    def test_invalid_requests_do_not_call_shopify(self):
        _, payload = self.fixture(b"abc")
        for changed in [{"filename": "../secret"}, {"filename": "assets/*"}, {"themeId": "222"}, {"offset": -1}, {"offset": "0"}]:
            with patch.object(bridge, "shopify_graphql") as graphql:
                with self.assertRaises(ValueError): bridge.theme_file_chunk(None, {**payload, **changed})
                graphql.assert_not_called()

    def test_public_https_urls_and_redirect_validation(self):
        self.assertEqual(bridge.theme_cdn_url("https://cdn.shopify.com/a"), "https://cdn.shopify.com/a")
        for url in ["http://cdn.shopify.com/a", "file:///etc/passwd", "https://127.0.0.1/a", "https://[::1]/a", "https://localhost./a", "https://metadata.google.internal/a", "https://name:secret@cdn.shopify.com/a", "https://cdn.shopify.com:8080/a", "https://cdn.shopify.com/\na"]:
            with self.assertRaises(ValueError): bridge.theme_cdn_url(url)
        with self.assertRaises(ValueError):
            bridge.ThemeAssetRedirect().redirect_request(None, None, 302, "", {}, "https://127.0.0.1/a")

    def test_signed_storage_urls_preserve_signature_and_redirects(self):
        # Regression: the old Shopify-only suffix allowlist rejected both of
        # these before any download. The API contract specifies a short-lived
        # URL, not a particular hostname. These are synthetic signed examples.
        urls = [
            "https://storage.googleapis.com/theme-assets/test%2Bfile?X-Goog-Signature=abc%2Fdef&X-Goog-Credential=a%40b&x=1&x=2",
            "https://theme-assets.s3.eu-central-1.amazonaws.com/assets/a?X-Amz-Signature=abc%2B123&X-Amz-Expires=300",
            "https://assets.cdn.example.net/file?signature=a%2Bb%2Fc%3D",
        ]
        for url in urls:
            self.assertEqual(bridge.theme_cdn_url(url), url)
            original = bridge.urllib.request.Request("https://cdn.shopify.com/asset", headers={"Range": "bytes=0-2"})
            redirected = bridge.ThemeAssetRedirect().redirect_request(original, None, 302, "Found", {}, url)
            self.assertEqual(redirected.full_url, url)
            self.assertEqual(redirected.get_header("Range"), "bytes=0-2")

    def test_api_returned_storage_url_is_downloaded_not_request_payload_url(self):
        response, payload = self.fixture(b"abc", "Url")
        signed = "https://storage.googleapis.com/test-bucket/test.bin?X-Goog-Signature=abc%2B123"
        response["data"]["theme"]["files"]["nodes"][0]["body"]["url"] = signed
        payload["url"] = "https://127.0.0.1/never-use-this"
        remote = io.BytesIO(b"abc")
        remote.status = 206
        remote.headers = {"Content-Range": "bytes 0-2/3"}
        with patch.object(bridge, "shopify_graphql", return_value=response), patch.object(bridge.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = remote
            result = bridge.theme_file_chunk(None, payload)
            self.assertEqual(base64.b64decode(result["base64Data"]), b"abc")
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, signed)
            self.assertNotIn("X-shopify-access-token", request.headers)
            self.assertNotIn("Cookie", request.headers)

    def test_dns_private_addresses_rejected_before_connecting(self):
        for private in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "100.64.0.1", "::1", "fc00::1", "ff02::1", "2001:db8::1"]:
            records = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("142.250.74.16", 443)),
                       (socket.AF_INET6 if ":" in private else socket.AF_INET, socket.SOCK_STREAM, 6, "", (private, 443))]
            with patch.object(bridge.socket, "getaddrinfo", return_value=records), patch.object(bridge.socket, "socket") as connection:
                with self.assertRaisesRegex(ValueError, "Private/local"):
                    bridge.theme_public_connection(("signed-assets.example.com", 443), 25)
                connection.assert_not_called()

    def test_connection_pins_validated_ip_and_preserves_tls_verification(self):
        records = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("142.250.74.16", 443))]
        with patch.object(bridge.socket, "getaddrinfo", return_value=records) as resolve, patch.object(bridge.socket, "socket") as connection:
            result = bridge.theme_public_connection(("storage.googleapis.com", 443), 25)
            resolve.assert_called_once_with("storage.googleapis.com", 443, type=socket.SOCK_STREAM)
            connection.return_value.connect.assert_called_once_with(("142.250.74.16", 443))
            self.assertIs(result, connection.return_value)
        https = bridge.ThemeAssetHTTPSConnection("storage.googleapis.com", timeout=25)
        self.assertTrue(https._context.check_hostname)
        self.assertEqual(https._context.verify_mode, ssl.CERT_REQUIRED)
        self.assertIs(https._create_connection, bridge.theme_public_connection)

    def test_cdn_range_and_ignored_range_are_byte_exact(self):
        content = bytes(range(256)) * 5000
        offset = 524288
        end = min(len(content), offset + bridge.THEME_CHUNK_BYTES)
        for status in [200, 206]:
            response = io.BytesIO(content[offset:end] if status == 206 else content)
            response.status = status
            response.headers = {"Content-Range": f"bytes {offset}-{end-1}/{len(content)}"} if status == 206 else {"Content-Length": str(len(content))}
            with patch.object(bridge.urllib.request, "build_opener") as opener:
                opener.return_value.open.return_value = response
                result = bridge.theme_url_chunk("https://cdn.shopify.com/a", offset, len(content))
                self.assertEqual(result, content[offset:end])
                request = opener.return_value.open.call_args.args[0]
                self.assertNotIn("X-shopify-access-token", request.headers)

    def test_incorrect_range_is_rejected(self):
        response = io.BytesIO(b"abc")
        response.status = 206
        response.headers = {"Content-Range": "bytes 0-2/30"}
        with patch.object(bridge.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = response
            with self.assertRaisesRegex(ValueError, "range changed"):
                bridge.theme_url_chunk("https://cdn.shopify.com/a", 3, 30)

    def json_fixture(self, content, kind="Text", reported_size=None):
        response, payload = self.fixture(content, kind)
        node = response["data"]["theme"]["files"]["nodes"][0]
        node["filename"] = payload["filename"] = "config/settings_data.json"
        if reported_size is not None:
            node["size"] = str(reported_size)
            node["checksumMd5"] = payload["checksumMd5"] = hashlib.md5(b"stored representation").hexdigest()
        return response, payload

    def test_json_actual_size_and_source_size_are_separate(self):
        content = ('\ufeff/* generated */\r\n{"current":{"title":"İ ä €", "url":"https://example.com/a//b", "text":"/* keep */",},"presets":{},}\n').encode()
        for kind in ["Text", "Base64"]:
            for reported in [0, 10, len(content) + 100]:
                response, payload = self.json_fixture(content, kind, reported)
                with patch.object(bridge, "shopify_graphql", return_value=response):
                    result = bridge.theme_file_chunk(None, payload)
                    self.assertEqual(result["sourceSize"], reported)
                    self.assertEqual(result["totalSize"], len(content))
                    self.assertEqual(result["contentSha256"], hashlib.sha256(content).hexdigest())
                    self.assertEqual(base64.b64decode(result["base64Data"]), content)

    def test_large_json_can_read_past_reported_size_using_actual_body(self):
        content = json.dumps({"current": {"text": "ü" * 310000}}, ensure_ascii=False).encode()
        response, payload = self.json_fixture(content, reported_size=400 * 1024)
        payload["offset"] = 524288
        with patch.object(bridge, "shopify_graphql", return_value=response):
            result = bridge.theme_file_chunk(None, payload)
            self.assertEqual(base64.b64decode(result["base64Data"]), content[524288:])
            self.assertEqual(result["nextOffset"], len(content))

    def test_invalid_json_still_fails_with_matching_metadata(self):
        for content in [b'{"current":', b'/* unclosed {"current":{}}', b'{"value":NaN}', b'null', b'{"current":"bad\xff"}']:
            response, payload = self.json_fixture(content, "Base64")
            with patch.object(bridge, "shopify_graphql", return_value=response):
                with self.assertRaisesRegex(ValueError, "JSON is invalid or incomplete"):
                    bridge.theme_file_chunk(None, payload)

    def test_url_json_uses_http_length_instead_of_file_metadata(self):
        content = b'/* generated */\n{"current":{},"presets":{}}\n'
        response, payload = self.json_fixture(content, "Url", 10)
        remote = io.BytesIO(content)
        remote.status = 200
        remote.headers = {"Content-Length": str(len(content))}
        with patch.object(bridge, "shopify_graphql", return_value=response), patch.object(bridge.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = remote
            result = bridge.theme_file_chunk(None, payload)
            self.assertEqual(base64.b64decode(result["base64Data"]), content)
            self.assertEqual(result["totalSize"], len(content))
            self.assertEqual(result["sourceSize"], 10)
            self.assertEqual(result["contentSha256"], hashlib.sha256(content).hexdigest())

    def test_json_http_truncation_is_not_accepted_as_metadata_difference(self):
        remote = io.BytesIO(b'{"current":{}}')
        remote.status = 200
        remote.headers = {"Content-Length": "100"}
        with patch.object(bridge.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = remote
            with self.assertRaisesRegex(ValueError, "HTTP download was incomplete"):
                bridge.theme_json_url_content("https://storage.googleapis.com/assets/settings.json")


if __name__ == "__main__": unittest.main()
