# Local development

## Prerequisites

- Node 22+
- pnpm 10.18.0 (`corepack enable && corepack prepare pnpm@10.18.0 --activate`)
- A MySQL 8 compatible database

## Setup

```bash
pnpm install
cp .env.example .env    # then fill in DATABASE_URL and UPTIMEPULSE_ENCRYPTION_KEY
pnpm db:migrate
pnpm dev
```

The app is served on `http://localhost:3000`.

## Quality gates

```bash
pnpm check         # tsc --noEmit
pnpm lint          # oxlint, warnings denied
pnpm test          # vitest
pnpm build         # vite build + esbuild server bundle
pnpm format:check  # prettier over the whole repo
```

## Running the checks locally

The scheduler endpoint expects a JWT signed with `MANUS_JWT_SECRET` and an
`appId` matching `MANUS_PROJECT_ID`. Without the platform runtime you can mint
one and drive the pipeline by hand:

```bash
TOKEN=$(node scripts/make-cron-token.mjs)
curl -X POST -H "Cookie: app_session_id=$TOKEN" http://localhost:3000/api/scheduled/checks
```

The endpoint answers `{accepted, processed, retriedNotifications, batchSize}`.
`processed` counts monitors whose 6 minute lease was claimed; a value of `0`
with `due > 0` means the monitors are not due yet, so either wait for
`nextCheckAt` or reset it directly in the database.

## Timezone note

The connection timezone is pinned to UTC in `server/db.ts`. MySQL otherwise
uses the host's local zone for `NOW()` and `TIMESTAMP` conversions while Node
writes `new Date()` values in UTC; on a non-UTC host the two disagree and
`nextCheckAt <= now()` stops matching, which silently stalls the scheduler. A
database provisioned with existing rows in a local zone needs a one-off
conversion to UTC.

## Local database

The bundled `Dockerfile` is for deployment. For a throwaway local instance any
MySQL 8 server works, including one initialised with:

```bash
mysqld --initialize-insecure
mysqld --defaults-file=/path/to/my.ini
```

The server listens on `127.0.0.1:3306` with `bind-address=127.0.0.1`.
