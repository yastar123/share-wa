# ShareWa

ShareWa is a consent-first workspace for managing contacts, linking your own WhatsApp account, and sending limited, permission-based messages.

## Run & Operate

- The `artifacts/sharewa: web` and `artifacts/api-server: API Server` workflows run the app and API in preview. The web artifact's production server runs the root Express app so frontend routes and `/api` share the same origin.
- `pnpm install --frozen-lockfile` — install workspace dependencies
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm db:push` — load root `.env`, create the configured PostgreSQL database if it does not exist, push the schema, sync the configured admin account, and verify login plus admin access
- `deploy-sharewa.sh` — VPS deployment helper; copy it to the server and run as root. Configure `APP_DIR`, `BACKUP_DIR`, `WEB_DIR`, and `PM2_APP_NAME` if they differ from the defaults. If unset, the script detects the single PM2 app running from the repository directory. Database push is opt-in with `RUN_DB_PUSH=1`.
- For Nginx-hosted VPS deployments, add `deploy/nginx-sharewa-location.conf` inside the site's existing `server` block so same-origin `/api/` requests are proxied to the API on port 3000. Validate with `nginx -t` and reload Nginx after installing it.
- Replit provides PostgreSQL through the runtime-managed `DATABASE_URL`. No Clerk account or key is used.
- Add a stable `SESSION_SECRET`, `SHAREWA_ADMIN_EMAIL`, and `SHAREWA_ADMIN_PASSWORD` through Replit Secrets. The API creates or updates the initial administrator at startup when the email is valid and the password is 12–128 characters; otherwise the API stays online without an admin account.
- Set `PUBLIC_APP_URL` to the canonical site URL for complete referral links.
- Set the frontend `VITE_SUPPORT_TELEGRAM_URL` to an HTTPS `t.me` support link to show the dashboard help action.
- Configure `RESEND_API_KEY`, `MAIL_FROM`, and `PUBLIC_APP_URL` to enable one-time password reset email links. New registrations require an email address; reset tokens expire after 30 minutes and can be used once.
- User passwords are stored as scrypt hashes. Login sessions use expiring, HttpOnly cookies and hashed tokens in PostgreSQL.
- Password recovery uses hashed, single-use 30-minute reset tokens, sends via Resend, and invalidates all existing sessions after a reset.
- Link only a WhatsApp account you own or are authorized to use. Pair with a temporary QR code or phone-number code. Messages require recorded consent and are limited to batches of five, twenty attempts per hour, and a three-second pause between sends.
- The wallet supports IDR, USD, and CNY. Administrators configure enabled currencies, minimum withdrawals, per-message earnings, and referral commissions; withdrawals are reviewed and paid manually outside ShareWa.
- Withdrawal is not an automatic payment: the administrator verifies the saved destination, transfers funds manually through a bank or e-wallet outside ShareWa, and only then marks the request as paid in the admin dashboard.

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
- `lib/db/src/schema/admin.ts` — admin roles and system/currency settings

## Architecture decisions

- All contact, message, activity, linked-device, and wallet records are scoped to the authenticated application user.
- WhatsApp credentials and payout destination details are encrypted before storage using the stable `SESSION_SECRET`.
- Contact creation requires a positive consent confirmation and a source; opt-out immediately blocks future sends.
- Message sending is intentionally limited to opted-in contacts, small batches, and hourly quotas.

## Product

- Dashboard for connection, consent, message, and activity status.
- Contact book with search, consent filters, permission history, opt-out, edits, and deletion.
- One-to-one message history and composer for opted-in contacts.
- Profile, preferred language, and WhatsApp linked-device settings.
- Persistent user notifications for send and withdrawal events, plus unread/read controls.
- Wallet balance, referral tracking, payout destinations, and withdrawal history; admin currency configuration and manual withdrawal review.
- Drizzle schema discovery for `db push` explicitly loads `sharewa.ts` and `admin.ts`, so it includes `sharewa_payout_preferences`, `sharewa_wallet_ledger`, `sharewa_withdrawals`, and the other application/admin tables.
- Indonesian, English, and Simplified Chinese interface languages.
- Local development shows quick-fill credentials for seeded demo accounts. Those public demo accounts and controls are disabled in production; configure the production administrator through secrets.

## Gotchas

- Apply development schema changes with `pnpm --filter @workspace/db run push`; review and apply production schema changes through the production database migration process, not an unreviewed schema push.
- After changing `lib/api-spec/openapi.yaml`, run the API codegen script before changing API/client code that depends on those schemas.
- The app preview screenshot shows the public landing page; authenticated workspace pages require an application account.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
