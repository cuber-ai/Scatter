FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache git
COPY apps/jackpot-service/go.mod apps/jackpot-service/go.sum* ./
RUN go mod download
COPY apps/jackpot-service/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o jackpot-service ./cmd/

FROM scratch
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/jackpot-service /jackpot-service
EXPOSE 9000
ENTRYPOINT ["/jackpot-service"]
