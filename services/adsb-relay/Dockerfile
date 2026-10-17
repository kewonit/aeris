# syntax=docker/dockerfile:1
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/relay ./cmd/relay

FROM alpine:3.22
RUN addgroup -S relay && adduser -S -G relay relay
COPY --from=build /out/relay /usr/local/bin/relay
USER relay
ENTRYPOINT ["/usr/local/bin/relay"]
