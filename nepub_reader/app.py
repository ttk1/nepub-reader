import datetime
import html
import json
import logging
import os
import re
import tempfile
import zipfile
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory
from nepub.epub import container, content, nav, text
from nepub.http import get
from nepub.parser.kakuyomu import KakuyomuEpisodeParser
from nepub.parser.narou import NarouEpisodeParser
from werkzeug.security import safe_join


def style() -> str:
    """カスタムスタイルシート（行間を調整）"""
    return """body {
	writing-mode: vertical-rl;
	-webkit-writing-mode: vertical-rl;
	-epub-writing-mode: vertical-rl;
	line-height: 1.7;
}

h1 {
	text-align: center;
	margin-top: 2em;
	margin-bottom: 2em;
}

p {
	margin: 0;
	padding: 0;
}

span.tcy {
	writing-mode: horizontal-tb;
	-webkit-writing-mode: horizontal-tb;
	-epub-writing-mode: horizontal-tb;
	line-height: 1;
}
"""


# ロギング設定
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

# プロジェクトルート
PROJECT_ROOT = Path(__file__).parent.parent

app = Flask(__name__, static_folder=None)

# Bibi の静的ファイルパス
BIBI_DIR = PROJECT_ROOT / "bibi"
BOOKSHELF_DIR = PROJECT_ROOT / "bibi-bookshelf"

# EPUB キャッシュディレクトリ（サイトごとに分離）
NAROU_CACHE_DIR = BOOKSHELF_DIR / "narou"
NAROU_CACHE_DIR.mkdir(parents=True, exist_ok=True)
KAKUYOMU_CACHE_DIR = BOOKSHELF_DIR / "kakuyomu"
KAKUYOMU_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# なろうURLパース用の正規表現
NAROU_URL_PATTERN = re.compile(
    r"https?://ncode\.syosetu\.com/([a-zA-Z0-9]+)(?:/(\d+))?/?"
)

# カクヨムURLパース用の正規表現
KAKUYOMU_URL_PATTERN = re.compile(
    r"https?://kakuyomu\.jp/works/(\d+)(?:/episodes/(\d+))?/?"
)

# カクヨムエピソードページから前後エピソードIDを抽出する正規表現
KAKUYOMU_PREV_EPISODE_PATTERN = re.compile(
    r'id="contentMain-readPreviousEpisode"\s+href="/works/\d+/episodes/(\d+)'
)
KAKUYOMU_NEXT_EPISODE_PATTERN = re.compile(
    r'href="/works/\d+/episodes/(\d+)"\s+id="contentMain-readNextEpisode"'
)


def parse_narou_url(url: str) -> tuple[str | None, int | None]:
    """なろうのURLから小説IDとエピソード番号を抽出"""
    match = NAROU_URL_PATTERN.match(url.strip())
    if not match:
        return None, None
    novel_id = match.group(1)
    episode = int(match.group(2)) if match.group(2) else None
    return novel_id, episode


def parse_kakuyomu_url(url: str) -> tuple[str | None, str | None]:
    """カクヨムのURLから作品IDとエピソードIDを抽出"""
    match = KAKUYOMU_URL_PATTERN.match(url.strip())
    if not match:
        return None, None
    work_id = match.group(1)
    episode_id = match.group(2)
    return work_id, episode_id


def extract_novel_title(html_content: str) -> str | None:
    """エピソードページのHTMLから小説タイトルを抽出"""
    # <title>作品タイトル - エピソードタイトル</title> から取得
    match = re.search(r"<title>(.+?)</title>", html_content)
    if match:
        return html.escape(match.group(1).strip())
    return None


def extract_kakuyomu_adjacent_episodes(
    html_content: str,
) -> tuple[str | None, str | None]:
    """カクヨムのエピソードHTMLから前後のエピソードIDを抽出"""
    prev_match = KAKUYOMU_PREV_EPISODE_PATTERN.search(html_content)
    next_match = KAKUYOMU_NEXT_EPISODE_PATTERN.search(html_content)
    prev_id = prev_match.group(1) if prev_match else None
    next_id = next_match.group(1) if next_match else None
    return prev_id, next_id


def get_narou_cache_path(novel_id: str, episode_num: int) -> Path:
    """なろうの EPUB キャッシュファイルパスを生成"""
    return NAROU_CACHE_DIR / f"{novel_id}_{episode_num}.epub"


def get_kakuyomu_cache_path(work_id: str, episode_id: str) -> Path:
    """カクヨムの EPUB キャッシュファイルパスを生成"""
    return KAKUYOMU_CACHE_DIR / f"{work_id}_{episode_id}.epub"


def build_epub(
    cache_path: Path,
    novel_title: str,
    episode_id: str,
    episode_title: str,
    paragraphs: list,
    images: list,
    metadata: dict,
) -> Path:
    """EPUB ファイルを生成して cache_path に保存"""
    timestamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")

    episodes = [
        {
            "id": episode_id,
            "title": episode_title,
            "paragraphs": paragraphs,
            "fetched": True,
        }
    ]

    chapters = [{"name": "default", "episodes": episodes}]

    # 画像の重複除去
    unique_images = []
    image_ids = set()
    for image in images:
        if image["id"] not in image_ids:
            image_ids.add(image["id"])
            unique_images.append(
                {
                    "id": image["id"],
                    "name": image["name"],
                    "type": image["type"],
                }
            )

    metadata["episodes"] = {
        episode_id: {
            "id": episode_id,
            "title": episode_title,
            "created_at": "",
            "updated_at": "",
            "images": unique_images,
        }
    }

    with tempfile.NamedTemporaryFile(
        prefix=f"{cache_path.stem}_", suffix=".epub", dir=cache_path.parent, delete=False
    ) as tmp_file:
        tmp_file_name = tmp_file.name
        with zipfile.ZipFile(
            tmp_file, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as zf:
            zf.writestr(
                "mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED
            )
            zf.writestr("META-INF/container.xml", container())
            zf.writestr("src/style.css", style())
            zf.writestr(
                "src/content.opf",
                content(novel_title, "", timestamp, episodes, unique_images),
            )
            zf.writestr("src/navigation.xhtml", nav(chapters))
            zf.writestr("src/metadata.json", json.dumps(metadata))
            zf.writestr(
                f"src/text/{episode_id}.xhtml",
                text(episode_title, paragraphs),
            )
            for image in images:
                if image["id"] in image_ids:
                    zf.writestr(f"src/image/{image['name']}", image["data"])

    Path(tmp_file_name).replace(cache_path)
    return cache_path


def generate_narou_epub(novel_id: str, episode_num: int) -> Path:
    """なろうのエピソードからEPUBを生成（1話単位）"""
    cache_path = get_narou_cache_path(novel_id, episode_num)

    if cache_path.exists():
        return cache_path

    episode_url = f"https://ncode.syosetu.com/{novel_id}/{episode_num}/"
    html_content = get(episode_url)

    novel_title = extract_novel_title(html_content) or novel_id

    parser = NarouEpisodeParser(include_images=True, convert_tcy=True)
    parser.feed(html_content)

    episode_id = str(episode_num)
    metadata = {
        "novel_id": novel_id,
        "kakuyomu": False,
        "illustration": True,
        "tcy": True,
    }

    return build_epub(
        cache_path,
        novel_title,
        episode_id,
        parser.title,
        parser.paragraphs,
        parser.images,
        metadata,
    )


def generate_kakuyomu_epub(
    work_id: str, episode_id: str
) -> tuple[Path, str | None, str | None]:
    """カクヨムのエピソードからEPUBを生成（1話単位）

    Returns:
        (cache_path, prev_episode_id, next_episode_id)
    """
    cache_path = get_kakuyomu_cache_path(work_id, episode_id)
    nav_path = cache_path.with_suffix(".nav.json")

    # キャッシュがあればナビゲーション情報も読み込んで返す
    if cache_path.exists() and nav_path.exists():
        nav_data = json.loads(nav_path.read_text(encoding="utf-8"))
        return cache_path, nav_data.get("prev"), nav_data.get("next")

    episode_url = f"https://kakuyomu.jp/works/{work_id}/episodes/{episode_id}"
    html_content = get(episode_url)

    novel_title = extract_novel_title(html_content) or work_id

    parser = KakuyomuEpisodeParser(convert_tcy=True)
    parser.feed(html_content)

    # 前後のエピソードIDを抽出
    prev_ep_id, next_ep_id = extract_kakuyomu_adjacent_episodes(html_content)

    metadata = {
        "novel_id": work_id,
        "kakuyomu": True,
        "illustration": False,
        "tcy": True,
    }

    build_epub(
        cache_path,
        novel_title,
        episode_id,
        parser.title,
        parser.paragraphs,
        [],
        metadata,
    )

    # ナビゲーション情報を別ファイルに保存（キャッシュヒット時も参照できるように）
    nav_path.write_text(
        json.dumps({"prev": prev_ep_id, "next": next_ep_id}), encoding="utf-8"
    )

    return cache_path, prev_ep_id, next_ep_id


@app.route("/")
def index():
    """トップページ - 使い方を表示"""
    return render_template("index.html")


@app.route("/go")
def go():
    """URLからリダイレクト"""
    url = request.args.get("url", "").strip()
    if not url:
        return redirect("/")

    # なろう
    novel_id, episode = parse_narou_url(url)
    if novel_id:
        episode = episode or 1
        return redirect(f"/read/narou/{novel_id}/{episode}")

    # カクヨム
    work_id, episode_id = parse_kakuyomu_url(url)
    if work_id:
        if not episode_id:
            return "カクヨムのURLにはエピソードIDが必要です。エピソードページのURLを入力してください。", 400
        return redirect(f"/read/kakuyomu/{work_id}/{episode_id}")

    return "無効なURLです。小説家になろうまたはカクヨムのURLを入力してください。", 400


@app.route("/read/narou/<novel_id>/<int:episode>")
def read_narou_episode(novel_id: str, episode: int):
    """なろうのエピソードを Bibi で表示"""
    if not re.match(r"^[a-zA-Z0-9]+$", novel_id) or len(novel_id) > 20:
        return "無効な小説IDです", 400
    if episode < 1 or episode > 10000:
        return "エピソード番号は1〜10000の範囲で指定してください", 400

    try:
        generate_narou_epub(novel_id, episode)
    except (IOError, ValueError) as e:
        logging.error(
            f"EPUB生成エラー: novel_id={novel_id}, episode={episode}, error={e}"
        )
        return "EPUB の生成に失敗しました。URLを確認してください。", 500
    except Exception:
        logging.exception(f"予期しないエラー: novel_id={novel_id}, episode={episode}")
        return "EPUB の生成に失敗しました", 500

    epub_filename = f"{novel_id}_{episode}.epub"
    return redirect(f"/bibi/index.html?book=narou/{epub_filename}")


@app.route("/read/kakuyomu/<work_id>/<episode_id>")
def read_kakuyomu_episode(work_id: str, episode_id: str):
    """カクヨムのエピソードを Bibi で表示"""
    if not re.match(r"^\d+$", work_id) or len(work_id) > 30:
        return "無効な作品IDです", 400
    if not re.match(r"^\d+$", episode_id) or len(episode_id) > 30:
        return "無効なエピソードIDです", 400

    try:
        _, prev_ep, next_ep = generate_kakuyomu_epub(work_id, episode_id)
    except (IOError, ValueError) as e:
        logging.error(
            f"EPUB生成エラー: work_id={work_id}, episode_id={episode_id}, error={e}"
        )
        return "EPUB の生成に失敗しました。URLを確認してください。", 500
    except Exception:
        logging.exception(
            f"予期しないエラー: work_id={work_id}, episode_id={episode_id}"
        )
        return "EPUB の生成に失敗しました", 500

    epub_filename = f"{work_id}_{episode_id}.epub"
    url = f"/bibi/index.html?book=kakuyomu/{epub_filename}"
    if prev_ep:
        url += f"&prev={prev_ep}"
    if next_ep:
        url += f"&next={next_ep}"
    return redirect(url)


@app.route("/api/kakuyomu/next-episode/<work_id>/<episode_id>")
def check_kakuyomu_next_episode(work_id: str, episode_id: str):
    """カクヨムの最新話チェック: 現在のエピソードページを再取得して次話の有無を確認"""
    if not re.match(r"^\d+$", work_id) or len(work_id) > 30:
        return jsonify({"error": "無効な作品IDです"}), 400
    if not re.match(r"^\d+$", episode_id) or len(episode_id) > 30:
        return jsonify({"error": "無効なエピソードIDです"}), 400

    try:
        episode_url = f"https://kakuyomu.jp/works/{work_id}/episodes/{episode_id}"
        html_content = get(episode_url)
        _, next_id = extract_kakuyomu_adjacent_episodes(html_content)

        if next_id:
            # 次話が見つかった場合、古いキャッシュを削除して次回生成時に正しいメタデータが入るようにする
            cache_path = get_kakuyomu_cache_path(work_id, episode_id)
            if cache_path.exists():
                cache_path.unlink()
            nav_path = cache_path.with_suffix(".nav.json")
            if nav_path.exists():
                nav_path.unlink()

            return jsonify({"next_episode_id": next_id})
        else:
            return jsonify({"next_episode_id": None})
    except Exception:
        logging.exception(
            f"最新話チェックエラー: work_id={work_id}, episode_id={episode_id}"
        )
        return jsonify({"error": "チェックに失敗しました"}), 500


@app.route("/bibi/<path:filename>")
def serve_bibi(filename: str):
    """Bibi の静的ファイルを配信"""
    return send_from_directory(BIBI_DIR, filename)


@app.route("/bibi-bookshelf/<path:filename>")
def serve_bookshelf(filename: str):
    """既存の bookshelf ファイルを配信

    Bibi が suffix range (bytes=-N) でファイルサイズより大きな値を要求すると、
    Flask/Werkzeug が 416 Range Not Satisfiable を返してしまう問題への対策を含む。
    """
    range_header = request.headers.get("Range", "")

    # suffix range (bytes=-N) 以外は通常処理
    if not range_header.startswith("bytes=-"):
        return send_from_directory(BOOKSHELF_DIR, filename)

    # Range ヘッダーのパース
    try:
        suffix_length = int(range_header[7:])
    except ValueError:
        return "Invalid Range header", 400

    # パストラバーサル対策
    safe_path = safe_join(str(BOOKSHELF_DIR), filename)
    if not safe_path:
        return "Invalid path", 400

    # ファイル存在チェック
    if not os.path.isfile(safe_path):
        return "Not found", 404

    # suffix_length がファイルサイズ未満なら通常の Range 処理で OK
    file_size = os.path.getsize(safe_path)
    if suffix_length < file_size:
        return send_from_directory(BOOKSHELF_DIR, filename)

    # suffix_length >= file_size の場合、Flask が 416 を返すのを回避
    # ファイル全体を 206 Partial Content で返す
    response = send_from_directory(BOOKSHELF_DIR, filename, conditional=False)
    response.status_code = 206
    response.headers["Content-Range"] = f"bytes 0-{file_size - 1}/{file_size}"
    response.headers["Accept-Ranges"] = "bytes"
    return response


def main():
    """サーバーを起動"""
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    print("nepub-reader を起動中...")
    print(f"http://localhost:{port}/ でアクセスできます")
    app.run(host="0.0.0.0", port=port, debug=debug)


if __name__ == "__main__":
    main()
