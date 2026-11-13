# CLAUDE.md

「小説家になろう」「カクヨム」の作品を 1 話ずつ EPUB にして縦書きで読む Flask アプリ。利用者向けの説明は README.md を参照。

## このファイルの運用

- ユーザーからの指示・方針・注意点のうち今後も継続して守るべきものは、明示的に頼まれなくてもこのファイルに反映する。ハマりどころや設計判断を見つけたときも同様。
- 追記のたびに全体を見直して整理する: 重複や古くなった記述は統合・削除し、該当する節に置く。1 項目は短く、理由が必要なものだけ理由を書く。
- このファイルもリポジトリにコミットされるので、下記「コミット前の確認」の対象に含まれる。

## 構成

| パス | 内容 |
| --- | --- |
| `nepub_reader/app.py` | サーバー。ルーティングとセキュリティヘッダーだけを持つ |
| `nepub_reader/episodes.py` | 話の取得と EPUB 生成（nepub）、キャッシュ、元サイトの URL の解釈。Flask には依存しない |
| `nepub_reader/templates/` | トップページ（`index.html`）とリーダー画面（`reader.html`）の HTML。CSS と JS は `static/` に置く |
| `nepub_reader/static/index.js` / `index.css` | トップページ。読書履歴の一覧・削除・インポート・エクスポート |
| `nepub_reader/static/theme.js` | トップページの配色をリーダーのテーマに合わせる（描画前に動かすので通常のスクリプト） |
| `nepub_reader/static/reader.js` / `reader.css` | リーダー画面。EPUB の取得、話の前後移動、読書履歴と読書位置の記録 |
| `nepub_reader/static/history.js` | 読書履歴（読書位置を含む）の localStorage 管理（トップページとリーダーで共有） |
| `nepub_reader/static/epub-viewer/` | 同梱の epub-viewer（ビルド成果物。直接編集しない） |
| `tests/` | サーバーのテスト（標準ライブラリの `unittest`。元サイトへはアクセスしない） |
| `epub-cache/` | 生成した EPUB のキャッシュ（git 管理外） |

ルート: `/read/<site>/<作品 ID>/<話>` がリーダー画面、`/epub/<site>/<作品 ID>/<話>` が 1 話分の EPUB、`/api/kakuyomu/next-episode/...` がカクヨムの最新話の再確認、`/go?url=` が元サイトの URL からリーダー画面への移動。`<話>` はなろうなら話数、カクヨムならエピソード ID。

## コマンド（必ず Docker 経由。ホストの Python / Node は使わない）

```sh
docker build -t nepub-reader .
docker run --rm -p 127.0.0.1:5000:5000 nepub-reader   # http://localhost:5000/
# テスト（イメージの Python で、リポジトリのコードを読み取り専用でマウントして実行する）
MSYS_NO_PATHCONV=1 docker run --rm -v "<リポジトリの絶対パス>:/src:ro" -w /src nepub-reader /app/.venv/bin/python -B -m unittest discover -s tests
```

Windows の Git Bash から `docker` にコンテナ内パス（`/work` など）を渡すと Windows パスに自動変換されるので、`MSYS_NO_PATHCONV=1` を前に付けて変換を無効にする。

## 毎回のチェックリスト（変更を終える前に必ず確認）

1. **動作確認**: テストを通す。サーバーの挙動を変えたらテストも足す（テスト用の依存は増やさず `unittest` で書く）。画面は Docker で起動し、ブラウザで実際に操作して確認する（手順は「ブラウザでの確認」）。見た目の不具合は computed style では見逃すことがあるので、スクリーンショットや画素で確認する。
2. **冗長さ・可読性**: 差分を読み返し、使われていないコード・重複・分かりにくい名前がないか確認する。コメントは「なぜ」を書く。構造はシンプルに保つ。
3. **ドキュメント**: 操作方法や起動方法を変えたら README.md を更新する。このファイルも「このファイルの運用」に従って更新する。Markdown の文は途中で改行しない（日本語では改行が余分な空白として表示されるため）。
4. **依存を増やさない**: 追加が必要なら「サプライチェーン対策」の手順に従う。
5. **コミット前の確認**: コミット・push はユーザーの指示があったときだけ行う。コミット対象にふさわしくない情報が入っていないか確認する。
   - ローカル環境の情報: 絶対パス（ユーザー名を含むホームディレクトリ等）、ホスト名、個人のツール設定
   - 個人情報: 氏名、メールアドレス、アカウント名（同梱ライブラリの LICENSE の著作権表示は除く）
   - 会話やプロンプトに含まれる個人的な内容・経緯
   - 秘密情報: トークン、パスワード、社内 URL
   - 確認例: `git diff --cached | grep -n -i -E '/Users/|/home/|C:[/\\]|@[a-z0-9-]+\.[a-z]+|token|password'`（誤検知は目視で除外）

## サプライチェーン対策

- Python の依存は `flask` と `nepub` のみ。`uv.lock` をコミットし、PyPI のパッケージはハッシュで固定する。nepub は `pyproject.toml` でも git のコミットを指定する（`uv lock --upgrade` で未確認の最新コミットに上がらないように）。ビルドは `uv sync --frozen`。
- `uv.lock` の更新はホストで行わず、Dockerfile と同じ python・uv のイメージに git を入れた一時イメージで、リポジトリをマウントして `uv lock` を実行する。
- Docker イメージ（python・uv）はバージョンと digest（`@sha256:...`）で固定する。
- 依存・イメージを追加・更新するときは:
  1. 本当に必要か（自前で書けないか）を検討する
  2. 公式・実績のあるものか確認する
  3. 公開から 7 日以上経った版を選ぶ（uv は GitHub のリリース日、PyPI は `https://pypi.org/pypi/<pkg>/json` の `upload_time` で確認）
  4. digest は `docker pull <image>:<tag>` → `docker inspect --format '{{index .RepoDigests 0}}' <image>:<tag>` で取得する
  5. `uv.lock` の差分を確認する

## 同梱の epub-viewer

- 取り込み元: https://github.com/ttk1/epub-viewer の `v2.0.0`（コミット `6d15332`。リリース前の確認として取り込んだもので、公開時にタグが別のコミットに付いたら、そのコミットで取り込み直してここを更新する）。npm には公開されていないので、ビルド成果物を同梱している。
- 更新手順: epub-viewer でタグをチェックアウトし、`docker compose run --rm node sh -c "npm ci && npm run build"` → `dist/src/` の中身と `LICENSE` を `nepub_reader/static/epub-viewer/` に上書きコピー（消えたファイルは削除）→ 上の取り込み元のタグ・コミットを更新 → 動作確認。
- API と挙動は epub-viewer の README.md を参照。ページ送り（キー・クリック・スワイプ・ホイール、リモコンのチャタリング対策）と表示設定（テーマ・フォント・行間・表示幅など）は epub-viewer 側の機能なので、こちらで作り直さない。
- `reader.js` が使うのは公開 API だけ（`reader.toolbar` と、作品名・話タイトルの表示に使う `.title` 要素も公開 API）。ツールバーのそれ以外の中身には頼らない。
- 更新時は、前の版が localStorage に保存した設定（`nepub-reader:settings`）がそのまま使えるかも確認する。`theme.js` もこの設定の `theme` を読んでいる。
- `reader.css` の `height` の `vh` と `dvh` の併記、`overscroll-behavior: none` は epub-viewer の README の勧めに従ったもの。

## 設計メモ・ハマりどころ

- **話の移動**: リーダー画面はページを遷移せずに次/前の話を読み込み、URL は `history.replaceState` で書き換える（リロードで同じ話が開く）。`bookend` / `bookstart` はキーを押すたびに発生するので、読み込み中は `loading` で無視する。
- **次の話の有無**: なろうは話数 +1 を開いてみて 404 なら最新話。カクヨムは前後の話の ID を `/epub/kakuyomu/...` のレスポンスヘッダー（`X-Prev-Episode` / `X-Next-Episode`）で返し、次話がないときだけ `/api/kakuyomu/next-episode/...` で 1 回再確認する（キャッシュ作成後に次話が公開された場合のため）。前後の ID は EPUB とは別の `.nav.json` に保存しているので、再確認で更新するのはそれだけ（本文の EPUB は作り直さない）。最新話と分かったら、その話を開いている間は再確認しない（キーを押すたびに元サイトへアクセスしないように）。
- **読書履歴と読書位置**: localStorage `nepub_reading_history` に作品ごとの最新の話を最大 50 件保存する。項目は `site` / `novel_id` / `novel_title` / `episode_title` / `last_episode` / `last_accessed` / `position`。エクスポートしたファイルとの互換のため、既存の項目の名前と意味は変えない（足すのはよい）。`last_episode` はなろうなら話数（数値）、カクヨムならエピソード ID（文字列）。`site` がない古い履歴はなろうとして扱う。`position` はその話の読書位置（EpubViewer の `location`）で、ない履歴もある。
- **読書位置を EpubReader に保存させない**: 位置は作品ごとに最新の 1 話分だけあればよく、履歴と一緒に消したり移したりしたいので、履歴の項目に持たせている。EpubReader には `storage` オプションで設定（`nepub-reader:settings`）だけを保存させ、位置は `open()` の `location` で渡して `relocate` で保存する。以前の版が保存した `nepub-reader:position:*` は、`history.js` が読み込み時に履歴へ移して消す。
- **知らせ（読み込み中・最新話・エラー）**: ツールバーではなく画面下の `#status` に出す（ツールバーはページ中央のタップで隠せるので）。
- **EPUB のメタデータ**: 作品名は `book.metadata.title`、話タイトルは `book.toc[0].label`。
- **作品名の取り出し**: サーバーはページの `<title>` から話タイトルを除いて作品名を得る。そのために nepub のパーサーの内部属性 `_title`（tcy 加工前の話タイトル）を使っているので、nepub を更新したら作品名が正しく取れるか確認する（テストがある）。古い版が作ったキャッシュには、作品名に話タイトルやサイト名が残っているものがある（キャッシュを消せば作り直される）。
- **EPUB の中身**: 書き出しは nepub の `write_epub` に任せる。本文の CSS は nepub 標準のままで、行間などの見た目は epub-viewer の既定と設定に任せ、EPUB 側では上書きしない（キャッシュ済みの EPUB に焼き込まれて後から変えられないため）。
- **元サイトへのアクセス**: `episodes.py` のロックで同時に 1 つにする（同じ話の二重取得も防ぐ）。作品 ID・話は `is_valid_episode` を通したものだけを、キャッシュのファイル名と元サイトの URL に使う。
- **CSP**: `app.py` の `CONTENT_SECURITY_POLICY` で全レスポンスに付ける。インラインスクリプトは禁止なので、JS は `static/` のファイルに書く。epub-viewer が書籍を blob: URL で表示するため `frame-src blob:` などを許可している（必要な指定は epub-viewer の README の「セキュリティ」）。`frame-ancestors` を `'none'` にすると、WebKit では本文の blob: のフレームにも引き継がれて本文が表示されなくなる（`'self'` にしている）。変更したら 3 ブラウザで CSP 違反が出ないか確認する。
- **ほかのサイトからのリクエスト**: `/epub/` と `/api/` は元サイトへのアクセスを起こすので、`Sec-Fetch-Site` が `cross-site` / `same-site` のリクエストを断る（ほかのサイトのページに、このサーバーを踏み台にさせない）。
- **トップページのテーマ**: `theme.js` が EpubReader の設定（`nepub-reader:settings` の `theme`）を読んで `<html data-theme>` を決める。配色は `index.css` の `:root[data-theme=...]`。

## ブラウザでの確認

epub-viewer の Playwright イメージ（epub-viewer の `compose.yaml` と同じ digest）を使う。ホストには何も入れない。

- アプリのコンテナとテスト用コンテナを同じ Docker ネットワークにつなぎ、コンテナ名でアクセスする。
- Playwright は epub-viewer の `node_modules` ボリュームを読み取り専用でマウントし、`NODE_PATH` を指定して CommonJS のスクリプトから `require('@playwright/test')` する。確認用スクリプトはリポジトリに入れない。
- Playwright イメージの既定のフォントでは縦書きの漢字が重なって描画される。スクリーンショットを撮るときは和文フォント（Windows なら `C:/Windows/Fonts/yumin.ttf` など）を読み取り専用で `/usr/share/fonts/` にマウントし、`fc-cache -f` してから撮る。フォントはコミットしない。
- 元サイトへのアクセスは最小限にする（同じ話はキャッシュが使われる）。最新話や読み込みの失敗は `page.route()` でレスポンスを差し替えて再現する（差し替えた 404 は、Chromium と WebKit ではコンソールのエラーとして記録される）。
- スマホ幅（390px 程度、タッチあり）でも確認する。はみ出しは `scrollWidth` では見つからないことがあるので、要素の位置かスクリーンショットで確かめる。
