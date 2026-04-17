FROM rust:1.88.0 AS builder

WORKDIR /app/OCPQ
COPY . /app/OCPQ
RUN cargo install --path backend/web-server --locked

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/cargo/bin/ocpq-web-server /usr/local/bin/ocpq-web-server
EXPOSE 3000
ENTRYPOINT ["ocpq-web-server"]
