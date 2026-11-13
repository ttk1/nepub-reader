"""話の取得と EPUB の生成・キャッシュのテスト（元サイトへはアクセスしない）"""

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest import mock

from nepub_reader import episodes

NAROU_PAGE = """<html><head><title>作品 &amp; 名 - 第12話 はじまり</title></head><body>
<h1 class="p-novel__title">第12話 はじまり</h1>
<div><p id="L1">　本文です。</p><p id="L2"><ruby>漢字<rt>かんじ</rt></ruby>の段落</p></div>
</body></html>"""

NAROU_SHORT_STORY_PAGE = """<html><head><title> 短編の題</title></head><body>
<h1 class="p-novel__title">短編の題</h1>
<div><p id="L1">　短編の本文です。</p></div>
</body></html>"""

NAROU_INDEX_PAGE = """<html><head><title>連載の題</title></head><body>
<h1 class="p-novel__title">連載の題</h1>
<a class="p-eplist__subtitle" href="/n1234ab/1/">第1話</a>
</body></html>"""

KAKUYOMU_PAGE = """<html><head><title>第1話 旅立ち - 作品名（作者名） - カクヨム</title></head><body>
<p class="widget-episodeTitle">第1話 旅立ち</p>
<div><p id="p1">本文です。</p></div>
<a id="contentMain-readPreviousEpisode" class="x" href="/works/100/episodes/199">前</a>
<a href="/works/100/episodes/201" class="x" id="contentMain-readNextEpisode">次</a>
</body></html>"""

KAKUYOMU_WORK_DATA = json.dumps(
    {
        "query": {"workId": "100"},
        "props": {
            "pageProps": {
                "__APOLLO_STATE__": {
                    "Work:100": {
                        "title": "作品名",
                        "author": {"__ref": "UserAccount:1"},
                        "tableOfContentsV2": [{"__ref": "Toc:1"}],
                    },
                    "UserAccount:1": {"activityName": "作者名"},
                    "Toc:1": {"chapter": None, "episodeUnions": [{"__ref": "Episode:200"}, {"__ref": "Episode:201"}]},
                    "Episode:200": {"id": "200", "publishedAt": "2026-01-01T00:00:00Z"},
                    "Episode:201": {"id": "201", "publishedAt": "2026-01-02T00:00:00Z"},
                }
            }
        },
    }
)
KAKUYOMU_WORK_PAGE = f'<html><body><script id="__NEXT_DATA__" type="application/json">{KAKUYOMU_WORK_DATA}</script></body></html>'


class ParseUrlTest(unittest.TestCase):
    def test_narou(self):
        self.assertEqual(episodes.parse_url("https://ncode.syosetu.com/n1234ab/12/"), ("narou", "n1234ab", "12"))
        self.assertEqual(episodes.parse_url(" https://ncode.syosetu.com/N1234AB/ "), ("narou", "n1234ab", None))
        self.assertEqual(episodes.parse_url("http://ncode.syosetu.com/n1234ab/012"), ("narou", "n1234ab", "12"))

    def test_kakuyomu(self):
        self.assertEqual(episodes.parse_url("https://kakuyomu.jp/works/100/episodes/200"), ("kakuyomu", "100", "200"))
        self.assertEqual(episodes.parse_url("https://kakuyomu.jp/works/100"), ("kakuyomu", "100", None))

    def test_scheme_is_optional_and_case_is_ignored(self):
        self.assertEqual(episodes.parse_url("ncode.syosetu.com/n1234ab/12/"), ("narou", "n1234ab", "12"))
        self.assertEqual(episodes.parse_url("HTTPS://NCODE.SYOSETU.COM/N1234AB/12/"), ("narou", "n1234ab", "12"))
        self.assertEqual(episodes.parse_url("Kakuyomu.jp/Works/100/Episodes/200"), ("kakuyomu", "100", "200"))

    def test_query_and_fragment_are_ignored(self):
        self.assertEqual(episodes.parse_url("https://kakuyomu.jp/works/100/episodes/200?x=1#p3"), ("kakuyomu", "100", "200"))

    def test_unsupported(self):
        for url in [
            "",
            "https://example.com/",
            "https://ncode.syosetu.com/",
            "https://ncode.syosetu.com/n1234ab/12/extra",
            "https://evil.example/https://ncode.syosetu.com/n1234ab/1/",
            "https://ncode.syosetu.com.evil.example/n1234ab/1/",
            "javascript:alert(1)",
        ]:
            self.assertIsNone(episodes.parse_url(url), url)


class IsValidEpisodeTest(unittest.TestCase):
    def test_valid(self):
        self.assertTrue(episodes.is_valid_episode("narou", "n1234ab", "1"))
        self.assertTrue(episodes.is_valid_episode("narou", "n1234ab", "10000"))
        self.assertTrue(episodes.is_valid_episode("kakuyomu", "100", "12345678901234567890"))  # 実際のエピソード ID と同じ 20 桁

    def test_invalid(self):
        for site, novel_id, episode in [
            ("narou", "n1234ab", "0"),
            ("narou", "n1234ab", "01"),
            ("narou", "n1234ab", "10001"),
            ("narou", "N1234AB", "1"),
            ("narou", "../etc", "1"),
            ("narou", "n1234ab", "1\n"),
            ("kakuyomu", "100", "abc"),
            ("kakuyomu", "1" * 31, "1"),
            ("other", "100", "1"),
        ]:
            self.assertFalse(episodes.is_valid_episode(site, novel_id, episode), (site, novel_id, episode))


class NovelTitleTest(unittest.TestCase):
    def test_narou(self):
        self.assertEqual(episodes.clean_narou_novel_title("作品名 - 第1話", "第1話"), "作品名")
        self.assertEqual(episodes.clean_narou_novel_title("作品名 - 第1話", ""), "作品名 - 第1話")

    def test_kakuyomu(self):
        clean = episodes.clean_kakuyomu_novel_title
        self.assertEqual(clean("第1話 旅立ち - 作品名（作者名） - カクヨム", "第1話 旅立ち"), "作品名")
        self.assertEqual(clean("第1話 - 作品（上）（作者名） - カクヨム", "第1話"), "作品（上）")
        # 話タイトルが分からなくても、サイト名と作者名は取る
        self.assertEqual(clean("第1話 - 作品名（作者名） - カクヨム", ""), "第1話 - 作品名")


class CacheTestCase(unittest.TestCase):
    """キャッシュ先を一時フォルダにし、元サイトの応答を pages（URL → HTML か例外）で差し替える"""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.cache_dir = Path(tmp.name)
        self.pages: dict[str, str | Exception] = {}
        self.fetched: list[str] = []

        def get(url):
            self.fetched.append(url)
            page = self.pages[url]
            if isinstance(page, Exception):
                raise page
            return page

        # 取得の間隔は、それを確かめるテスト以外では空けない
        for target, value in [("CACHE_DIR", self.cache_dir), ("get", get), ("FETCH_INTERVAL", 0.0)]:
            patcher = mock.patch.object(episodes, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)


def read_epub(path: Path, name: str) -> str:
    with zipfile.ZipFile(path) as zf:
        return zf.read(name).decode("utf-8")


class GetEpubTest(CacheTestCase):
    def test_narou(self):
        self.pages["https://ncode.syosetu.com/n1234ab/12/"] = NAROU_PAGE
        path, adjacent = episodes.get_epub("narou", "n1234ab", "12")

        self.assertEqual(path, self.cache_dir / "v2" / "narou" / "n1234ab_12.epub")
        self.assertIsNone(adjacent)
        # 作品名は <title> から話タイトルを除いたもの（縦中横の加工で話タイトルが変わっても取り除ける）
        self.assertIn("<dc:title id=\"title\">作品 &amp; 名</dc:title>", read_epub(path, "src/content.opf"))
        text = read_epub(path, "src/text/12.xhtml")
        self.assertIn("本文です。", text)
        self.assertIn("<ruby>漢字<rt>かんじ</rt></ruby>", text)
        with zipfile.ZipFile(path) as zf:
            self.assertEqual(zf.namelist()[0], "mimetype")

    def test_narou_with_illustrations(self):
        # 同じ挿絵が 2 回出てくる話。挿絵の取得（nepub のパーサーが行う）は差し替える
        image_url = "//12345.mitemin.net/userpageimage/viewimagebig/icode/i678901/"
        image = {"id": "0123abcd", "name": "0123abcd.png", "type": "image/png", "data": b"png"}
        self.pages["https://ncode.syosetu.com/n1234ab/3/"] = NAROU_PAGE.replace(
            '<p id="L2">', f'<p id="L3"><img alt="挿絵" src="{image_url}"></p><p id="L4"><img src="{image_url}"></p><p id="L2">'
        )
        with mock.patch("nepub.parser.narou.get_image", return_value=image) as get_image:
            path, _ = episodes.get_epub("narou", "n1234ab", "3")

        get_image.assert_called_with(f"https:{image_url}")
        with zipfile.ZipFile(path) as zf:
            self.assertEqual([name for name in zf.namelist() if name.startswith("src/image/")], ["src/image/0123abcd.png"])
            self.assertEqual(zf.read("src/image/0123abcd.png"), b"png")
        self.assertEqual(read_epub(path, "src/content.opf").count('href="image/0123abcd.png"'), 1)
        self.assertIn('<img alt="挿絵" src="../image/0123abcd.png"/>', read_epub(path, "src/text/3.xhtml"))

    def test_narou_is_readable_when_an_illustration_cannot_be_fetched(self):
        # 削除された挿絵など。話のページは取れているので、挿絵なしで読めるようにする
        # （挿絵の 404 を話の 404 として扱うと、リーダーが「最新話です」と誤って知らせる）
        image_url = "//12345.mitemin.net/userpageimage/viewimagebig/icode/i678901/"
        self.pages["https://ncode.syosetu.com/n1234ab/4/"] = NAROU_PAGE.replace('<p id="L2">', f'<p id="L3"><img src="{image_url}"></p><p id="L2">')
        not_found = urllib.error.HTTPError(image_url, 404, "Not Found", None, None)
        with mock.patch("nepub.parser.narou.get_image", side_effect=not_found), self.assertLogs(level="WARNING"):
            path, _ = episodes.get_epub("narou", "n1234ab", "4")

        text = read_epub(path, "src/text/4.xhtml")
        self.assertIn("本文です。", text)
        self.assertNotIn("<img", text)
        self.assertEqual(len(self.fetched), 1)  # 話のページは取り直さない

    def test_narou_is_readable_when_an_illustration_is_not_as_expected(self):
        # nepub のパーサーが想定しない挿絵の URL（例外になる）
        self.pages["https://ncode.syosetu.com/n1234ab/5/"] = NAROU_PAGE.replace('<p id="L2">', '<p id="L3"><img src="https://example.com/x.png"></p><p id="L2">')
        with self.assertLogs(level="WARNING"):
            path, _ = episodes.get_epub("narou", "n1234ab", "5")
        self.assertIn("本文です。", read_epub(path, "src/text/5.xhtml"))

    def test_narou_short_story_is_read_as_the_first_episode(self):
        # 短編は話のページがなく（1 話の URL は 404）、作品ページに本文がある
        not_found = urllib.error.HTTPError("", 404, "Not Found", None, None)
        self.pages["https://ncode.syosetu.com/n1234ab/1/"] = not_found
        self.pages["https://ncode.syosetu.com/n1234ab/"] = NAROU_SHORT_STORY_PAGE
        path, adjacent = episodes.get_epub("narou", "n1234ab", "1")

        self.assertEqual(adjacent, {"prev": None, "next": None})
        self.assertIn("<dc:title id=\"title\">短編の題</dc:title>", read_epub(path, "src/content.opf"))
        self.assertIn("短編の本文です。", read_epub(path, "src/text/1.xhtml"))
        # キャッシュからも、前後の話がないことが返る
        self.assertEqual(episodes.get_epub("narou", "n1234ab", "1"), (path, adjacent))
        self.assertEqual(len(self.fetched), 2)

    def test_narou_missing_episode_is_not_taken_for_a_short_story(self):
        not_found = urllib.error.HTTPError("", 404, "Not Found", None, None)
        # 連載の作品ページには本文がない
        self.pages["https://ncode.syosetu.com/n1234ab/1/"] = not_found
        self.pages["https://ncode.syosetu.com/n1234ab/"] = NAROU_INDEX_PAGE
        with self.assertRaises(urllib.error.HTTPError):
            episodes.get_epub("narou", "n1234ab", "1")
        # 作品そのものがない
        self.pages["https://ncode.syosetu.com/n9999zz/1/"] = not_found
        self.pages["https://ncode.syosetu.com/n9999zz/"] = not_found
        with self.assertRaises(urllib.error.HTTPError):
            episodes.get_epub("narou", "n9999zz", "1")
        # 2 話以降が 404 でも、作品ページは見に行かない
        self.pages["https://ncode.syosetu.com/n1234ab/2/"] = not_found
        fetched = len(self.fetched)
        with self.assertRaises(urllib.error.HTTPError):
            episodes.get_epub("narou", "n1234ab", "2")
        self.assertEqual(len(self.fetched), fetched + 1)
        self.assertEqual(list(self.cache_dir.rglob("*.*")), [])

    def test_cached_episode_is_not_fetched_again(self):
        self.pages["https://ncode.syosetu.com/n1234ab/12/"] = NAROU_PAGE
        episodes.get_epub("narou", "n1234ab", "12")
        episodes.get_epub("narou", "n1234ab", "12")
        self.assertEqual(len(self.fetched), 1)

    def test_simultaneous_requests_fetch_the_episode_once(self):
        self.pages["https://ncode.syosetu.com/n1234ab/12/"] = NAROU_PAGE
        results = []
        threads = [threading.Thread(target=lambda: results.append(episodes.get_epub("narou", "n1234ab", "12"))) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(results), 8)
        self.assertEqual(len(self.fetched), 1)

    def test_kakuyomu(self):
        self.pages["https://kakuyomu.jp/works/100/episodes/200"] = KAKUYOMU_PAGE
        path, adjacent = episodes.get_epub("kakuyomu", "100", "200")

        self.assertEqual(adjacent, {"prev": "199", "next": "201"})
        self.assertIn("<dc:title id=\"title\">作品名</dc:title>", read_epub(path, "src/content.opf"))
        # キャッシュからも前後の話が返る
        self.assertEqual(episodes.get_epub("kakuyomu", "100", "200"), (path, adjacent))
        self.assertEqual(len(self.fetched), 1)

    def test_kakuyomu_with_broken_adjacent_file_is_fetched_again(self):
        self.pages["https://kakuyomu.jp/works/100/episodes/200"] = KAKUYOMU_PAGE
        path, _ = episodes.get_epub("kakuyomu", "100", "200")
        path.with_suffix(".nav.json").write_text("{", encoding="utf-8")

        _, adjacent = episodes.get_epub("kakuyomu", "100", "200")
        self.assertEqual(adjacent, {"prev": "199", "next": "201"})
        self.assertEqual(len(self.fetched), 2)

    def test_page_without_text_is_not_cached(self):
        self.pages["https://ncode.syosetu.com/n1234ab/1/"] = "<html><head><title>エラー</title></head></html>"
        with self.assertRaises(ValueError):
            episodes.get_epub("narou", "n1234ab", "1")
        self.assertEqual(list(self.cache_dir.rglob("*.*")), [])

    def test_http_error_is_passed_on(self):
        url = "https://ncode.syosetu.com/n1234ab/2/"
        self.pages[url] = urllib.error.HTTPError(url, 404, "Not Found", None, None)
        with self.assertRaises(urllib.error.HTTPError):
            episodes.get_epub("narou", "n1234ab", "2")


class FetchIntervalTest(CacheTestCase):
    def test_pages_are_fetched_with_an_interval(self):
        for episode in ["1", "2"]:
            self.pages[f"https://ncode.syosetu.com/n1234ab/{episode}/"] = NAROU_PAGE
        with (
            mock.patch.object(episodes, "FETCH_INTERVAL", 1.0),
            mock.patch.object(episodes, "_last_fetch", 0.0),
            mock.patch.object(episodes.time, "monotonic", return_value=100.0),
            mock.patch.object(episodes.time, "sleep") as sleep,
        ):
            episodes.get_epub("narou", "n1234ab", "1")  # 前の取得から十分たっている
            episodes.get_epub("narou", "n1234ab", "2")  # 直後なので待つ
            episodes.get_epub("narou", "n1234ab", "2")  # キャッシュ済みなら待たない
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [0.0, 1.0])


class CacheMaintenanceTest(CacheTestCase):
    def test_least_recently_read_episodes_are_removed_over_the_limit(self):
        for episode in ["1", "2", "3"]:
            self.pages[f"https://kakuyomu.jp/works/100/episodes/{episode}"] = KAKUYOMU_PAGE
        paths = [episodes.get_epub("kakuyomu", "100", episode)[0] for episode in ["1", "2"]]
        # 1 話を 2 話より後に読んだことにする（更新時刻を、読んだ順に離しておく）
        os.utime(paths[1], (1000, 1000))
        os.utime(paths[0], (2000, 2000))

        with mock.patch.object(episodes, "MAX_CACHE_BYTES", paths[0].stat().st_size * 2.5):  # 2 話分まで
            newest, _ = episodes.get_epub("kakuyomu", "100", "3")

        self.assertTrue(paths[0].exists())
        self.assertFalse(paths[1].exists())
        self.assertFalse(paths[1].with_suffix(".nav.json").exists())
        self.assertTrue(newest.exists())

    def test_reading_an_episode_makes_it_recent(self):
        self.pages["https://ncode.syosetu.com/n1234ab/12/"] = NAROU_PAGE
        path, _ = episodes.get_epub("narou", "n1234ab", "12")
        os.utime(path, (1000, 1000))
        episodes.get_epub("narou", "n1234ab", "12")
        self.assertGreater(path.stat().st_mtime, 1000)

    def test_broken_cache_is_made_again(self):
        # 途中で切れたファイルなど。そのまま返すと、リーダーは何度やり直しても開けない
        self.pages["https://ncode.syosetu.com/n1234ab/12/"] = NAROU_PAGE
        path, _ = episodes.get_epub("narou", "n1234ab", "12")
        path.write_bytes(path.read_bytes()[:100])

        episodes.get_epub("narou", "n1234ab", "12")
        self.assertEqual(len(self.fetched), 2)
        self.assertTrue(zipfile.is_zipfile(path))

    def test_cache_is_used_even_if_it_cannot_be_touched(self):
        # 読み取り専用のキャッシュなど。更新時刻を変えられなくても、あるものは使う
        self.pages["https://ncode.syosetu.com/n1234ab/12/"] = NAROU_PAGE
        path, _ = episodes.get_epub("narou", "n1234ab", "12")
        with mock.patch.object(episodes.os, "utime", side_effect=PermissionError("read-only")):
            self.assertEqual(episodes.get_epub("narou", "n1234ab", "12"), (path, None))
        self.assertEqual(len(self.fetched), 1)

    def test_failing_to_remove_old_caches_does_not_stop_the_server(self):
        old = self.cache_dir / "old.epub"
        old.write_bytes(b"old")
        with mock.patch.object(Path, "unlink", side_effect=PermissionError("denied")), self.assertLogs(level="WARNING"):
            episodes.remove_old_caches()

    def test_caches_of_old_versions_are_removed(self):
        self.pages["https://ncode.syosetu.com/n1234ab/12/"] = NAROU_PAGE
        path, _ = episodes.get_epub("narou", "n1234ab", "12")
        old = self.cache_dir / "narou" / "n1234ab_1.epub"
        old.parent.mkdir()
        old.write_bytes(b"old")

        leftover = path.with_name("n1234ab_13.epub.x.tmp")
        leftover.write_bytes(b"partial")

        episodes.remove_old_caches()
        self.assertFalse(old.parent.exists())
        self.assertFalse(leftover.exists())
        self.assertTrue(path.exists())


class KakuyomuTest(CacheTestCase):
    def test_refresh_adjacent_updates_only_the_adjacent_file(self):
        url = "https://kakuyomu.jp/works/100/episodes/200"
        self.pages[url] = KAKUYOMU_PAGE.replace("/episodes/201", "/episodes/none")  # 次の話がまだない
        path, adjacent = episodes.get_epub("kakuyomu", "100", "200")
        self.assertEqual(adjacent, {"prev": "199", "next": None})
        modified = path.stat().st_mtime_ns

        self.pages[url] = KAKUYOMU_PAGE
        self.assertEqual(episodes.refresh_kakuyomu_adjacent("100", "200"), {"prev": "199", "next": "201"})
        self.assertEqual(episodes.get_epub("kakuyomu", "100", "200"), (path, {"prev": "199", "next": "201"}))
        self.assertEqual(path.stat().st_mtime_ns, modified)

    def test_first_episode(self):
        self.pages["https://kakuyomu.jp/works/100"] = KAKUYOMU_WORK_PAGE
        self.assertEqual(episodes.first_episode("kakuyomu", "100"), "200")
        self.assertEqual(episodes.first_episode("narou", "n1234ab"), "1")
        self.assertEqual(len(self.fetched), 1)


if __name__ == "__main__":
    unittest.main()
