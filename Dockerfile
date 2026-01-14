FROM python:3.12-slim

WORKDIR /app

# git をインストール（nepub が git リポジトリから取得されるため必要）
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# uv をインストール
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# 依存関係ファイルとソースコードをコピー
COPY pyproject.toml uv.lock README.md ./
COPY nepub_reader/ ./nepub_reader/

# 依存関係をインストール（プロジェクト自体も含む）
RUN uv sync --frozen --no-dev

# Bibi をコピー
COPY bibi/ ./bibi/

# bibi-bookshelf ディレクトリを作成（キャッシュ用）
RUN mkdir -p bibi-bookshelf/narou

# 非 root ユーザーを作成して切り替え
RUN useradd --create-home appuser && \
    chown -R appuser:appuser /app
USER appuser

# ポートを公開
EXPOSE 5000

# アプリケーションを起動
CMD ["uv", "run", "nepub-reader"]
