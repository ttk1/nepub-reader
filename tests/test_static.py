"""static/ のファイルどうしで、同じでなければならない値がそろっていることのテスト

別々のファイルに同じ値を書いている箇所（読み込みの都合で共有できないもの）が、片方だけ変わるのを防ぐ。
"""

import json
import re
import unittest
from pathlib import Path

STATIC = Path(__file__).parent.parent / "nepub_reader" / "static"


def read(name: str) -> str:
    return (STATIC / name).read_text(encoding="utf-8")


class ThemeTest(unittest.TestCase):
    def test_background_before_the_reader_is_ready_matches_the_themes_of_epub_viewer(self):
        # リーダーの準備ができるまでの背景（reader.css）は、epub-viewer のテーマの背景と同じ色にしている。
        # 違うと、開いた直後に色が切り替わって見える
        themes = dict(re.findall(r"(\w+): \{ background: '(#[0-9a-f]{6})'", read("epub-viewer/options.js")))
        self.assertEqual(set(themes), {"light", "sepia", "dark"})
        css = dict(re.findall(r':root\[data-theme="(\w+)"\] body \{ background: (#[0-9a-f]{6});', read("reader.css")))
        # ライトは指定なし（ブラウザの既定の白）
        self.assertEqual(themes.pop("light"), "#ffffff")
        self.assertEqual(css, themes)

    def test_theme_script_reads_the_settings_that_the_reader_saves(self):
        # theme.js は通常のスクリプトなので、history.js の定数を import できず、キーを直接書いている
        storage_key = re.search(r"export const READER_STORAGE_KEY = '([^']+)'", read("history.js"))[1]
        self.assertIn(f"localStorage.getItem('{storage_key}:settings')", read("theme.js"))
        self.assertIn("const SETTINGS_KEY = `${READER_STORAGE_KEY}:settings`", read("reader.js"))

    def test_theme_script_and_the_reader_use_the_same_event(self):
        # リーダーが設定の保存を知らせるイベントと、theme.js が聞くイベント
        dispatched = re.search(r"dispatchEvent\(new Event\('([^']+)'\)\)", read("reader.js"))[1]
        self.assertIn(f"addEventListener('{dispatched}', apply)", read("theme.js"))

    def test_top_page_uses_the_paper_and_ink_of_the_reader_in_every_theme(self):
        # トップページの背景と文字は、リーダー（epub-viewer のテーマ）と同じ色にしている。
        # 違うと、トップページとリーダーを行き来したときに色が切り替わって見える
        themes = re.findall(r"(\w+): \{ background: '(#[0-9a-f]{6})', color: '(#[0-9a-f]{6})'", read("epub-viewer/options.js"))
        self.assertEqual({theme for theme, _, _ in themes}, {"light", "sepia", "dark"})
        css = read("index.css")
        for theme, background, color in themes:
            selector = ":root {" if theme == "light" else f':root[data-theme="{theme}"] {{'
            block = css[css.index(selector) :].split("}")[0]
            found = (re.search(r"--bg: (#[0-9a-f]{6});", block)[1], re.search(r"--text: (#[0-9a-f]{6});", block)[1])
            self.assertEqual(found, (background, color), theme)

    def test_manifest_uses_the_background_of_the_top_page(self):
        # ホーム画面から開いたときの起動画面と上部の帯の色（manifest.json）は、トップページのライトの背景と同じ色にしている
        # （テーマごとには書けないので、既定のライトに合わせる。開いた後の帯の色は theme.js が合わせ直す）
        manifest = json.loads(read("manifest.json"))
        background = re.search(r":root \{[^}]*--bg: (#[0-9a-f]{6});", read("index.css"))[1]
        self.assertEqual((manifest["background_color"], manifest["theme_color"]), (background, background))


if __name__ == "__main__":
    unittest.main()
