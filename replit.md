# ShareWa

ShareWa is a private, consent-first workspace for managing contacts, linking your own WhatsApp account, and sending one-to-one messages.

## Run & Operate

- The `artifacts/sharewa: web` and `artifacts/api-server: API Server` workflows run the app and API in preview.
- `pnpm install --frozen-lockfile` — install workspace dependencies
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Replit provides PostgreSQL and Clerk Auth. `SESSION_SECRET` is required to encrypt saved WhatsApp session data.
- Set the shared `SHAREWA_INITIAL_ADMIN_EMAIL` environment variable to the first administrator's verified email before setting up admin access; no default admin email is configured.
- Link only a WhatsApp account you own or are authorized to use. Messages are manual, one contact at a time, and require recorded consent.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/sharewa/src/App.tsx` — landing page, authenticated pages, and client-side API flows
- `artifacts/sharewa/src/index.css` — ShareWa visual theme and responsive layouts
- `artifacts/api-server/src/routes/` — authenticated API routes
- `artifacts/api-server/src/lib/whatsapp.ts` — encrypted linked-device session handling and one-to-one sending
- `lib/api-spec/openapi.yaml` — source API contract; generated client and Zod types live in `lib/api-client-react` and `lib/api-zod`
- `lib/db/src/schema/sharewa.ts` — database tables and consent/message records

## Architecture decisions

- All contact, message, activity, and linked-device records are scoped to the authenticated Clerk user.
- WhatsApp credentials are encrypted before storage using `SESSION_SECRET`.
- Contact creation requires a positive consent confirmation and a source; opt-out immediately blocks future sends.
- Message sending is intentionally manual and limited to one opted-in contact per request.

## Product

- Dashboard for connection, consent, message, and activity status.
- Contact book with search, consent filters, permission history, opt-out, edits, and deletion.
- One-to-one message history and composer for opted-in contacts.
- Profile, preferred language, and WhatsApp linked-device settings.
- Login shows public example credentials for read-only admin and user previews; demo routes use fictional data only and never access Clerk or the API.

## Gotchas

- Apply development schema changes with `pnpm --filter @workspace/db run push`; never run this against production.
- After changing `lib/api-spec/openapi.yaml`, run the API codegen script before changing API/client code that depends on those schemas.
- The app preview screenshot shows the public landing page; authenticated workspace pages require a signed-in Clerk session.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
