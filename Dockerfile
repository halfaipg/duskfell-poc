ARG RUST_VERSION=1.81

FROM rust:${RUST_VERSION}-slim-bookworm AS build
WORKDIR /src

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates pkg-config \
  && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY server/Cargo.toml server/Cargo.toml
COPY server/src server/src
COPY server/data server/data

RUN cargo build --release --locked -p sundermere-server

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 duskfell \
  && useradd --system --uid 10001 --gid duskfell --home-dir /app --shell /usr/sbin/nologin duskfell \
  && mkdir -p /app /data \
  && chown -R duskfell:duskfell /data

WORKDIR /app

COPY --from=build /src/target/release/sundermere-server /usr/local/bin/sundermere-server
COPY client ./client
COPY assets ./assets
COPY server/data ./server/data

ENV CLIENT_DIR=/app/client \
  ASSETS_DIR=/app/assets \
  CONTENT_PATH=/app/server/data/world.json \
  JOURNAL_PATH=/data/journal.jsonl \
  SETTLEMENT_OUTBOX_PATH=/data/settlement-outbox.jsonl \
  BIND_ADDR=0.0.0.0:4107 \
  RUST_LOG=sundermere_server=info,tower_http=info

EXPOSE 4107
VOLUME ["/data"]

USER duskfell:duskfell

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4107/readyz >/dev/null || exit 1

ENTRYPOINT ["sundermere-server"]
