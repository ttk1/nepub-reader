# nepub-reader

小説家になろう・カクヨムの作品を縦書き表示で快適に読めるリーダーです。

## 特徴

- 縦書き表示で小説家になろう・カクヨムの作品を読める
- ダークモード対応（システム設定に連動）
- 矢印キー（←/→）で次/前のエピソードへ自動移動
- 読書履歴機能（最近読んだ作品をトップページに表示）

## セットアップ

### 必要なもの

- Python 3.10 以上
- uv（Python パッケージマネージャー）

### インストール

```bash
uv sync
```

### サーバー起動

```bash
uv run nepub-reader
```

ブラウザで http://localhost:5000/ にアクセスしてください。

### Docker で起動

```bash
# ビルド
docker build -t nepub-reader .

# 実行
docker run -p 5000:5000 nepub-reader
```

キャッシュを永続化したい場合はボリュームをマウントしてください：

```bash
docker run -p 5000:5000 -v nepub-cache:/app/bibi-bookshelf nepub-reader
```

## 使い方

トップページのフォームに小説家になろうまたはカクヨムのURLを入力して「読む」ボタンを押します。

- **小説家になろう**
  - エピソードURL（`https://ncode.syosetu.com/nXXXXXX/1/`）→ その話から開始
  - 小説トップURL（`https://ncode.syosetu.com/nXXXXXX/`）→ 1話から開始
- **カクヨム**
  - エピソードURL（`https://kakuyomu.jp/works/XXXXX/episodes/XXXXX`）

### 操作方法

- **← / →キー**: 次/前のページへ移動（端に到達すると次/前のエピソードへ）
- **メニューバー**: 文字サイズ変更

## キャッシュ

生成された EPUB ファイルは `bibi-bookshelf/` ディレクトリにキャッシュされます。
キャッシュを削除したい場合は、このディレクトリ内のファイルを削除してください。

## ライセンス

このプロジェクトは以下のオープンソースソフトウェアを使用しています：

- [Bibi](https://github.com/satorumurmur/bibi) - EPUB リーダー（MIT License）
- [nepub](https://github.com/ttk1/nepub) - EPUB 生成ツール（MIT License）

## 免責事項

本プロジェクトは株式会社ヒナプロジェクトおよび株式会社 KADOKAWA とは一切関係がありません。

「小説家になろう」は、株式会社ヒナプロジェクトの登録商標です。「カクヨム」は、株式会社 KADOKAWA の登録商標です。

本プロジェクトのコーディングはすべて Claude Code（AI アシスタント）によって行われています。

本プロジェクトは個人での利用を想定しており、インターネット上に公開してのサービス運用は想定していません。

本プロジェクトの使用によって生じたいかなる損害・結果についても、作者は一切の責任を負いません。ご使用は自己責任でお願いいたします。
