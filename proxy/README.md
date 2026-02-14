# Aeris OpenSky Proxy

Lightweight API proxy for OpenSky Network, designed to run on Railway (or any Node.js hosting) to avoid IP blocks from cloud platforms like Vercel.

## Deploy to Railway

1. **Create a new Railway project** → "Deploy from GitHub Repo"
2. **Set the root directory** to `proxy/`
3. **Add environment variables:**
   - `OPENSKY_CLIENT_ID` — your OpenSky OAuth2 client ID
   - `OPENSKY_CLIENT_SECRET` — your OpenSky OAuth2 client secret
   - `ALLOWED_ORIGINS` — comma-separated list of allowed origins (e.g., `https://aeris-flight.vercel.app,http://localhost:3000`)
4. Railway auto-detects Node.js and deploys

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (auto-set by Railway) |
| `OPENSKY_CLIENT_ID` | No | OAuth2 client ID for authenticated access |
| `OPENSKY_CLIENT_SECRET` | No | OAuth2 client secret |
| `OPENSKY_USERNAME` | No | Basic auth username (fallback) |
| `OPENSKY_PASSWORD` | No | Basic auth password (fallback) |
| `ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins |

## After Deploying

Copy the Railway public URL (e.g., `https://aeris-proxy-production.up.railway.app`) and add it to your Vercel project:

```
OPENSKY_PROXY_URL=https://aeris-proxy-production.up.railway.app
```

Then remove the `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` from Vercel (they only need to be on Railway).
