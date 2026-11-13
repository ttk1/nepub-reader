"""話の取得と、1 話分の EPUB の生成・キャッシュ（小説家になろう / カクヨム）

話は (site, 作品 ID, 話) で指す。話は、なろうなら話数、カクヨムならエピソード ID。
"""

import datetime
import html
import json
import logging
import os
import re
import shutil
import threading
import time
from pathlib import Path
from typing import TypedDict

from nepub.epub import write_epub
from nepub.http import get
from nepub.parser.kakuyomu import KakuyomuEpisodeParser, KakuyomuIndexParser
from nepub.parser.narou import NarouEpisodeParser

# EPUB のキャッシュ先。<CACHE_VERSION>/<site>/<作品 ID>_<話>.epub に保存する
CACHE_DIR = Path(__file__).parent.parent / "epub-cache"
# キャッシュの版。EPUB の作り方を変えて、前に作ったものを使わせたくないときに上げる（前の版のものは起動時に消す）
# v2: 作品名に話タイトルやサイト名が残っていた、古い版のキャッシュを使わない
CACHE_VERSION = "v2"
# キャッシュの大きさの上限。超えたら、長く読まれていない話から消す
MAX_CACHE_BYTES = 1024**3

# 作品 ID・話の形式。キャッシュのファイル名と元サイトの URL に使うので、ここで通したものだけを扱う
NAROU_ID_PATTERN = re.compile(r"[a-z0-9]{1,20}")
# 先頭の 0 は不可（同じ話の URL・キャッシュを 1 つにするため）
NAROU_EPISODE_PATTERN = re.compile(r"[1-9][0-9]{0,4}")
MAX_NAROU_EPISODE = 10000
KAKUYOMU_ID_PATTERN = re.compile(r"[0-9]{1,30}")

NAROU_URL_PATTERN = re.compile(r"https?://ncode\.syosetu\.com/([a-zA-Z0-9]+)(?:/(\d+))?/?")
KAKUYOMU_URL_PATTERN = re.compile(r"https?://kakuyomu\.jp/works/(\d+)(?:/episodes/(\d+))?/?")

# 元サイトへのアクセスを同時に 1 つにする（同じ話を二重に取得しないためでもある）
_fetch_lock = threading.Lock()
# 元サイトのページを続けて取得するときに空ける間隔（秒）。話を次々に飛ばしても、元サイトに負荷をかけない
FETCH_INTERVAL = 1.0
_last_fetch = 0.0


def _get_page(url: str) -> str:
    """元サイトのページを取得する（_fetch_lock を取ってから呼ぶ）。前の取得から FETCH_INTERVAL 秒は空ける"""
    global _last_fetch
    time.sleep(max(0.0, _last_fetch + FETCH_INTERVAL - time.monotonic()))
    try:
        return get(url)
    finally:
        _last_fetch = time.monotonic()


class Adjacent(TypedDict):
    """カクヨムの前後の話のエピソード ID（ないときは None）"""

    prev: str | None
    next: str | None


def is_valid_novel(site: str, novel_id: str) -> bool:
    """作品 ID がサイトごとの形式に合っているか"""
    pattern = {"narou": NAROU_ID_PATTERN, "kakuyomu": KAKUYOMU_ID_PATTERN}.get(site)
    return bool(pattern and pattern.fullmatch(novel_id))


def is_valid_episode(site: str, novel_id: str, episode: str) -> bool:
    """作品 ID・話がサイトごとの形式に合っているか"""
    if not is_valid_novel(site, novel_id):
        return False
    if site == "narou":
        return bool(NAROU_EPISODE_PATTERN.fullmatch(episode) and int(episode) <= MAX_NAROU_EPISODE)
    return bool(KAKUYOMU_ID_PATTERN.fullmatch(episode))


def parse_url(url: str) -> tuple[str, str, str | None] | None:
    """元サイトの URL を (site, 作品 ID, 話) にする

    作品のトップページの URL では話が None になる。対応していない URL は None を返す。
    """
    # コピーした URL に付いていることがあるクエリとフラグメントは無視する
    url = re.split(r"[?#]", url.strip())[0]
    if match := NAROU_URL_PATTERN.fullmatch(url):
        # なろうの作品 ID は大文字・小文字を区別しないので、キャッシュ・履歴が分かれないよう小文字にそろえる
        # 話数の先頭の 0 も同じ理由で取る
        return "narou", match[1].lower(), match[2] and match[2].lstrip("0")
    if match := KAKUYOMU_URL_PATTERN.fullmatch(url):
        return "kakuyomu", match[1], match[2]
    return None


def first_episode(site: str, novel_id: str) -> str | None:
    """作品の最初の話。カクヨムは作品のページを取得して調べる（話がなければ None）"""
    if site == "narou":
        return "1"
    parser = KakuyomuIndexParser()
    with _fetch_lock:
        parser.feed(_get_page(f"https://kakuyomu.jp/works/{novel_id}"))
    return next((episode["id"] for chapter in parser.chapters for episode in chapter["episodes"]), None)


def get_epub(site: str, novel_id: str, episode: str) -> tuple[Path, Adjacent | None]:
    """1 話分の EPUB のパスを返す。キャッシュになければ元サイトから取得して作る

    カクヨムは前後の話も返す（なろうは話数 ±1 なので None）。
    """
    # キャッシュ済みの話は、ほかの話の取得を待たずに返す
    return _cached(site, novel_id, episode) or _fetch(site, novel_id, episode)


def refresh_kakuyomu_adjacent(work_id: str, episode_id: str) -> Adjacent:
    """カクヨムの話のページを取得し直して、前後の話を最新にする（本文の EPUB はそのまま使う）"""
    with _fetch_lock:
        adjacent = _extract_adjacent(_get_page(_episode_url("kakuyomu", work_id, episode_id)))
        _write_adjacent(work_id, episode_id, adjacent)
    return adjacent


def remove_old_caches() -> None:
    """前の版のキャッシュ（CACHE_DIR の中で、いまの版のフォルダ以外のもの）と、書きかけで残ったファイルを消す"""
    if not CACHE_DIR.is_dir():
        return
    for path in CACHE_DIR.iterdir():
        if path.name == CACHE_VERSION:
            continue
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
    # 書いている途中で止められたときの一時ファイル
    for path in (CACHE_DIR / CACHE_VERSION).rglob("*.tmp"):
        path.unlink(missing_ok=True)


def _cache_path(site: str, novel_id: str, episode: str) -> Path:
    return CACHE_DIR / CACHE_VERSION / site / f"{novel_id}_{episode}.epub"


def _prune_cache() -> None:
    """キャッシュが上限を超えていたら、長く読まれていない話（更新時刻が古いもの）から消す

    うまくいかなくても（ファイルが同時に消された、など）、作ったばかりの話を返すのは妨げない。
    """
    try:
        stats = [(path.stat(), path) for path in (CACHE_DIR / CACHE_VERSION).rglob("*.epub")]
        total = sum(stat.st_size for stat, _ in stats)
        for stat, path in sorted(stats, key=lambda item: item[0].st_mtime):
            if total <= MAX_CACHE_BYTES:
                break
            path.unlink(missing_ok=True)
            path.with_suffix(".nav.json").unlink(missing_ok=True)
            total -= stat.st_size
    except OSError:
        pass


def _adjacent_path(work_id: str, episode_id: str) -> Path:
    """前後の話の保存先。EPUB とは別に持ち、次の話が公開されたときにこれだけ更新する"""
    return _cache_path("kakuyomu", work_id, episode_id).with_suffix(".nav.json")


def _episode_url(site: str, novel_id: str, episode: str) -> str:
    if site == "narou":
        return f"https://ncode.syosetu.com/{novel_id}/{episode}/"
    return f"https://kakuyomu.jp/works/{novel_id}/episodes/{episode}"


def _cached(site: str, novel_id: str, episode: str) -> tuple[Path, Adjacent | None] | None:
    path = _cache_path(site, novel_id, episode)
    try:
        # 読まれた話の更新時刻を新しくして、_prune_cache で後回しにする
        os.utime(path)
    except OSError:
        return None
    if site == "narou":
        return path, None
    # 前後の話が読めないカクヨムの話は、キャッシュがないものとして作り直す
    adjacent = _read_adjacent(novel_id, episode)
    return (path, adjacent) if adjacent else None


def _fetch(site: str, novel_id: str, episode: str) -> tuple[Path, Adjacent | None]:
    with _fetch_lock:
        # 待っている間に、ほかのリクエストが同じ話を作り終えていることがある
        if cached := _cached(site, novel_id, episode):
            return cached

        page = _get_page(_episode_url(site, novel_id, episode))
        parser = _parse_episode(site, page)
        # 本文が取れないとき（ページ構造の変更、削除された作品など）に、壊れた EPUB をキャッシュしない
        if not parser.paragraphs:
            raise ValueError("本文を抽出できませんでした")

        path = _cache_path(site, novel_id, episode)
        path.parent.mkdir(parents=True, exist_ok=True)
        _write_episode_epub(path, site, novel_id, episode, _novel_title(site, page, parser) or novel_id, parser)
        adjacent = None
        if site == "kakuyomu":
            adjacent = _extract_adjacent(page)
            _write_adjacent(novel_id, episode, adjacent)
        _prune_cache()
        return path, adjacent


def _parse_episode(site: str, page: str) -> NarouEpisodeParser:
    """話のページを nepub のパーサーに読ませる"""
    if site == "kakuyomu":
        parser = KakuyomuEpisodeParser(convert_tcy=True)
        parser.feed(page)
        return parser
    try:
        # なろうは挿絵も取り込む（パーサーが挿絵を取得する）
        parser = NarouEpisodeParser(include_images=True, convert_tcy=True)
        parser.feed(page)
    except Exception as e:
        # 挿絵が取れない（削除された、想定しない形式、など）ときは、挿絵なしで読めるようにする。
        # 話のページは取れているので、ここでのエラーを「話がない」として扱わない
        logging.warning(f"挿絵を取り込めなかったので、挿絵なしで作ります: {e}")
        parser = NarouEpisodeParser(include_images=False, convert_tcy=True)
        parser.feed(page)
    return parser


def _write_episode_epub(
    path: Path, site: str, novel_id: str, episode: str, novel_title: str, parser: NarouEpisodeParser
) -> None:
    """パース済みの 1 話から EPUB を作る。作品名が EPUB のタイトル、話タイトルが目次の唯一の項目になる"""
    episodes = [
        {
            "id": episode,
            "title": parser.title,
            "created_at": "",
            "updated_at": "",
            "paragraphs": parser.paragraphs,
            "fetched": True,
        }
    ]
    images = [{"id": image["id"], "name": image["name"], "type": image["type"]} for image in parser.images]
    # nepub が EPUB に入れる metadata.json の内容（このアプリでは使わない）
    metadata = {
        "novel_id": novel_id,
        "kakuyomu": site == "kakuyomu",
        "illustration": site == "narou",
        "tcy": True,
        "episodes": {episode: {"id": episode, "title": parser.title, "created_at": "", "updated_at": "", "images": images}},
    }
    timestamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    # 書きかけのファイルがキャッシュとして使われないよう、write_epub は一時ファイルに書いてから置き換える
    write_epub(
        str(path),
        # nepub のテンプレートはエスケープしない（パーサーがエスケープ済みの値を返す）ので揃える
        html.escape(novel_title),
        "",
        timestamp,
        [{"name": "default", "episodes": episodes}],
        metadata,
        parser.images,
    )


def _novel_title(site: str, page: str, parser: NarouEpisodeParser) -> str:
    """話のページの <title> から作品名を取り出す（取れなければ空文字）

    <title> には話タイトルも入っているので、tcy 加工前の話タイトル（nepub のパーサーの内部属性）を使って取り除く。
    """
    match = re.search(r"<title>(.+?)</title>", page, re.DOTALL)
    if not match:
        return ""
    # 生の HTML には実体参照（&amp; など）が残っているので戻す
    page_title = html.unescape(match[1].strip())
    episode_title = str(getattr(parser, "_title", "")).strip()
    clean = clean_narou_novel_title if site == "narou" else clean_kakuyomu_novel_title
    return clean(page_title, episode_title)


def clean_narou_novel_title(page_title: str, episode_title: str) -> str:
    """なろうの <title>（作品名 - 話タイトル）から作品名を取り出す"""
    if episode_title:
        page_title = page_title.removesuffix(" - " + episode_title)
    return page_title.strip()


def clean_kakuyomu_novel_title(page_title: str, episode_title: str) -> str:
    """カクヨムの <title>（話タイトル - 作品名（作者名） - カクヨム）から作品名を取り出す"""
    title = page_title.removesuffix(" - カクヨム")
    if episode_title:
        title = title.removeprefix(episode_title + " - ")
    # 末尾の（作者名）を取る
    return re.sub(r"（[^（）]*）$", "", title).strip() or page_title


def _extract_adjacent(page: str) -> Adjacent:
    """カクヨムの話のページから前後の話のエピソード ID を取り出す"""

    def episode_id(link_id: str) -> str | None:
        # id と href の順序や、間に挟まる属性は決まっていないので、どちらの順でも探す
        match = re.search(rf'id="{link_id}"[^>]*href="/works/\d+/episodes/(\d+)', page) or re.search(
            rf'href="/works/\d+/episodes/(\d+)"[^>]*id="{link_id}"', page
        )
        return match[1] if match else None

    return {"prev": episode_id("contentMain-readPreviousEpisode"), "next": episode_id("contentMain-readNextEpisode")}


def _read_adjacent(work_id: str, episode_id: str) -> Adjacent | None:
    try:
        data = json.loads(_adjacent_path(work_id, episode_id).read_text(encoding="utf-8"))
        return {"prev": data["prev"], "next": data["next"]}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write_adjacent(work_id: str, episode_id: str, adjacent: Adjacent) -> None:
    path = _adjacent_path(work_id, episode_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    # 書きかけのファイルが読まれないよう、別名で書いてから置き換える
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(adjacent), encoding="utf-8")
    tmp_path.replace(path)
