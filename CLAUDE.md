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
| `nepub_reader/static/theme.js` | ページのテーマを、リーダーで選んだテーマに合わせる（描画前に動かすので通常のスクリプト）。トップページの配色と、リーダーの準備ができるまでの背景に使う |
| `nepub_reader/static/reader.js` / `reader.css` | リーダー画面。EPUB の取得、話の前後移動、読書履歴と読書位置の記録 |
| `nepub_reader/static/sites.js` | 元サイトの名前と、作品・話のページの URL（トップページとリーダーで共有） |
| `nepub_reader/static/history.js` | 読書履歴（読書位置を含む）の localStorage 管理（トップページとリーダーで共有） |
| `nepub_reader/static/manifest.json`、`icon.svg`、`icon-*.png`、`apple-touch-icon.png` | ホーム画面に追加したときのアイコンと全画面表示（ウェブアプリのマニフェスト）。PNG は `icon.svg` から書き出したもの |
| `nepub_reader/static/epub-viewer/` | 同梱の epub-viewer（ビルド成果物。直接編集しない） |
| `tests/` | サーバーのテスト（`test_*.py`。標準ライブラリの `unittest`。元サイトへはアクセスしない）と、読書履歴のテスト（`history.test.mjs`。Node.js 標準のテストランナー） |
| `.github/workflows/test.yml` | push と PR のたびに、サーバーのテストと読書履歴のテストを GitHub Actions で実行する |
| `epub-cache/` | 生成した EPUB のキャッシュ（git 管理外）。`<版>/<site>/<作品 ID>_<話>.epub` |

ルート: `/read/<site>/<作品 ID>/<話>` がリーダー画面、`/epub/<site>/<作品 ID>/<話>` が 1 話分の EPUB、`/api/kakuyomu/next-episode/...` がカクヨムの最新話の再確認、`/go?url=` が元サイトの URL からリーダー画面への移動。`<話>` はなろうなら話数、カクヨムならエピソード ID。

## コマンド（必ず Docker 経由。ホストの Python / Node は使わない）

```sh
docker build -t nepub-reader .
docker run --rm -p 127.0.0.1:5000:5000 nepub-reader   # http://localhost:5000/
# サーバーのテスト（イメージの Python で、リポジトリのコードを読み取り専用でマウントして実行する）
MSYS_NO_PATHCONV=1 docker run --rm -v "<リポジトリの絶対パス>:/src:ro" -w /src nepub-reader /app/.venv/bin/python -B -m unittest discover -s tests
# 読書履歴（history.js）のテスト（「ブラウザでの確認」と同じ Playwright イメージの Node.js を使う）
MSYS_NO_PATHCONV=1 docker run --rm -v "<リポジトリの絶対パス>:/src:ro" -w /src <Playwright イメージ> node --test tests/history.test.mjs
```

Windows の Git Bash から `docker` にコンテナ内パス（`/work` など）を渡すと Windows パスに自動変換されるので、`MSYS_NO_PATHCONV=1` を前に付けて変換を無効にする。

## 毎回のチェックリスト（変更を終える前に必ず確認）

1. **動作確認**: テストを通す。サーバーや読書履歴（`history.js`）の挙動を変えたらテストも足す（テスト用の依存は増やさず、`unittest` と Node.js 標準のテストランナーで書く）。画面は Docker で起動し、ブラウザで実際に操作して確認する（手順は「ブラウザでの確認」）。見た目の不具合は computed style では見逃すことがあるので、スクリーンショットや画素で確認する。
2. **機械的な点検**（大きく変えたとき。どちらも使い捨てのコンテナで、ホストには何も入れない）: Python は `ruff check`（`python` のイメージに `pip install ruff` して実行）。JS は TypeScript の `--allowJs --checkJs`（`--strict false`）で、同梱の epub-viewer の型定義に対して API の使い方を確かめる（Playwright イメージに epub-viewer の `node_modules` ボリュームを `<作業フォルダ>/node_modules` としてマウントし、その `.bin/tsc` を使う。別の場所にマウントすると TypeScript 7 が実行ファイルを見つけられない）。いまは指摘が 0 件になるようにしてある（DOM の要素の型は、必要なところに JSDoc で書いている）ので、指摘が出たら直す。
3. **冗長さ・可読性**: 差分を読み返し、使われていないコード・重複・分かりにくい名前がないか確認する。コメントは「なぜ」を書く。構造はシンプルに保つ。
4. **ドキュメント**: 操作方法や起動方法を変えたら README.md を更新する。このファイルも「このファイルの運用」に従って更新する。Markdown の文は途中で改行しない（日本語では改行が余分な空白として表示されるため）。
5. **依存を増やさない**: 追加が必要なら「サプライチェーン対策」の手順に従う。
6. **コミット前の確認**: コミット・push はユーザーの指示があったときだけ行う。コミット対象にふさわしくない情報が入っていないか確認する。
   - ローカル環境の情報: 絶対パス（ユーザー名を含むホームディレクトリ等）、ホスト名、個人のツール設定
   - 個人情報: 氏名、メールアドレス、アカウント名（同梱ライブラリの LICENSE の著作権表示は除く）
   - 会話やプロンプトに含まれる個人的な内容・経緯
   - 秘密情報: トークン、パスワード、社内 URL
   - 確認例: `git diff --cached | grep -n -i -E '/Users/|/home/|C:[/\\]|@[a-z0-9-]+\.[a-z]+|token|password'`（誤検知は目視で除外）

## サプライチェーン対策

- Python の依存は `flask` と `nepub` のみ。`uv.lock` をコミットし、PyPI のパッケージはハッシュで固定する。nepub は `pyproject.toml` でも git のコミットを指定する（`uv lock --upgrade` で未確認の最新コミットに上がらないように）。ビルドは `uv sync --frozen`。
- `uv.lock` の更新はホストで行わず、Dockerfile と同じ python・uv のイメージに git を入れた一時イメージで、リポジトリをマウントして `uv lock` を実行する。
- Docker イメージ（python・uv、GitHub Actions で使う node）はバージョンと digest（`@sha256:...`）で固定する。
- GitHub Actions のアクションは、タグではなくコミット（40 桁の SHA）で固定し、どの版かをコメントに書く。コミットは `https://api.github.com/repos/<owner>/<repo>/commits/<タグ>` の `sha` で確かめる。ワークフローの権限は `contents: read` だけにする。
- 依存とイメージが古くなっていないかは、ときどき確かめる: 固定している版の脆弱性の報告は `https://pypi.org/pypi/<pkg>/<version>/json` の `vulnerabilities`、python のイメージのタグと更新日は `https://hub.docker.com/v2/repositories/library/python/tags?name=3.12.`、uv は GitHub のリリース一覧で分かる。Python 3.12 はセキュリティ修正だけの系列なので、新しい版が出ていたら上げる。
- Docker Hub の応答には、タグの digest（`digest`）と、アーキテクチャごとのイメージの digest（`images[].digest`）がある。Dockerfile に書くのはタグの digest で、`docker inspect` の `RepoDigests` と一致する。
- 依存・イメージを追加・更新するときは:
  1. 本当に必要か（自前で書けないか）を検討する
  2. 公式・実績のあるものか確認する
  3. 公開から 7 日以上経った版を選ぶ（uv は GitHub のリリース日、PyPI は `https://pypi.org/pypi/<pkg>/json` の `upload_time` で確認）
  4. digest は `docker pull <image>:<tag>` → `docker inspect --format '{{index .RepoDigests 0}}' <image>:<tag>` で取得する
  5. `uv.lock` の差分を確認する

## 同梱の epub-viewer

- 取り込み元: https://github.com/ttk1/epub-viewer の `v2.0.0`（コミット `0dd5780`。リリース前の確認として取り込んだもので、公開時にタグが別のコミットに付いたら、そのコミットで取り込み直してここを更新する）。npm には公開されていないので、ビルド成果物を同梱している。
- 更新手順: epub-viewer でタグをチェックアウトし、`docker compose run --rm node sh -c "npm ci && npm run build"` → `dist/src/` の中身と `LICENSE` を `nepub_reader/static/epub-viewer/` に上書きコピー（消えたファイルは削除）→ 上の取り込み元のタグ・コミットを更新 → 動作確認。
- API と挙動は epub-viewer の README.md を参照。ページ送り（キー・クリック・スワイプ・ホイール、リモコンのチャタリング対策）と表示設定（テーマ・フォント・行間・表示幅など）は epub-viewer 側の機能なので、こちらで作り直さない。
- `reader.js` が使うのは公開 API だけ（`reader.toolbar` と、作品名・話タイトルの表示に使う `.title` 要素も公開 API）。ツールバーのそれ以外の中身には頼らない。
- 更新時は、前の版が localStorage に保存した設定（`nepub-reader:settings`）がそのまま使えるかも確認する。`theme.js` もこの設定の `theme` を読んでいる。
- `reader.css` の `height` の `vh` と `dvh` の併記、`overscroll-behavior: none` は epub-viewer の README の勧めに従ったもの。

## 設計メモ・ハマりどころ

- **話の移動**: リーダー画面はページを遷移せずに次/前の話を読み込み、URL は `history.replaceState` で書き換える（リロードで同じ話が開く）。`bookend` / `bookstart` はキーを押すたびに発生するので、読み込み中は `loading` で無視する。
- **次の話の有無**: なろうは話数 +1 を開いてみて 404 なら最新話。カクヨムは前後の話の ID を `/epub/kakuyomu/...` のレスポンスヘッダー（`X-Prev-Episode` / `X-Next-Episode`）で返し、次話がないときだけ `/api/kakuyomu/next-episode/...` で 1 回再確認する（キャッシュ作成後に次話が公開された場合のため）。前後の ID は EPUB とは別の `.nav.json` に保存しているので、再確認で更新するのはそれだけ（本文の EPUB は作り直さない）。最新話と分かったら、その話を開いている間は自動では再確認しない（キーを押すたびに元サイトへアクセスしないように）。知らせの「再確認」ボタンを押したときだけ確かめ直す。再確認そのものが失敗したとき（元サイトの不調など）も同じで、自動では繰り返さず、ボタンでやり直す。
- **読書履歴と読書位置**: localStorage `nepub_reading_history` に作品ごとの最新の話を最大 50 件保存する。項目は `site` / `novel_id` / `novel_title` / `episode_title` / `last_episode` / `last_accessed` / `position`。エクスポートしたファイルとの互換のため、既存の項目の名前と意味は変えない（足すのはよい）。`last_episode` はなろうなら話数（数値）、カクヨムならエピソード ID（文字列）。`site` がない古い履歴はなろうとして扱う。履歴は読むたびに検証し、使えない項目を除く（`getHistory` → `sanitizeHistoryItem`。壊れた項目が 1 つあるだけで、一覧や記録が止まらないように）。`position` はその話の読書位置（EpubViewer の `location`）で、ない履歴もある。
- **読書位置を EpubReader に保存させない**: 位置は作品ごとに最新の 1 話分だけあればよく、履歴と一緒に消したり移したりしたいので、履歴の項目に持たせている。EpubReader には `storage` オプションで設定（`nepub-reader:settings`）だけを保存させ、位置は `open()` の `location` で渡して `relocate` で保存する。以前の版が保存した `nepub-reader:position:*` は、`history.js` が読み込み時に履歴へ移して消す。
- **履歴のデータ処理は `history.js` に置く**: 保存・検証・統合など、画面に触らない処理は `history.js` に書いてテストする。`index.js` と `reader.js` は読み込むと画面を操作するので、Node.js のテストからは読み込めない。
- **epub-viewer の不具合は epub-viewer で直す**: 同梱の epub-viewer の不具合を見つけたら、こちらに回避策を入れずに、再現条件と原因をまとめて報告する（ユーザーの方針）。
- **知らせ（読み込み中・最新話・エラー）**: ツールバーではなく画面下の `#status` に出す（ツールバーはページ中央のタップで隠せるので）。ページをめくると消すが、ツールバーの出し入れでも `relocate` が発生するので、その分は `relayout` で見分けて消さない。
- **文字サイズの初期値**: EpubReader の既定（45px）は離れて読む大きな画面向けなので、狭い画面（幅か高さが 600px 以下。横向きのスマートフォンを含む）では `settings` オプションで 24px を初期値にしている。利用者が変えた後は、保存された値が使われる。
- **キー操作**: ページ送りのキーは epub-viewer が受ける。こちらが足したのは N（次の話）と P（前の話）だけ。本文をクリックした後はキーが本文の文書に届くので、`sectionload` で渡される文書にもリスナーを付けている。
- **トップページの一覧の更新**: ブラウザの「戻る」で戻ったとき（`pageshow` の `persisted`）と、ほかのタブで履歴が変わったとき（`storage`）に描き直す。
- **ツールバーを隠した状態**: localStorage `nepub-reader:toolbar` に覚える。
- **EPUB のメタデータ**: 作品名は `book.metadata.title`、話タイトルは `book.toc[0].label`。
- **作品名の取り出し**: サーバーはページの `<title>` から話タイトルを除いて作品名を得る。そのために nepub のパーサーの内部属性 `_title`（tcy 加工前の話タイトル）を使っているので、nepub を更新したら作品名が正しく取れるか確認する（テストがある）。これができていなかった頃のキャッシュを使わないよう、キャッシュの版を `v2` にした。
- **EPUB の中身**: 書き出しは nepub の `write_epub` に任せる。本文の CSS は nepub 標準のままで、行間などの見た目は epub-viewer の既定と設定に任せ、EPUB 側では上書きしない（キャッシュ済みの EPUB に焼き込まれて後から変えられないため）。表示のしかたをこのアプリの都合で変えたいときは、`reader.js` の `PAGE_STYLE`（`sectionload` で各ページに足すスタイル）に書く。いまあるのは、高さの低い画面で話タイトルの上下の余白を縮める指定だけ。
- **キャッシュ**: `episodes.py` の `CACHE_VERSION` のフォルダに保存する。EPUB の作り方を変えて前のキャッシュを使わせたくないときは版を上げる（前の版のフォルダは起動時に `remove_old_caches` が消す）。合計が `MAX_CACHE_BYTES` を超えたら、更新時刻の古い話から消す（読むたびに更新時刻を新しくしている）。EPUB として読めないキャッシュ（途中で切れたファイルなど）は、ないものとして作り直す。キャッシュの手入れ（古い版の削除、上限の整理、更新時刻の変更）は、失敗しても話を返すのを妨げない。
- **なろうの短編**: 話に分かれていない作品で、話のページがなく（1 話の URL は 404）、作品ページに本文がある。作品ページは話のページと同じ作りなので、1 話が 404 のときに作品ページを話として読み、本文があれば 1 話として扱う（`_fetch_narou_short_story`。連載の作品ページには本文がない）。短編だと分かるよう、前後の話がないことを `.nav.json` に保存してヘッダーで返す（リーダーは、なろうでこのヘッダーがあれば短編として扱い、次の話を探さず、元ページのリンクを作品ページにする）。
- **挿絵が取れない話**: なろうの挿絵は nepub のパーサーが取得する。取得に失敗する（削除された画像、想定しない URL）と例外になるので、そのときは挿絵なしで作り直す（`_parse_episode`）。挿絵の 404 を話の 404 として外へ出すと、リーダーが「最新話です」と誤って知らせる。
- **元サイトへのアクセス**: `episodes.py` のロックで同時に 1 つにし（同じ話の二重取得も防ぐ）、ページの取得は `FETCH_INTERVAL`（1 秒）空ける。リーダーの N / P キーは押しっぱなしでは働かせない。話を次々に飛ばしても、元サイトに負荷をかけないため。作品 ID・話は `is_valid_episode` を通したものだけを、キャッシュのファイル名と元サイトの URL に使う。
- **CSP**: `app.py` の `CONTENT_SECURITY_POLICY` で全レスポンスに付ける。インラインスクリプトは禁止なので、JS は `static/` のファイルに書く。epub-viewer が書籍を blob: URL で表示するため `frame-src blob:` などを許可している（必要な指定は epub-viewer の README の「セキュリティ」）。`frame-ancestors` を `'none'` にすると、WebKit では本文の blob: のフレームにも引き継がれて本文が表示されなくなる（`'self'` にしている）。変更したら 3 ブラウザで CSP 違反が出ないか確認する。
- **ほかのサイトからのリクエスト**: `/epub/` と `/api/` は元サイトへのアクセスを起こすので、`Sec-Fetch-Site` が `cross-site` / `same-site` のリクエストを断る（ほかのサイトのページに、このサーバーを踏み台にさせない）。`/go`（カクヨムの作品ページを取得することがある）は、ほかのサイトからはページとして開く場合（`Sec-Fetch-Dest: document`）だけ通す。
- **モジュールの先読み**: リーダー画面の HTML に、使う JS のモジュールを `<link rel="modulepreload">` で並べている（`app.py` の `READER_MODULES`。同梱の epub-viewer のファイルから自動で作る）。モジュールが次のモジュールを呼ぶたびに通信の往復が増えるのを避けるためで、遅延 100ms の通信で、最初のページが出るまでの時間が約 700ms から約 600ms になる。`reader.js` が読み込むファイルを増やしたら、`READER_MODULES` にも足す（足し忘れると約 700ms に戻る）。ブラウザは同じサーバーに同時に 6 本までしか接続しないので、HTML の後に読み込むファイル（CSS・JS）の数が 6 の倍数をまたぐと、往復が 1 回増える（12 個までなら約 500ms、いまは 14 個で約 600ms）。この境目に合わせるための細工（CSS の埋め込みなど）はしていない。読み込みまわりを変えたら、遅延を入れて測り直す（Chromium なら CDP の `Network.emulateNetworkConditions`）。
- **アイコンの書き出し**: `icon.svg` を変えたら PNG を作り直す。Playwright イメージのブラウザで、SVG を 192・512・180px のページに表示してスクリーンショットを撮る（`icon-192.png`、`icon-512.png`、`apple-touch-icon.png`）。画像を作る道具はホストに入れない。
- **待ち受けるアドレス**: 既定は 127.0.0.1（この PC だけ）。Docker のイメージは `HOST=0.0.0.0` を指定していて、公開する範囲は `docker run -p` で決める。
- **Docker のビルドコンテキスト**: `.dockerignore` は、Dockerfile が COPY するものだけを通す書き方にしている。COPY するものを増やしたら `.dockerignore` にも足す。
- **ページのテーマ**: `theme.js` が EpubReader の設定（`nepub-reader:settings` の `theme`）を読んで `<html data-theme>` を決める。トップページの配色は `index.css` の `:root[data-theme=...]`。リーダー画面では、EpubReader の準備ができるまでの背景色に使う（`reader.css`。ダークやセピアで、開いた直後に白く光らないように）。色は epub-viewer の `themes` と同じ値を書いているので、epub-viewer の更新で変わっていないか確かめる。`theme.js` は端末の上部の帯の色（`<meta name="theme-color">`）もページの背景に合わせる。リーダーでテーマを変えたときは、設定の保存のところ（`reader.js` の `settingsStorage`）から `nepub-reader:settings` イベントを出し、`theme.js` がそれを受けて合わせ直す。

## ブラウザでの確認

epub-viewer の Playwright イメージ（epub-viewer の `compose.yaml` と同じ digest）を使う。ホストには何も入れない。

- アプリのコンテナとテスト用コンテナを同じ Docker ネットワークにつなぎ、コンテナ名でアクセスする。
- Playwright は epub-viewer の `node_modules` ボリュームを読み取り専用でマウントし、`NODE_PATH` を指定して CommonJS のスクリプトから `require('@playwright/test')` する。確認用スクリプトはリポジトリに入れない。
- Playwright イメージの既定のフォントでは縦書きの漢字が重なって描画される。スクリーンショットを撮るときは和文フォント（Windows なら `C:/Windows/Fonts/yumin.ttf` など）を読み取り専用で `/usr/share/fonts/` にマウントし、`fc-cache -f` してから撮る。フォントはコミットしない。
- スワイプは、Chromium なら CDP の `Input.dispatchTouchEvent`（`touchStart` → `touchMove` を数回 → `touchEnd`）で再現できる。Firefox と WebKit は、本文の iframe の文書に `TouchEvent` を合成して送る（Linux の WebKit は `Touch` を作れないので、`touches` などを持たせた `Event` で代える）。
- `page.route()` でページ自体（`/read/...`）のレスポンスを差し替えると、Chromium では続く静的ファイルの読み込みが止められることがある。
- 元サイトへのアクセスは最小限にする（同じ話はキャッシュが使われる）。最新話や読み込みの失敗は `page.route()` でレスポンスを差し替えて再現する（差し替えた 404 は、Chromium と WebKit ではコンソールのエラーとして記録される）。
- Playwright の `click()` は、クリックで始まった画面遷移が終わるまで戻らない。遷移の途中の状態（送信中のボタンなど）は、ページの中で記録しておいて後から読む。
- 画面の大きさは、Playwright の `devices`（`iPhone 15`、`iPhone 15 landscape`、`Pixel 7`、`iPad (gen 7)` など）とテレビ相当（1920×1080）でも確かめる。横向きのスマートフォンは幅が 600px を超えるので、幅だけで判定している処理が漏れやすい。
- 挿絵のある話は、元サイトにアクセスせずに確かめられる: コンテナの中で `episodes._write_episode_epub` に、`images`（PNG のバイト列を持つ）と `<img src="../image/<名前>"/>` の段落を持つ偽のパーサーを渡して EPUB を作り、キャッシュに置いて開く。
- WebKit は、`try` で捕まえたフレームへのアクセス違反（`Blocked a frame at ...`）もコンソールにエラーとして記録する。`pageerror` に出ても、捕まえ損ねた例外とは限らない（スタックで場所を確かめる）。
- 壊れた保存データ（`nepub_reading_history` に `null` や型の違う値、`nepub-reader:settings` に壊れた JSON）と、localStorage が使えない環境（`addInitScript` で `localStorage` の取得を例外にする）でも、トップページとリーダーが動くか確かめる。
- 配色を変えたら、文字のコントラストを 3 つのテーマで計算して確かめる（`getComputedStyle` の色と `opacity` を、親までさかのぼって背景に重ねてから比べる）。文字は 4.5:1 以上、アイコンは 3:1 以上。`opacity` で薄くすると、色の指定だけ見ていても気付かない。
- 見た目は、ふだん通らない状態でも確かめる: 長いエラーの知らせ（`page.route()` で `/epub/` に EPUB でないものを返す）、履歴が空のとき、履歴が 50 件で長いタイトルのとき。
- スマホ幅（390px 程度、タッチあり）でも確認する。はみ出しは `scrollWidth` では見つからないことがあるので、要素の位置かスクリーンショットで確かめる。
