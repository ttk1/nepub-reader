# イメージは digest で固定（更新手順は CLAUDE.md）
FROM python:3.12.15-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704

# ログを即時出力する（docker logs で確認できるように）
ENV PYTHONUNBUFFERED=1
# コンテナの外（公開したポート）から届くようにする。公開する範囲は docker run の -p で決める
ENV HOST=0.0.0.0

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
RUN mkdir -p epub-cache

# 非 root ユーザーを作成して切り替え
RUN useradd --create-home appuser && \
    chown -R appuser:appuser /app
USER appuser

# ポートを公開
EXPOSE 5000

# アプリケーションを起動（依存はビルド時に入れ済みなので uv を介さず直接起動する）
CMD ["/app/.venv/bin/nepub-reader"]
