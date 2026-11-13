# イメージは digest で固定（更新手順は CLAUDE.md）

# ---- ビルド用: 依存を入れる。git と uv は、ここでしか使わない ----
FROM python:3.12.15-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704 AS builder

WORKDIR /app

# git をインストール（nepub が git リポジトリから取得されるため必要）
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# uv をインストール
COPY --from=ghcr.io/astral-sh/uv:0.13.7@sha256:96f40d3904aad8d0bd010539001d36c8e2188b981e1334471a90c4a1d93bb490 /uv /usr/local/bin/uv

# 依存関係ファイルとソースコードをコピー
COPY pyproject.toml uv.lock README.md ./
COPY nepub_reader/ ./nepub_reader/

# 依存関係をインストール（プロジェクト自体も含む）。起動を速くするため、バイトコードも作っておく
RUN UV_COMPILE_BYTECODE=1 uv sync --frozen --no-dev

# ---- 実行用: アプリと依存だけを入れる ----
FROM python:3.12.15-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704

# ログを即時出力する（docker logs で確認できるように）
ENV PYTHONUNBUFFERED=1
# コンテナの外（公開したポート）から届くようにする。公開する範囲は docker run の -p で決める
ENV HOST=0.0.0.0

WORKDIR /app

COPY --from=builder /app /app

# 非 root ユーザーで動かす。書き込めるのは EPUB のキャッシュだけにする（アプリのコードは書き換えられない）
RUN useradd --create-home appuser && \
    mkdir -p epub-cache && \
    chown appuser:appuser epub-cache
USER appuser

# ポートを公開
EXPOSE 5000

# アプリケーションを起動（依存はビルド時に入れ済みなので uv を介さず直接起動する）
CMD ["/app/.venv/bin/nepub-reader"]
