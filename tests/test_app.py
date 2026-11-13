"""ルーティングのテスト（話の取得は差し替える）"""

import re
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

from nepub_reader import episodes
from nepub_reader.app import READER_MODULES, app


class AppTestCase(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def patch(self, name, **kwargs):
        patcher = mock.patch.object(episodes, name, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()


class PagesTest(AppTestCase):
    def test_index(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn('id="history-list"', res.get_data(as_text=True))

    def test_manifest_and_icons(self):
        # ホーム画面に追加したときのアイコンと、全画面での表示
        for page in ["/", "/read/narou/n1234ab/1"]:
            body = self.client.get(page).get_data(as_text=True)
            self.assertIn('<link rel="manifest" href="/static/manifest.json">', body)
            self.assertIn('<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">', body)
            self.assertIn('<link rel="icon" href="/static/icon.svg" type="image/svg+xml">', body)
        res = self.client.get("/static/manifest.json")
        manifest = res.get_json()
        res.close()
        self.assertEqual((manifest["start_url"], manifest["display"]), ("/", "standalone"))
        for icon in [*manifest["icons"], {"src": "/static/apple-touch-icon.png"}]:
            res = self.client.get(icon["src"])
            self.assertEqual(res.status_code, 200, icon["src"])
            res.close()

    def test_security_headers(self):
        res = self.client.get("/")
        csp = res.headers["Content-Security-Policy"]
        self.assertIn("script-src 'self'", csp)
        self.assertIn("frame-ancestors 'self'", csp)
        self.assertEqual(res.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(res.headers["X-Frame-Options"], "DENY")
        self.assertEqual(res.headers["Referrer-Policy"], "same-origin")
        self.assertEqual(res.headers["X-Robots-Tag"], "noindex, nofollow")

    def test_unknown_page_is_shown_on_index(self):
        res = self.client.get("/nothing", headers={"Accept": "text/html"})
        self.assertEqual(res.status_code, 404)
        self.assertIn("ページが見つかりません", res.get_data(as_text=True))
        # ページとして開かれたのでなければ（画像やスクリプトの読み込みなど）、短い文だけを返す
        res = self.client.get("/static/nothing.js", headers={"Accept": "*/*"})
        self.assertEqual((res.status_code, res.get_data(as_text=True)), (404, "見つかりません"))

    def test_reader(self):
        self.assertEqual(self.client.get("/read/narou/n1234ab/1").status_code, 200)
        self.assertEqual(self.client.get("/read/kakuyomu/100/200").status_code, 200)

    def test_reader_preloads_its_modules(self):
        body = self.client.get("/read/narou/n1234ab/1").get_data(as_text=True)
        for module in ["reader.js", "history.js", "sites.js", "epub-viewer/index.js", "epub-viewer/viewer.js", "epub-viewer/zip.js"]:
            self.assertIn(f'<link rel="modulepreload" href="/static/{module}">', body)
        # 知らせたものは、どれも実際にある
        for href in re.findall(r'rel="modulepreload" href="([^"]+)"', body):
            res = self.client.get(href)
            self.assertEqual(res.status_code, 200, href)
            res.close()

    def test_reader_preloads_every_module_it_imports(self):
        # reader.js から順にたどれるモジュールが、すべて先読みの一覧にあること
        # （足し忘れると、そのモジュールだけ後から見つかって、読み込みが 1 往復ぶん遅くなる）
        static = Path(app.static_folder)
        found, queue = set(), ["reader.js"]
        while queue:
            module = queue.pop()
            if module in found:
                continue
            found.add(module)
            source = (static / module).read_text(encoding="utf-8")
            for imported in re.findall(r"""^(?:import|export)\b[^'"]*?from\s+['"](\.[^'"]+)['"]""", source, re.M):
                queue.append((Path(module).parent / imported).as_posix())
        self.assertGreater(len(found), 10)
        self.assertEqual(sorted(READER_MODULES), sorted(found))

    def test_reader_rejects_invalid_episode(self):
        for path in ["/read/narou/n1234ab/0", "/read/kakuyomu/abc/1", "/read/other/1/1"]:
            res = self.client.get(path)
            self.assertEqual(res.status_code, 404, path)
            self.assertIn('role="alert"', res.get_data(as_text=True))

    def test_reader_redirects_uppercase_narou_id(self):
        res = self.client.get("/read/narou/N1234AB/3")
        self.assertEqual(res.status_code, 302)
        self.assertEqual(res.headers["Location"], "/read/narou/n1234ab/3")


class GoTest(AppTestCase):
    def go(self, url):
        return self.client.get("/go", query_string={"url": url})

    def test_episode_url(self):
        res = self.go("https://ncode.syosetu.com/N1234AB/12/")
        self.assertEqual((res.status_code, res.headers["Location"]), (302, "/read/narou/n1234ab/12"))
        res = self.go("https://kakuyomu.jp/works/100/episodes/200")
        self.assertEqual((res.status_code, res.headers["Location"]), (302, "/read/kakuyomu/100/200"))

    def test_novel_url_opens_first_episode(self):
        first_episode = self.patch("first_episode", return_value="200")
        res = self.go("https://kakuyomu.jp/works/100")
        self.assertEqual((res.status_code, res.headers["Location"]), (302, "/read/kakuyomu/100/200"))
        first_episode.assert_called_once_with("kakuyomu", "100")

    def test_from_other_sites_only_as_a_page(self):
        first_episode = self.patch("first_episode", return_value="200")
        url = {"url": "https://kakuyomu.jp/works/100"}
        res = self.client.get("/go", query_string=url, headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "image"})
        self.assertEqual(res.status_code, 403)
        first_episode.assert_not_called()
        res = self.client.get("/go", query_string=url, headers={"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "document"})
        self.assertEqual(res.status_code, 302)

    def test_empty_url(self):
        res = self.go("")
        self.assertEqual((res.status_code, res.headers["Location"]), (302, "/"))

    def test_error_is_shown_on_index_with_the_url_escaped(self):
        res = self.go('https://example.com/"><script>alert(1)</script>')
        body = res.get_data(as_text=True)
        self.assertEqual(res.status_code, 400)
        self.assertIn('role="alert"', body)
        self.assertIn("対応していない URL です", body)
        self.assertNotIn("<script>alert(1)</script>", body)
        self.assertIn("&lt;script&gt;", body)

    def test_unsupported_site_is_explained(self):
        res = self.go("https://novel18.syosetu.com/n1234ab/1/")
        self.assertEqual(res.status_code, 400)
        self.assertIn("novel18.syosetu.com）の作品には対応していません", res.get_data(as_text=True))

    def test_invalid_id(self):
        first_episode = self.patch("first_episode")
        self.assertEqual(self.go("https://ncode.syosetu.com/" + "n" * 21 + "/").status_code, 400)
        self.assertEqual(self.go("https://ncode.syosetu.com/n1234ab/99999/").status_code, 400)
        first_episode.assert_not_called()

    def test_novel_without_episodes(self):
        self.patch("first_episode", side_effect=urllib.error.HTTPError("", 404, "Not Found", None, None))
        with self.assertLogs(level="ERROR"):
            res = self.go("https://kakuyomu.jp/works/100")
        self.assertEqual(res.status_code, 400)
        self.assertIn("最初の話が見つかりませんでした", res.get_data(as_text=True))


class EpubTest(AppTestCase):
    def setUp(self):
        super().setUp()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.epub = Path(tmp.name) / "episode.epub"
        self.epub.write_bytes(b"epub")

    def test_narou(self):
        get_epub = self.patch("get_epub", return_value=(self.epub, None))
        res = self.client.get("/epub/narou/n1234ab/12")
        self.assertEqual((res.status_code, res.data, res.mimetype), (200, b"epub", "application/epub+zip"))
        self.assertNotIn("X-Next-Episode", res.headers)
        get_epub.assert_called_once_with("narou", "n1234ab", "12")
        res.close()

    def test_kakuyomu_returns_adjacent_episodes(self):
        self.patch("get_epub", return_value=(self.epub, {"prev": None, "next": "201"}))
        res = self.client.get("/epub/kakuyomu/100/200")
        self.assertEqual((res.headers["X-Prev-Episode"], res.headers["X-Next-Episode"]), ("", "201"))
        res.close()

    def test_invalid_episode_is_not_fetched(self):
        get_epub = self.patch("get_epub")
        self.assertEqual(self.client.get("/epub/narou/n1234ab/0").status_code, 404)
        get_epub.assert_not_called()

    def test_errors(self):
        for error, status in [
            (urllib.error.HTTPError("", 404, "Not Found", None, None), 404),
            (urllib.error.HTTPError("", 503, "Unavailable", None, None), 502),
            (urllib.error.URLError("timed out"), 502),
            (ValueError("本文を抽出できませんでした"), 500),
        ]:
            with mock.patch.object(episodes, "get_epub", side_effect=error), self.assertLogs(level="ERROR"):
                self.assertEqual(self.client.get("/epub/narou/n1234ab/1").status_code, status, error)

    def test_narou_short_story_has_no_adjacent_episodes(self):
        self.patch("get_epub", return_value=(self.epub, {"prev": None, "next": None}))
        res = self.client.get("/epub/narou/n1234ab/1")
        self.assertEqual((res.headers["X-Prev-Episode"], res.headers["X-Next-Episode"]), ("", ""))
        res.close()

    def test_requests_from_other_sites_are_rejected(self):
        get_epub = self.patch("get_epub", return_value=(self.epub, None))
        refresh = self.patch("refresh_kakuyomu_adjacent", return_value={"prev": None, "next": None})
        for site in ["cross-site", "same-site"]:
            headers = {"Sec-Fetch-Site": site}
            self.assertEqual(self.client.get("/epub/narou/n1234ab/1", headers=headers).status_code, 403)
            self.assertEqual(self.client.get("/api/kakuyomu/next-episode/100/200", headers=headers).status_code, 403)
        get_epub.assert_not_called()
        refresh.assert_not_called()
        # このアプリの画面からと、アドレスバーからは使える
        for site in ["same-origin", "none"]:
            res = self.client.get("/epub/narou/n1234ab/1", headers={"Sec-Fetch-Site": site})
            self.assertEqual(res.status_code, 200)
            res.close()


class NextEpisodeTest(AppTestCase):
    def test_next_episode(self):
        refresh = self.patch("refresh_kakuyomu_adjacent", return_value={"prev": "199", "next": "201"})
        res = self.client.get("/api/kakuyomu/next-episode/100/200")
        self.assertEqual((res.status_code, res.get_json()), (200, {"next_episode_id": "201"}))
        refresh.assert_called_once_with("100", "200")

    def test_failure(self):
        self.patch("refresh_kakuyomu_adjacent", side_effect=urllib.error.URLError("timed out"))
        with self.assertLogs(level="ERROR"):
            res = self.client.get("/api/kakuyomu/next-episode/100/200")
        self.assertEqual((res.status_code, res.get_json()), (502, {"error": "最新話の確認に失敗しました"}))


if __name__ == "__main__":
    unittest.main()
