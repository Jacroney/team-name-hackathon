# FlareNet

Desktop-first emergency operations console for reviewing, claiming, and dispatching live incidents.

## Run locally

```bash
npm install
npm run dev
```

The app uses an in-browser demo incident feed when no environment variables are set. To connect a backend, copy the variable names from `.env.example` into `.env.local` and set the API, WebSocket, and jurisdiction values.

## Commands

```bash
npm run build
npm test
npm run test:e2e
npm run deploy
```

`npm run deploy` builds the Vite SPA and deploys `dist/` through Cloudflare Workers Static Assets. The default live build remains in demo mode until `VITE_API_URL` and `VITE_WEBSOCKET_URL` are configured during the frontend build.

## Cloudflare setup

The Worker binds Durable Objects, Queues, Containers, R2, D1, Workflows, Workers AI, AI Gateway, Vectorize, Analytics Engine, Flagship, AI Search, Images, Stream, Browser Rendering, Pipelines, and Email Sending.

1. Create or bind the D1 database named `crisis-mesh-operations`, then run `npx wrangler d1 migrations apply crisis-mesh-operations --remote`.
2. Create the `crisis-mesh-evidence` R2 bucket, AI Search instance `crisis-mesh-sops`, and Pipeline stream `crisis-mesh-audit` before deployment.
3. Configure Cloudflare Access for the operator hostname. Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`; the Worker validates the Access JWT and derives the dispatcher identity from it. These integrations are disabled in the initial live deployment.
4. Enable Email Sending for a verified domain with `npx wrangler email sending enable <domain>`, then set `EMAIL_FROM` and `SUPERVISOR_EMAIL` as Worker variables. Email is disabled in the initial live deployment.
5. Set `DISPATCH_WEBHOOK_URL` to send a real agency dispatch request. The webhook is disabled in the initial live deployment.
6. Configure WAF rate limiting and API Shield rules in the dashboard for `/sos` and any agency ingestion routes. These are zone-level controls and are not Worker bindings.

The new API endpoints are `POST /api/guidance`, `POST /api/media/image-upload`, `POST /api/media/video-upload`, `POST /api/incidents/:id/evidence`, `GET /api/evidence/:key`, and `GET /api/incidents/:id/report`.

## API contract

All mutations send an `expectedVersion`. The server should return HTTP `409` or `412` when that version is stale. Successful responses return the full updated incident and are validated with the shared Zod schema before entering the TanStack Query cache.

- `GET /incidents`
- `GET /incidents/:id`
- `POST /incidents/:id/claim`
- `POST /incidents/:id/dispatch`
- `POST /incidents/:id/actions`

The jurisdiction WebSocket accepts `incident.created`, `incident.patch`, `presence`, and `heartbeat` events. See `src/lib/schemas.ts` for the exact payloads.
