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


class BrandColorTest(unittest.TestCase):
    def test_brand_color_stands_out_from_the_page_in_every_theme(self):
        # アイコンの朱（--brand）は、見出しの印の線と、進み具合の線に使っていて、テーマごとに色を書いている。
        # 背景を変えたときに見えにくいまま残らないように、どのテーマでも、ページの背景（--bg）と、進み具合の線を置く
        # 面（--surface）に対して 3:1 以上（文字でない図の目安）であることを確かめる
        def luminance(color: str) -> float:
            channels = [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
            r, g, b = (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels)
            return 0.2126 * r + 0.7152 * g + 0.0722 * b

        css = read("index.css")
        for theme in ["light", "sepia", "dark"]:
            selector = ":root {" if theme == "light" else f':root[data-theme="{theme}"] {{'
            block = css[css.index(selector) :].split("}")[0]
            brand = luminance(re.search(r"--brand: (#[0-9a-f]{6});", block)[1])
            for name in ["--bg", "--surface"]:
                background = luminance(re.search(rf"{name}: (#[0-9a-f]{{6}});", block)[1])
                lighter, darker = max(brand, background), min(brand, background)
                self.assertGreaterEqual((lighter + 0.05) / (darker + 0.05), 3, f"{theme} {name}")


class PageMarginTest(unittest.TestCase):
    def test_margins_grow_with_the_toolbar_and_keep_room_for_the_progress_text(self):
        # ツールバーを隠している間の進み具合の文字（reader.css）は、ページの下の余白に重ねて出す。
        # 余白の選択肢（reader.js）は、いちばん狭いものでも文字が本文に重ならない広さにしていて、
        # 広い画面では、文字を大きくするのと同じ幅から、同じ倍率で広げている。片方だけ変えると、文字が本文に重なる
        css = read("reader.css")
        wide = re.findall(
            r"@media \(min-width: (\d+)px\) \{ \.epub-reader > \.toolbar, #status \{ zoom: ([\d.]+); \} \.epub-reader \{ --mini-size: (\d+)px; \} \}",
            css,
        )
        self.assertEqual(len(wide), 3)
        js = read("reader.js")
        scales = json.loads(re.search(r"const WIDE_SCALES = (\[\[.*\]\])", js)[1])
        self.assertEqual(scales, [[int(width), float(zoom)] for width, zoom, _ in wide])

        narrowest = int(re.search(r"const MARGINS = \[\[(\d+)", js)[1])
        size = int(re.search(r"\.epub-reader \{ --mini-size: (\d+)px; \}", css)[1])
        below = int(re.search(r"\.mini-text \{[^}]*\bbottom: (\d+)px;", css)[1])
        gap = 6  # 文字と本文の間。行末は余白ぴったりまで届くので、間がないとくっついて見える
        for scale, text in [(1, size)] + [(float(zoom), int(mini)) for _, zoom, mini in wide]:
            self.assertGreaterEqual(narrowest * scale, text + below + gap, f"{scale} 倍")


if __name__ == "__main__":
    unittest.main()
