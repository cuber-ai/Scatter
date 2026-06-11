FROM rust:1.83-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y libssl-dev pkg-config && rm -rf /var/lib/apt/lists/*
COPY apps/game-server/Cargo.toml apps/game-server/Cargo.lock* ./
# Cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs && \
    cargo build --release && rm -f target/release/game-server
COPY apps/game-server/src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim AS runner
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd -r -s /bin/false scatterx
COPY --from=builder /app/target/release/game-server /usr/local/bin/game-server
USER scatterx
EXPOSE 9001
CMD ["game-server"]
