"""サーバー。画面（トップページ・リーダー）と、1 話分の EPUB を返す"""

import logging
import os
import urllib.error

from flask import Flask, jsonify, redirect, render_template, request, send_file

from nepub_reader import episodes

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# static/ には画面の JS・CSS と同梱の epub-viewer（static/epub-viewer/）を置く
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
        # 'none' にはしない: WebKit は本文の blob: のフレームにもこの CSP を引き継ぎ、本文が表示されなくなる
        "frame-ancestors 'self'",
    ]
)


@app.before_request
def reject_cross_site_requests():
    """ほかのサイトのページから、このサーバーに元サイトへのアクセスをさせない

    EPUB と API は、このアプリの画面から（same-origin）か、アドレスバーなどから直接（none）しか呼ばれない。
    /go は、ほかのサイトからはリンクなどでページとして開く場合だけ通す（画像や fetch としては通さない）。
    Sec-Fetch-Site を送らない古いブラウザは通す。
    """
    if request.headers.get("Sec-Fetch-Site", "same-origin") in ("same-origin", "none"):
        return None
    if request.path.startswith(("/epub/", "/api/")) or (
        request.path == "/go" and request.headers.get("Sec-Fetch-Dest") != "document"
    ):
        return "ほかのサイトからは利用できません", 403
    return None


@app.after_request
def set_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
    # 元サイトへのリンクを開くときに、読んでいる作品の URL を渡さない
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


@app.route("/")
def index():
    return render_template("index.html")


def url_error(message: str, url: str):
    """トップページに、入力された URL とエラーを表示する"""
    return render_template("index.html", url=url, error=message), 400


@app.route("/go")
def go():
    """入力された元サイトの URL から、リーダー画面へ移動する"""
    url = request.args.get("url", "").strip()
    if not url:
        return redirect("/")
    parsed = episodes.parse_url(url)
    if not parsed:
        return url_error("対応していない URL です。小説家になろうかカクヨムの、作品か話の URL を入力してください。", url)

    site, novel_id, episode = parsed
    if not episode:
        if not episodes.is_valid_novel(site, novel_id):
            return url_error("作品の URL が正しくありません。", url)
        try:
            episode = episodes.first_episode(site, novel_id)
        except urllib.error.HTTPError as e:
            logging.error(f"作品ページ取得エラー: {site}/{novel_id}, status={e.code}")
            episode = None
        except Exception:
            logging.exception(f"作品ページ取得エラー: {site}/{novel_id}")
            episode = None
        if not episode:
            return url_error("作品の最初の話が見つかりませんでした。話の URL を入力してください。", url)
    if not episodes.is_valid_episode(site, novel_id, episode):
        return url_error("作品か話の URL が正しくありません。", url)
    return redirect(f"/read/{site}/{novel_id}/{episode}")


@app.route("/read/<site>/<novel_id>/<episode>")
def read_episode(site: str, novel_id: str, episode: str):
    """リーダー画面（EPUB の取得と話の移動は static/reader.js が行う）"""
    if site == "narou" and novel_id != novel_id.lower():
        # なろうの作品 ID は小文字にそろえる（大文字の URL で保存された古い履歴やブックマークのため）
        return redirect(f"/read/{site}/{novel_id.lower()}/{episode}")
    if not episodes.is_valid_episode(site, novel_id, episode):
        return "無効な URL です", 404
    return render_template("reader.html")


@app.route("/epub/<site>/<novel_id>/<episode>")
def episode_epub(site: str, novel_id: str, episode: str):
    """1 話分の EPUB を返す（なければ取得・生成してキャッシュする）

    カクヨムは前後の話の ID をヘッダーで返す（なろうは話数 ±1 なので不要）。
    """
    if not episodes.is_valid_episode(site, novel_id, episode):
        return "無効な URL です", 404
    target = f"{site}/{novel_id}/{episode}"
    try:
        path, adjacent = episodes.get_epub(site, novel_id, episode)
    # HTTPError は OSError のサブクラスなので先に捕まえる
    except urllib.error.HTTPError as e:
        logging.error(f"エピソード取得エラー: {target}, status={e.code}")
        if e.code == 404:
            return "エピソードが見つかりませんでした", 404
        return "エピソードの取得に失敗しました", 502
    except OSError as e:
        logging.error(f"エピソード取得エラー: {target}, error={e}")
        return "エピソードの取得に失敗しました", 502
    except Exception:
        logging.exception(f"EPUB 生成エラー: {target}")
        return "EPUB の生成に失敗しました", 500

    response = send_file(path, mimetype="application/epub+zip")
    if adjacent:
        response.headers["X-Prev-Episode"] = adjacent["prev"] or ""
        response.headers["X-Next-Episode"] = adjacent["next"] or ""
    return response


@app.route("/api/kakuyomu/next-episode/<work_id>/<episode_id>")
def check_kakuyomu_next_episode(work_id: str, episode_id: str):
    """カクヨムの最新話の再確認: 話のページを取得し直して、次の話が公開されていないか調べる"""
    if not episodes.is_valid_episode("kakuyomu", work_id, episode_id):
        return jsonify({"error": "無効な URL です"}), 404
    try:
        adjacent = episodes.refresh_kakuyomu_adjacent(work_id, episode_id)
    except Exception:
        logging.exception(f"最新話チェックエラー: kakuyomu/{work_id}/{episode_id}")
        return jsonify({"error": "最新話の確認に失敗しました"}), 502
    return jsonify({"next_episode_id": adjacent["next"]})


def main():
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    # デバッグモードでは Werkzeug デバッガ経由で任意コード実行が可能になるため、
    # HOST で明示されない限りローカルホストにのみバインドする
    host = os.environ.get("HOST", "127.0.0.1" if debug else "0.0.0.0")
    print(f"nepub-reader を起動中... http://localhost:{port}/ でアクセスできます")
    app.run(host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
