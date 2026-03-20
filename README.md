# MailForge — Cold Email Outreach Platform

Production-ready email marketing and sequencing platform with AI-powered reply classification, visual sequence builder, drag-drop template editor, and full deliverability compliance.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend    │────▶│  PostgreSQL   │
│  React/Vite  │     │  Express/TS  │     │  16 tables    │
│  Tailwind    │     │  REST API    │     └──────────────┘
└──────────────┘     │  4 Workers   │     ┌──────────────┐
                     │              │────▶│    Redis      │
                     └──────┬───────┘     │  BullMQ      │
                            │             └──────────────┘
                     ┌──────┴───────┐
                     │  External    │
                     │  - AWS SES   │  Outbound email
                     │  - Postmark  │  Inbound webhooks
                     │  - Claude AI │  Tone detection
                     │  - Unlayer   │  Email editor
                     └──────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20 + TypeScript + Express |
| Database | PostgreSQL 16 (12 tables, full indexes) |
| Queue | Redis 7 + BullMQ (4 queues) |
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Email Out | Amazon SES (rate-limited, retries) |
| Email In | Postmark (inbound webhook parsing) |
| AI | Claude API (6-category tone detection) |
| Editor | Unlayer (drag-drop email builder) |
| Auth | JWT + bcrypt (12 rounds) |
| Deploy | Docker + docker-compose |

## Quick Start (Docker)

```bash
# 1. Clone and configure
cp env.example .env
# Edit .env with your actual keys

# 2. Generate JWT secrets
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# 3. Start everything
docker compose up --build -d

# 4. Verify
curl http://localhost:3001/health

# 5. Open
open http://localhost:3000
```

## Local Development

```bash
# Prerequisites: Node 20+, PostgreSQL 16, Redis 7
createdb emailtool
psql emailtool < backend/migrations/001_initial_schema.sql
cp env.example .env   # Edit with your values

cd backend && npm install && npm run dev     # :3001
cd frontend && npm install && npm run dev    # :3000
```

## API Endpoints (40+ routes)

**Auth**: POST /register, /login · GET /me · PUT /workspace
**Contacts**: GET / · GET /:id · POST / · PUT /:id · DELETE /:id · POST /import · POST /bulk-tag · POST /bulk-delete
**Campaigns**: GET / · GET /:id · POST / · PUT /:id · DELETE /:id · POST /:id/recipients · POST /:id/send · GET /:id/stats
**Sequences**: GET / · GET /:id · POST / · PUT /:id · DELETE /:id · POST /:id/steps · PUT /:id/steps/:sid · DELETE /:id/steps/:sid · POST /:id/enroll · POST /:id/enrollments/:eid/cancel · GET /:id/enrollments
**Templates**: GET / · GET /:id · POST / · PUT /:id · DELETE /:id · POST /:id/spam-check · POST /spam-check · GET /:id/versions
**Analytics**: GET /overview · GET /timeline · GET /tone-breakdown · GET /replies
**Webhooks**: POST /inbound · POST /events
**Tracking**: GET /track/open · GET /track/click · GET /unsubscribe

## Queue System

| Queue | Purpose | Concurrency | Retry |
|-------|---------|-------------|-------|
| email-send | SES dispatch | 5 | 3x exponential |
| sequence-processor | Step execution | 10 | 3x exponential |
| campaign-sender | Batch distribution | 2 | 2x exponential |
| reply-processor | Tone + branching | 5 | 3x exponential |

## AI Tone Detection

| Category | Trigger Action |
|----------|---------------|
| interested | Route to positive branch |
| objection | Route to objection branch |
| not_interested | Stop sequence |
| neutral | Continue default |
| unsubscribe | Auto-suppress |
| out_of_office | Skip (pre-API detection) |

## Security

JWT auth (bcrypt 12) · Role-based access · Input validation · Parameterized SQL · Rate limiting (500/15m API, 20/15m auth) · Helmet headers · CORS whitelist · Signed unsubscribe tokens · HMAC-signed tracking redirects · No secrets in logs

## Rollback Strategy

1. Database: transactions per migration, restore from pg_dump
2. Application: tagged Docker images, `docker compose up` with previous tag
3. Queues: drain with BullMQ API
4. Data: soft deletes, append-only suppression list
