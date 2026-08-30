# Aeris ADS-B relay

This directory contains the provider-neutral relay used by Aeris to normalize
authorized ADS-B observations, retain a bounded rolling history, and distribute
viewport-scoped snapshots and updates.

> This repository provides software only and grants no rights to third-party
> aircraft data. Operators must obtain authorization covering access,
> processing, retention, attribution, commercial use, and downstream
> redistribution. The relay may reduce client fanout but does not improve the
> accuracy, completeness, or availability of its upstream sources and is not
> intended for safety-critical use.

The relay does not include a data feed, provider credentials, production
infrastructure configuration, or captured feed payloads. Tests use synthetic
observations only.

## Data flow

```text
authorized readsb output
        |
        v
normalizer -> CRC-framed normalized WAL -> indexed immutable segments
        |                                      |
        +-> current-state batcher               +-> bounded history API
                    |
                    +-> snapshot-first WebSocket subscriptions
```

Raw provider payloads are not persisted. Normalized observations preserve
source and altitude provenance, and history responses report whether the
requested retention window is complete.

## Configuration

All production values are supplied at deployment time. `config.example.env`
documents the supported variables without production defaults, accounts, host
details, or capacity claims.

The HTTP history and snapshot endpoints require a server-side bearer token.
Browser streams require a short-lived Ed25519-signed ticket and an exact allowed
origin. Aeris issues those tickets from its same-origin API route.

## Development

```sh
go test ./...
go run ./cmd/relay
```

Without an authorized readsb URL the process starts in a degraded state and can
still serve liveness information. Do not point it at a third-party endpoint
unless its operator has authorized this use.
