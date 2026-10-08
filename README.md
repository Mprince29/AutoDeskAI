# AutoDeskAI

AutoDeskAI is a FastAPI + Next.js multi-agent workflow platform with OAuth integrations, MCP tools, RAG, approvals, Redis-backed idempotency and Celery jobs.

## Architecture

- `backend/src`: API, authentication, workflows, agents, tools and RAG.
- `frontend/src`: Next.js App Router frontend.
- PostgreSQL: production database and forward-only schema migrations.
- Redis: cache, rate limiting, Celery broker/result backend and mutation idempotency.
- Celery: durable worker for long-running agent tasks.
- ChromaDB: RAG vector storage.

Production actions require verified authentication and approval/security checks. Email query parameters and headers are not trusted as identity.

## Local development

Prerequisites: Python 3.11+, Node.js 20+, PostgreSQL, Redis and Git.

```bash
cd backend
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET_KEY, ENCRYPTION_SECRET_KEY,
# AGENT_SECURITY_SECRET and the provider credentials you use.
pytest -q tests
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Frontend: <http://localhost:3000>
API docs: <http://localhost:8000/docs>
Health: <http://localhost:8000/health>
Database health: <http://localhost:8000/health/db>
Metrics: <http://localhost:8000/metrics>

## Docker Compose

Compose starts PostgreSQL, Redis, backend, Celery worker and frontend. Required values must be supplied; production startup fails closed when they are missing.

```bash
export POSTGRES_PASSWORD='change-this'
export DATABASE_URL='postgresql+psycopg2://autodeskai:change-this@postgres:5432/autodeskai'
export JWT_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
export AGENT_SECURITY_SECRET="$(python -c 'import secrets; print(secrets.token_hex(32))')"
export ENCRYPTION_SECRET_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
docker compose up -d --build
docker compose ps
```

The optional `production` nginx profile requires its deployment nginx configuration and TLS material.

## Configuration

Copy `backend/.env.example` to `backend/.env`. Never commit `.env`, provider keys, OAuth secrets or database credentials.

Required production secrets:

- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `ENCRYPTION_SECRET_KEY` (valid Fernet key)
- `AGENT_SECURITY_SECRET`
- PostgreSQL `POSTGRES_PASSWORD` when using Compose

Provider credentials are optional until their connector is enabled.

## Database and recovery

Schema changes are forward-only and tracked by `schema_version` in `backend/src/auth/database.py`. There is intentionally no destructive automatic down-migration. Use backup/restore plus a forward fix when rolling back application code.

```bash
pg_dump -Fc "$DATABASE_URL" > backup.dump
createdb restore_verify
pg_restore -d restore_verify backup.dump
psql "$DATABASE_URL" -Atc 'select version from schema_version;'
```

Keep the backup, schema version and deployed image tag together in the release record. See `OPERATIONS.md` when present for the recovery checklist.

## Testing and builds

```bash
cd backend && ./venv/bin/pytest -q tests
cd frontend && npm test -- --run
cd frontend && npx next build --webpack
git diff --check
```

The suite covers authentication, security signatures, selected connector mocks, retry behavior and background research. It does not by itself prove every external connector, worker crash/recovery path, tenant-isolation scenario or production rollback.

## Security and operations

- External documents and web content are untrusted input.
- Sensitive mutations require payload-bound authorization and approval.
- Redis is required for mutation idempotency; mutation execution fails closed if the safety store is unavailable.
- API latency and HTTP status metrics are exposed at `/metrics`; LLM usage and cost are recorded in database usage logs.
- Run dependency and image security scans in CI where scanner and registry credentials are available.

## Repository hygiene

Local databases, environments, build output, caches, `graphify-out/`, logs and OS metadata are ignored by `.gitignore` and are not deleted automatically.
