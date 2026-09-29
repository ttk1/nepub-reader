# イメージは digest で固定（更新手順は CLAUDE.md）
FROM python:3.12.14-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f

# ログを即時出力する（docker logs で確認できるように）
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# git をインストール（nepub が git リポジトリから取得されるため必要）
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# uv をインストール
COPY --from=ghcr.io/astral-sh/uv:0.12.17@sha256:10787c682e4184e4f290de1171fd4703dc63de99221f10fe1c99002ce7fa9acc /uv /usr/local/bin/uv

# 依存関係ファイルとソースコードをコピー
COPY pyproject.toml uv.lock README.md ./
COPY nepub_reader/ ./nepub_reader/

# 依存関係をインストール（プロジェクト自体も含む）
RUN uv sync --frozen --no-dev

# EPUB のキャッシュ用ディレクトリ
RUN mkdir -p epub-cache/narou epub-cache/kakuyomu

# 非 root ユーザーを作成して切り替え
RUN useradd --create-home appuser && \
    chown -R appuser:appuser /app
USER appuser

# ポートを公開
EXPOSE 5000

# アプリケーションを起動（依存はビルド時に入れ済みなので uv を介さず直接起動する）
CMD ["/app/.venv/bin/nepub-reader"]
