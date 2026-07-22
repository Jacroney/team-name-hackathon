# Crisis Mesh

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

`npm run deploy` builds the Vite SPA and deploys `dist/` through Cloudflare Workers Static Assets. `wrangler.jsonc` enables SPA navigation fallback for React Router incident URLs.

## API contract

All mutations send an `expectedVersion`. The server should return HTTP `409` or `412` when that version is stale. Successful responses return the full updated incident and are validated with the shared Zod schema before entering the TanStack Query cache.

- `GET /incidents`
- `GET /incidents/:id`
- `POST /incidents/:id/claim`
- `POST /incidents/:id/dispatch`
- `POST /incidents/:id/actions`

The jurisdiction WebSocket accepts `incident.created`, `incident.patch`, `presence`, and `heartbeat` events. See `src/lib/schemas.ts` for the exact payloads.
