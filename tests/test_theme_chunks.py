"""Run: python -m unittest discover -s tests -p 'test_theme_chunks.py' -v."""
import base64
import hashlib
import importlib.util
import io
import json
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

    def test_asset_cdn_allowlist_covers_redirects(self):
        self.assertEqual(bridge.theme_cdn_url("https://cdn.shopify.com/a"), "https://cdn.shopify.com/a")
        for url in ["http://cdn.shopify.com/a", "https://cdn.shopify.com.evil.example/a", "https://127.0.0.1/a", "https://name:secret@cdn.shopify.com/a"]:
            with self.assertRaises(ValueError): bridge.theme_cdn_url(url)
        with self.assertRaises(ValueError):
            bridge.ThemeAssetRedirect().redirect_request(None, None, 302, "", {}, "https://127.0.0.1/a")

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


if __name__ == "__main__": unittest.main()
