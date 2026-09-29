import datetime
import html
import json
import logging
import os
import re
import tempfile
import urllib.error
import zipfile
from pathlib import Path
from typing import Callable

from flask import Flask, jsonify, redirect, render_template, request, send_file
from nepub.epub import container, content, nav, style, text
from nepub.http import get
from nepub.parser.kakuyomu import KakuyomuEpisodeParser
from nepub.parser.narou import NarouEpisodeParser


# ロギング設定
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

# プロジェクトルート
PROJECT_ROOT = Path(__file__).parent.parent

# static/ には画面の JS と同梱の epub-viewer（static/epub-viewer/）を置く
app = Flask(__name__)


# epub-viewer は書籍の各ページ・画像・CSS・フォントを blob: URL で表示するので、
# それらの blob: と（書籍内の）data: を許可する。スクリプトは static/ のファイルだけ
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' blob:",
        "img-src 'self' blob: data:",
        "font-src 'self' blob: data:",
        "media-src blob: data:",
        "frame-src blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
    ]
)


@app.after_request
def set_security_headers(response):
    """全レスポンスにセキュリティヘッダーを付与"""
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
    return response


# EPUB キャッシュディレクトリ（サイトごとに分離）
CACHE_DIR = PROJECT_ROOT / "epub-cache"
NAROU_CACHE_DIR = CACHE_DIR / "narou"
NAROU_CACHE_DIR.mkdir(parents=True, exist_ok=True)
KAKUYOMU_CACHE_DIR = CACHE_DIR / "kakuyomu"
KAKUYOMU_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# 作品 ID・エピソードの形式（サイトごと）
NAROU_ID_PATTERN = re.compile(r"[a-zA-Z0-9]{1,20}")
KAKUYOMU_ID_PATTERN = re.compile(r"[0-9]{1,30}")
NAROU_EPISODE_PATTERN = re.compile(r"[1-9][0-9]{0,4}")  # 先頭の 0 は不可（同じ話の URL・キャッシュを 1 つにするため）
MAX_NAROU_EPISODE = 10000

# なろうURLパース用の正規表現
NAROU_URL_PATTERN = re.compile(
    r"https?://ncode\.syosetu\.com/([a-zA-Z0-9]+)(?:/(\d+))?/?"
)

# カクヨムURLパース用の正規表現
KAKUYOMU_URL_PATTERN = re.compile(
    r"https?://kakuyomu\.jp/works/(\d+)(?:/episodes/(\d+))?/?"
)


def parse_narou_url(url: str) -> tuple[str | None, int | None]:
    """なろうのURLから小説IDとエピソード番号を抽出"""
    match = NAROU_URL_PATTERN.match(url.strip())
    if not match:
        return None, None
    # なろうの作品 ID は大文字・小文字を区別しないので、キャッシュ・履歴が分かれないよう小文字にそろえる
    novel_id = match.group(1).lower()
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


def extract_page_title(html_content: str) -> str | None:
    """エピソードページの <title> をプレーンテキストとして抽出（エスケープなし）"""
    match = re.search(r"<title>(.+?)</title>", html_content, re.DOTALL)
    if match:
        # 生HTMLには実体参照 (&amp; 等) が残っているため戻す
        return html.unescape(match.group(1).strip())
    return None


def clean_narou_novel_title(title_text: str, episode_title: str) -> str:
    """なろうの <title>（作品名 - エピソード名）から作品名を取り出す"""
    if episode_title:
        suffix = " - " + episode_title
        if title_text.endswith(suffix):
            return title_text[: -len(suffix)].strip() or title_text
    return title_text


def clean_kakuyomu_novel_title(title_text: str, episode_title: str) -> str:
    """カクヨムの <title>（エピソード名 - 作品名（作者名） - カクヨム）から作品名を取り出す"""
    text = title_text
    if text.endswith(" - カクヨム"):
        text = text[: -len(" - カクヨム")]
    if episode_title:
        prefix = episode_title + " - "
        if text.startswith(prefix):
            text = text[len(prefix) :]
    # 末尾の（作者名）を除去
    text = re.sub(r"（[^（）]*）$", "", text).strip()
    return text or title_text


def _extract_adjacent_episode_id(html_content: str, link_id: str) -> str | None:
    """カクヨムのエピソードHTMLから指定リンク要素のエピソードIDを抽出

    id と href の属性の記述順や間に挟まる属性は保証されないため、
    両方の順序を許容する。
    """
    match = re.search(
        rf'id="{link_id}"[^>]*href="/works/\d+/episodes/(\d+)', html_content
    ) or re.search(
        rf'href="/works/\d+/episodes/(\d+)"[^>]*id="{link_id}"', html_content
    )
    return match.group(1) if match else None


def extract_kakuyomu_adjacent_episodes(
    html_content: str,
) -> tuple[str | None, str | None]:
    """カクヨムのエピソードHTMLから前後のエピソードIDを抽出"""
    prev_id = _extract_adjacent_episode_id(
        html_content, "contentMain-readPreviousEpisode"
    )
    next_id = _extract_adjacent_episode_id(html_content, "contentMain-readNextEpisode")
    return prev_id, next_id


def get_narou_cache_path(novel_id: str, episode_num: int) -> Path:
    """なろうの EPUB キャッシュファイルパスを生成"""
    return NAROU_CACHE_DIR / f"{novel_id}_{episode_num}.epub"


def get_kakuyomu_cache_path(work_id: str, episode_id: str) -> Path:
    """カクヨムの EPUB キャッシュファイルパスを生成"""
    return KAKUYOMU_CACHE_DIR / f"{work_id}_{episode_id}.epub"


def get_kakuyomu_nav_path(work_id: str, episode_id: str) -> Path:
    """カクヨムの前後の話の ID の保存先（EPUB とは別に持ち、次話の公開時にこれだけ更新する）"""
    return get_kakuyomu_cache_path(work_id, episode_id).with_suffix(".nav.json")


def kakuyomu_episode_url(work_id: str, episode_id: str) -> str:
    return f"https://kakuyomu.jp/works/{work_id}/episodes/{episode_id}"


def parse_episode(
    url: str, parser, clean_novel_title: Callable[[str, str], str]
) -> tuple[str, str]:
    """話のページを取得して parser に読ませ、(ページの HTML, 作品名) を返す

    作品名はページの <title> から clean_novel_title で取り出す（取れなければ空文字）。
    """
    html_content = get(url)
    parser.feed(html_content)

    # 本文が取れていない（ページ構造の変更・削除済み作品など）場合は
    # 壊れた EPUB をキャッシュしないように失敗させる
    if not parser.paragraphs:
        raise ValueError("本文を抽出できませんでした")

    # <title> には話タイトルも入っているので、tcy 加工前の話タイトル
    # （nepub のパーサーの内部属性）を使って作品名だけ取り出す
    page_title = extract_page_title(html_content)
    raw_episode_title = str(getattr(parser, "_title", "")).strip()
    novel_title = clean_novel_title(page_title, raw_episode_title) if page_title else ""
    # nepub のテンプレートはエスケープしない（パーサーがエスケープ済みの値を返す）ので揃える
    return html_content, html.escape(novel_title)


def build_epub(
    cache_path: Path,
    novel_title: str,
    episode_id: str,
    parser,
    metadata: dict,
) -> None:
    """パース済みの 1 話分から EPUB を生成して cache_path に保存"""
    timestamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    episode_title = parser.title
    episodes = [
        {
            "id": episode_id,
            "title": episode_title,
            "paragraphs": parser.paragraphs,
            "fetched": True,
        }
    ]
    chapters = [{"name": "default", "episodes": episodes}]

    # 画像の重複除去（同じ挿絵が複数回出てくることがある）
    images = list({image["id"]: image for image in parser.images}.values())
    image_metadata = [
        {"id": image["id"], "name": image["name"], "type": image["type"]}
        for image in images
    ]
    metadata["episodes"] = {
        episode_id: {
            "id": episode_id,
            "title": episode_title,
            "created_at": "",
            "updated_at": "",
            "images": image_metadata,
        }
    }

    # 書きかけのファイルがキャッシュとして使われないよう、一時ファイルに書いてから置き換える
    tmp_file = tempfile.NamedTemporaryFile(
        prefix=f"{cache_path.stem}_",
        suffix=".epub",
        dir=cache_path.parent,
        delete=False,
    )
    try:
        with tmp_file:
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
                    content(novel_title, "", timestamp, episodes, image_metadata),
                )
                zf.writestr("src/navigation.xhtml", nav(chapters))
                zf.writestr("src/metadata.json", json.dumps(metadata))
                zf.writestr(
                    f"src/text/{episode_id}.xhtml",
                    text(episode_title, parser.paragraphs),
                )
                for image in images:
                    zf.writestr(f"src/image/{image['name']}", image["data"])
        Path(tmp_file.name).replace(cache_path)
    except BaseException:
        Path(tmp_file.name).unlink(missing_ok=True)
        raise


def generate_narou_epub(novel_id: str, episode_num: int) -> Path:
    """なろうの 1 話分の EPUB を生成（キャッシュがあればそれを使う）"""
    cache_path = get_narou_cache_path(novel_id, episode_num)
    if cache_path.exists():
        return cache_path

    parser = NarouEpisodeParser(include_images=True, convert_tcy=True)
    _, novel_title = parse_episode(
        f"https://ncode.syosetu.com/{novel_id}/{episode_num}/",
        parser,
        clean_narou_novel_title,
    )
    metadata = {"novel_id": novel_id, "kakuyomu": False, "illustration": True, "tcy": True}
    build_epub(cache_path, novel_title or novel_id, str(episode_num), parser, metadata)
    return cache_path


def generate_kakuyomu_epub(
    work_id: str, episode_id: str
) -> tuple[Path, str | None, str | None]:
    """カクヨムの 1 話分の EPUB を生成（キャッシュがあればそれを使う）

    Returns:
        (cache_path, prev_episode_id, next_episode_id)
    """
    cache_path = get_kakuyomu_cache_path(work_id, episode_id)
    nav_path = get_kakuyomu_nav_path(work_id, episode_id)
    if cache_path.exists() and nav_path.exists():
        nav_data = json.loads(nav_path.read_text(encoding="utf-8"))
        return cache_path, nav_data.get("prev"), nav_data.get("next")

    parser = KakuyomuEpisodeParser(convert_tcy=True)
    html_content, novel_title = parse_episode(
        kakuyomu_episode_url(work_id, episode_id), parser, clean_kakuyomu_novel_title
    )
    metadata = {"novel_id": work_id, "kakuyomu": True, "illustration": False, "tcy": True}
    build_epub(cache_path, novel_title or work_id, episode_id, parser, metadata)

    prev_id, next_id = extract_kakuyomu_adjacent_episodes(html_content)
    save_kakuyomu_nav(work_id, episode_id, prev_id, next_id)
    return cache_path, prev_id, next_id


def save_kakuyomu_nav(
    work_id: str, episode_id: str, prev_id: str | None, next_id: str | None
) -> None:
    get_kakuyomu_nav_path(work_id, episode_id).write_text(
        json.dumps({"prev": prev_id, "next": next_id}), encoding="utf-8"
    )


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
            return (
                "カクヨムのURLにはエピソードIDが必要です。エピソードページのURLを入力してください。",
                400,
            )
        return redirect(f"/read/kakuyomu/{work_id}/{episode_id}")

    return "無効なURLです。小説家になろうまたはカクヨムのURLを入力してください。", 400


def is_valid_episode(site: str, novel_id: str, episode: str) -> bool:
    """作品 ID・エピソードがサイトごとの形式に合っているか"""
    if site == "narou":
        return bool(
            NAROU_ID_PATTERN.fullmatch(novel_id)
            and NAROU_EPISODE_PATTERN.fullmatch(episode)
            and int(episode) <= MAX_NAROU_EPISODE
        )
    if site == "kakuyomu":
        return bool(
            KAKUYOMU_ID_PATTERN.fullmatch(novel_id)
            and KAKUYOMU_ID_PATTERN.fullmatch(episode)
        )
    return False


@app.route("/read/<site>/<novel_id>/<episode>")
def read_episode(site: str, novel_id: str, episode: str):
    """リーダー画面（EPUB の取得と話の移動は static/reader.js が行う）"""
    if not is_valid_episode(site, novel_id, episode):
        return "無効な URL です", 404
    return render_template("reader.html")


@app.route("/epub/<site>/<novel_id>/<episode>")
def episode_epub(site: str, novel_id: str, episode: str):
    """1 話分の EPUB を返す（なければ取得・生成してキャッシュする）

    カクヨムは前後の話の ID をヘッダーで返す（なろうは話数 ±1 なので不要）。
    """
    if not is_valid_episode(site, novel_id, episode):
        return "無効な URL です", 404
    target = f"{site}/{novel_id}/{episode}"
    headers = {}
    try:
        if site == "narou":
            path = generate_narou_epub(novel_id, int(episode))
        else:
            path, prev_id, next_id = generate_kakuyomu_epub(novel_id, episode)
            headers = {"X-Prev-Episode": prev_id or "", "X-Next-Episode": next_id or ""}
    # HTTPError は IOError のサブクラスなので先に捕まえる
    except urllib.error.HTTPError as e:
        logging.error(f"エピソード取得エラー: {target}, status={e.code}")
        if e.code == 404:
            return "エピソードが見つかりませんでした", 404
        return "エピソードの取得に失敗しました", 502
    except (IOError, ValueError) as e:
        logging.error(f"EPUB生成エラー: {target}, error={e}")
        return "EPUB の生成に失敗しました", 500
    except Exception:
        logging.exception(f"予期しないエラー: {target}")
        return "EPUB の生成に失敗しました", 500

    response = send_file(path, mimetype="application/epub+zip")
    response.headers.update(headers)
    return response


@app.route("/api/kakuyomu/next-episode/<work_id>/<episode_id>")
def check_kakuyomu_next_episode(work_id: str, episode_id: str):
    """カクヨムの最新話チェック: 現在のエピソードページを再取得して次話の有無を確認"""
    if not is_valid_episode("kakuyomu", work_id, episode_id):
        return jsonify({"error": "無効な URL です"}), 404

    try:
        html_content = get(kakuyomu_episode_url(work_id, episode_id))
    except Exception:
        logging.exception(f"最新話チェックエラー: kakuyomu/{work_id}/{episode_id}")
        return jsonify({"error": "最新話の確認に失敗しました"}), 500

    # 前後の話の情報だけ最新にする（本文の EPUB はそのまま使える）
    prev_id, next_id = extract_kakuyomu_adjacent_episodes(html_content)
    save_kakuyomu_nav(work_id, episode_id, prev_id, next_id)
    return jsonify({"next_episode_id": next_id})


def main():
    """サーバーを起動"""
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    # デバッグモードでは Werkzeug デバッガ経由で任意コード実行が可能になるため、
    # HOST で明示されない限りローカルホストにのみバインドする
    host = os.environ.get("HOST", "127.0.0.1" if debug else "0.0.0.0")
    print("nepub-reader を起動中...")
    print(f"http://localhost:{port}/ でアクセスできます")
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
