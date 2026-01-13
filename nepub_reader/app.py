import os
import re
import tempfile
import json
import datetime
import zipfile
import email.utils
import logging
from pathlib import Path
from flask import Flask, redirect, abort, send_from_directory, Response, request, render_template

from nepub.parser.narou import NarouEpisodeParser
from nepub.http import get
from nepub.epub import container, content, nav, style, text

# ロギング設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# プロジェクトルート
PROJECT_ROOT = Path(__file__).parent.parent

app = Flask(__name__, static_folder=None)

# Bibi の静的ファイルパス
BIBI_DIR = PROJECT_ROOT / "bibi"
BOOKSHELF_DIR = PROJECT_ROOT / "bibi-bookshelf"

# EPUB キャッシュディレクトリ（bibi-bookshelf 内に保存）
CACHE_DIR = BOOKSHELF_DIR / "narou"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# なろうURLパース用の正規表現
NAROU_URL_PATTERN = re.compile(
    r"https?://ncode\.syosetu\.com/([a-zA-Z0-9]+)(?:/(\d+))?/?"
)


def parse_narou_url(url: str) -> tuple[str | None, int | None]:
    """なろうのURLから小説IDとエピソード番号を抽出"""
    match = NAROU_URL_PATTERN.match(url.strip())
    if not match:
        return None, None
    novel_id = match.group(1)
    episode = int(match.group(2)) if match.group(2) else None
    return novel_id, episode


def get_cache_filename(novel_id: str, episode_num: int) -> str:
    """EPUB のキャッシュファイル名を生成"""
    return f"{novel_id}_{episode_num}.epub"


def get_cache_path(novel_id: str, episode_num: int) -> Path:
    """EPUB のキャッシュファイルパスを生成"""
    return CACHE_DIR / get_cache_filename(novel_id, episode_num)


def extract_novel_title(html_content: str) -> str | None:
    """エピソードページのHTMLから小説タイトルを抽出"""
    import html
    # <title>作品タイトル - エピソードタイトル</title> から取得
    match = re.search(r'<title>(.+?)</title>', html_content)
    if match:
        return html.escape(match.group(1).strip())
    return None


def generate_epub_direct(novel_id: str, episode_num: int) -> Path:
    """目次を読み込まずに、エピソード番号から直接EPUBを生成（1話単位）"""
    cache_path = get_cache_path(novel_id, episode_num)

    # キャッシュがあればそれを返す
    if cache_path.exists():
        return cache_path

    # エピソードページを直接取得
    episode_url = f"https://ncode.syosetu.com/{novel_id}/{episode_num}/"
    html = get(episode_url)

    # 小説タイトルを抽出
    novel_title = extract_novel_title(html) or novel_id

    parser = NarouEpisodeParser(include_images=True, convert_tcy=True)
    parser.feed(html)

    episode_title = parser.title
    paragraphs = parser.paragraphs
    images = parser.images

    # EPUB を生成
    timestamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    episode_id = str(episode_num)

    # episodes リスト（1話分）
    episodes = [{
        "id": episode_id,
        "title": episode_title,
        "paragraphs": paragraphs,
        "fetched": True,
    }]

    # chapters リスト（目次用）
    chapters = [{
        "name": "default",
        "episodes": episodes,
    }]

    # 画像の重複除去
    unique_images = []
    image_ids = set()
    for image in images:
        if image["id"] not in image_ids:
            image_ids.add(image["id"])
            unique_images.append({
                "id": image["id"],
                "name": image["name"],
                "type": image["type"],
            })

    # metadata
    metadata = {
        "novel_id": novel_id,
        "kakuyomu": False,
        "illustration": True,
        "tcy": True,
        "episodes": {
            episode_id: {
                "id": episode_id,
                "title": episode_title,
                "created_at": "",
                "updated_at": "",
                "images": unique_images,
            }
        },
    }

    # ZIP (EPUB) ファイルを作成
    with tempfile.NamedTemporaryFile(
        prefix=f"{novel_id}_{episode_num}_", suffix=".epub",
        dir=CACHE_DIR, delete=False
    ) as tmp_file:
        tmp_file_name = tmp_file.name
        with zipfile.ZipFile(
            tmp_file, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as zf:
            # EPUB仕様: mimetype は最初に無圧縮で追加する必要がある
            zf.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)

            # EPUB 構造ファイル
            zf.writestr("META-INF/container.xml", container())
            zf.writestr("src/style.css", style())
            zf.writestr(
                "src/content.opf",
                content(novel_title, "", timestamp, episodes, unique_images),
            )
            zf.writestr("src/navigation.xhtml", nav(chapters))
            zf.writestr("src/metadata.json", json.dumps(metadata))

            # テキストを追加
            zf.writestr(
                f"src/text/{episode_id}.xhtml",
                text(episode_title, paragraphs),
            )

            # 画像を追加
            for image in images:
                if image["id"] in image_ids:
                    zf.writestr(f"src/image/{image['name']}", image["data"])

    # キャッシュファイルとしてリネーム（replace は既存ファイルを上書き）
    Path(tmp_file_name).replace(cache_path)

    return cache_path


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

    novel_id, episode = parse_narou_url(url)
    if not novel_id:
        return "無効なURLです。小説家になろうのURLを入力してください。", 400

    episode = episode or 1
    return redirect(f"/read/{novel_id}/{episode}")


@app.route("/go-id")
def go_id():
    """小説IDとエピソード番号からリダイレクト"""
    novel_id = request.args.get("novel_id", "").strip()
    episode = request.args.get("episode", "1").strip()

    if not novel_id:
        return redirect("/")

    return redirect(f"/read/{novel_id}/{episode}")


@app.route("/read/<novel_id>/<int:episode>")
def read_episode(novel_id: str, episode: int):
    """特定のエピソードを Bibi で表示（1話単位）- 目次を読み込まずに直接取得"""
    # 入力バリデーション
    if not re.match(r'^[a-zA-Z0-9]+$', novel_id) or len(novel_id) > 20:
        return "無効な小説IDです", 400
    if episode < 1 or episode > 10000:
        return "エピソード番号は1〜10000の範囲で指定してください", 400

    # EPUB を直接生成（目次をスキップ）
    try:
        generate_epub_direct(novel_id, episode)
    except (IOError, ValueError) as e:
        logging.error(f"EPUB生成エラー: novel_id={novel_id}, episode={episode}, error={e}")
        return "EPUB の生成に失敗しました。URLを確認してください。", 500
    except Exception as e:
        logging.exception(f"予期しないエラー: novel_id={novel_id}, episode={episode}")
        return "EPUB の生成に失敗しました", 500

    # Bibi に渡すファイル名（{novel_id}_{episode}.epub 形式）
    epub_filename = get_cache_filename(novel_id, episode)

    # Bibi にリダイレクト（ファイル名から novel_id と episode を取得できるのでパラメータは book のみ）
    return redirect(f"/bibi/index.html?book=narou/{epub_filename}")


@app.route("/bibi/<path:filename>")
def serve_bibi(filename: str):
    """Bibi の静的ファイルを配信"""
    return send_from_directory(BIBI_DIR, filename)


@app.route("/bibi-bookshelf/<path:filename>")
def serve_bookshelf(filename: str):
    """既存の bookshelf ファイルを配信（Range リクエスト対応）"""
    file_path = (BOOKSHELF_DIR / filename).resolve()

    # パストラバーサル対策: BOOKSHELF_DIR 配下であることを確認
    if not file_path.is_relative_to(BOOKSHELF_DIR.resolve()):
        abort(403)

    if not file_path.exists():
        abort(404)

    # MIME タイプを決定
    if filename.endswith('.epub'):
        mimetype = 'application/epub+zip'
    elif filename.endswith('.zip'):
        mimetype = 'application/zip'
    else:
        mimetype = 'application/octet-stream'

    file_size = file_path.stat().st_size

    # Range リクエストの処理
    range_header = request.headers.get('Range')
    if range_header:
        # Range: bytes=0-1023 または bytes=-1024 (suffix) の形式をパース
        try:
            byte_range = range_header.replace('bytes=', '').split('-')

            if byte_range[0] == '':
                # suffix range: bytes=-N (末尾からNバイト)
                suffix_length = int(byte_range[1])
                if suffix_length <= 0:
                    abort(416)
                start = max(0, file_size - suffix_length)
                end = file_size - 1
            else:
                start = int(byte_range[0])
                end = int(byte_range[1]) if byte_range[1] else file_size - 1

            # バリデーション
            if start < 0 or end < 0 or start > end or start >= file_size:
                abort(416)  # Range Not Satisfiable

            end = min(end, file_size - 1)
            length = end - start + 1

        except (ValueError, IndexError):
            abort(416)  # Range Not Satisfiable

        with open(file_path, 'rb') as f:
            f.seek(start)
            data = f.read(length)

        response = Response(
            data,
            status=206,  # Partial Content
            mimetype=mimetype
        )
        response.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
        response.headers['Accept-Ranges'] = 'bytes'
        response.headers['Content-Length'] = length
        return response

    # 通常のリクエスト - ファイル全体を返す
    mtime = file_path.stat().st_mtime
    last_modified = email.utils.formatdate(mtime, usegmt=True)

    with open(file_path, 'rb') as f:
        data = f.read()

    response = Response(data, mimetype=mimetype)
    response.headers['Accept-Ranges'] = 'bytes'
    response.headers['Content-Length'] = file_size
    response.headers['Last-Modified'] = last_modified
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return response


def main():
    """サーバーを起動"""
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '').lower() in ('1', 'true', 'yes')
    print("nepub-reader を起動中...")
    print(f"http://localhost:{port}/ でアクセスできます")
    app.run(host="0.0.0.0", port=port, debug=debug)


if __name__ == "__main__":
    main()
