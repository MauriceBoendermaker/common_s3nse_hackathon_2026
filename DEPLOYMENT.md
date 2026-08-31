# Controlled public demo

Footprint serves its compiled frontend and API from one origin. Start with a public synthetic demo and add only consenting live profiles. This is a bounded hackathon deployment profile, not an unrestricted public audit service.

## Environment

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3001
FOOTPRINT_MODE=restricted
APP_ORIGIN=https://your-demo-domain.example
LIVE_DEMO_NAMES=
PREVIEW_WALLETS=
MAX_PROVIDER_JOBS_PER_HOUR=30
MAX_PROVIDER_CONCURRENCY=2
MOBULA_ACTIVITY_ENABLED=true
TRUSTED_PROXY_IPS=
```

Set `ETH_RPC_URL`, `MOBULA_API_KEY` and optionally `MOBULA_API_URL` using the host's secret configuration. Do not bake `.env` into the image or use frontend environment variables for credentials. Set `APP_ORIGIN` to the exact browser origin, without a path or trailing slash. An incorrect origin blocks browser POST requests, including rehearsal POSTs.

`LIVE_DEMO_NAMES` is a comma-separated list of normalized, consenting profiles. Empty means **no live profiles allowed**. `PREVIEW_WALLETS` is a comma-separated list of consenting EVM addresses allowed for proposed-wallet enrichment/activity. Keep both small; health exposes allowed profile names so users understand the supported demo.

Production mode or binding a non-loopback interface forces restricted mode, even if `FOOTPRINT_MODE=local`. Diagnostics are disabled in restricted mode. GET health and synthetic reports remain available without provider keys.

Put TLS in front of the app. Configure `TRUSTED_PROXY_IPS` with only the actual proxy IPs/CIDRs for your host. It defaults to trusting no forwarded IPs. Without a correct proxy configuration, shared requests may hit the same IP limit; never solve that by blindly trusting every forwarded header.

## Run without Docker

```sh
npm ci
npm run build
npm start
```

Use the environment above in your host configuration. The production process serves `dist/client` and `/api`. Health check: `GET /api/health`. It checks the app, not external provider availability, and does not spend provider quota.

## Docker

```sh
docker build -t footprint .
docker run --rm -p 3001:3001 --env-file .env.hosted footprint
```

Create `.env.hosted` locally from the configuration above with the correct actual origin. It is ignored by Git and Docker. The image runs as Node's non-root user. Docker packaging is supplied; the image still needs a build/smoke check on a machine with Docker installed before publishing.

## Quota model

One process admits at most 30 provider-work jobs/hour and two concurrent jobs by default. Failures consume a job. Excess requests receive 429 without a queue. The hourly and concurrency limits apply across IPs, so rotating IPs cannot bypass them within one process.

A **job is not an API credit**: a normal audit performs ENS resolution, ten record reads, up to four `hasAddr` checks and scoped control reads, plus up to two Mobula portfolio requests. A preview can perform that audit plus up to two new-chain portfolio requests. An activity job can perform scoped ENS reads plus one activity request. RPC libraries may retry requests. Choose a budget appropriate to the sponsor plan; verify actual billing in its dashboard.

The work budget and IP rate limits are memory-only. Restarting resets them. Multiple instances each have their own budget. Run **one replica** for this demo and use the provider's own key/credit cap. A general multi-instance service needs a shared quota store, real authorization and operational review.

Per-IP work limits: audit 8/minute, preview 6/minute, activity 6/minute, local diagnostics 3/minute. Page assets, health and synthetic rehearsals do not consume the provider budget. Origin checks reduce unwanted browser requests but are not authentication; clients without an Origin header still face allowlists and budgets.

## Before making the URL public

- Confirm only team-owned/consenting names and wallets are allowed.
- Verify a random name returns 403; diagnostics return 403.
- Verify the actual browser origin can run a synthetic rehearsal and the intended live audit.
- Check provider key restrictions, endpoint plan access, account spending caps and proxy settings.
- Confirm HTML, JS assets and APIs work in a private browser window.
- Review infrastructure logging; the application disables request/body logging, but a host or proxy may retain metadata.
- Record a synthetic backup and a clearly identified real-profile walkthrough.
- Keep a rollback command and restart instructions available. No persistence or migrations are required.

Publishing, real ENS changes and submission are separate user actions. Do not label a synthetic demonstration as a live update.
