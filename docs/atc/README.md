# ATC Audio

Aeris maps each ATC channel to one or more audio sources. LiveATC is built in;
authorized community or self-hosted streams can be added through configuration.

## Playback

1. The UI reads logical feeds from `src/lib/atc-feeds.ts`.
2. `/api/atc/sources?icao=KJFK` returns the sources for those feeds.
3. The player requests a source from `/api/atc/stream`.
4. Built-in LiveATC audio is relayed through Aeris. Custom streams redirect to
   the configured URL.
5. On failure, the player tries the next source or a compatible airport feed.

The LiveATC relay provides same-origin audio for reliable playback and Web
Audio visualization. It has a 12-second connection timeout and a four-hour
stream limit. Hosting the relay uses deployment bandwidth.

## Custom Sources

Set `ATC_CUSTOM_SOURCES_JSON` to a JSON object with `providers` and `sources`:

```json
{
  "providers": [
    {
      "id": "community-jfk",
      "label": "JFK Community Receiver",
      "attributionUrl": "https://radio.example.org/about"
    }
  ],
  "sources": [
    {
      "id": "community-jfk-tower",
      "providerId": "community-jfk",
      "feedIds": ["kjfk-tower"],
      "streamUrl": "https://radio.example.org:8443/kjfk-tower.mp3",
      "priority": 50,
      "cors": true
    }
  ]
}
```

- IDs must be unique and may contain letters, numbers, `.`, `_`, `:`, or `-`.
- `providerId` must match a configured provider.
- `feedIds` must exist in `src/lib/atc-feeds.ts`.
- URLs must use HTTPS and cannot contain credentials.
- Lower priorities are tried first. Built-in LiveATC sources use `100`.
- Set `cors` to `true` only when the audio response allows cross-origin Web
  Audio. Streams with `cors: false` play without spectrum analysis.

The app validates this value during startup. Invalid JSON, duplicate IDs,
unknown feeds, unsafe URLs, and invalid field types stop the build. Restart or
redeploy after changing it so the Content Security Policy is rebuilt.

Custom stream URLs are sent to the browser. Do not put secrets in them. Custom
streams are not relayed, so their operator handles listener bandwidth.

## Failover

Sources are tried in this order:

1. Sources for the selected feed, sorted by priority.
2. Other feeds of the same type at the airport.
3. Combined feeds at the airport.

Failed sources cool down for 30 seconds, 1 minute, 2 minutes, then 5 minutes.
The failure count resets after 30 seconds of stable playback. Offline sessions
resume when the browser reconnects, and playback started in one tab stops it in
other Aeris tabs.

## Endpoints

| Endpoint                         | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `/api/atc/sources`               | Returns provider attribution.                |
| `/api/atc/sources?icao=KJFK`     | Returns source candidates for an airport.    |
| `/api/atc/stream?source=<id>`     | Relays or redirects a validated source.      |

Unknown source IDs return `403`; the stream route cannot proxy arbitrary URLs.

## Troubleshooting

- Repeated switching: check whether the source returns live audio rather than
  an HTML error page.
- Audio without visualization: expected when a custom source has `cors: false`.
- Startup failure: follow the `Invalid ATC_CUSTOM_SOURCES_JSON` error path.
- Broken built-in feed: verify its current LiveATC mount and update
  `src/lib/atc-feeds.ts`.

Run ATC and project tests with:

```bash
npm test
```
