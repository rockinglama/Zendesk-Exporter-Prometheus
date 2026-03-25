# AGENTS.md — Zendesk Prometheus Exporter

Context file for AI agents working on this project.

## Project Overview

Node.js Prometheus exporter that scrapes Zendesk Support ticket KPIs via REST API v2 and exposes them as Prometheus metrics. Grafana dashboard included.

- **Repo**: https://github.com/rockinglama/Zendesk-Exporter-Prometheus
- **Stack**: Node.js 24 (Alpine), Express, prom-client, axios, winston
- **Tests**: Jest (75 tests), run with `npm test`
- **Docker**: `docker compose up -d` (exporter + prometheus + grafana)
- **K8s**: Manifests in `k8s/`

## Architecture Decisions

### Exporter = raw data only
All rate/percentage calculations happen in Grafana, not in the exporter. The exporter exports counts, totals, and averages — never computed ratios.

### Why not `/ticket_metrics.json`?
This endpoint returns metrics sorted by **oldest ticket ID first** with no sort option. With 70k+ tickets, you only get the oldest 100 — useless. Instead we use:
1. Search API (paginated, up to 1000 tickets, sorted by `created_at desc`)
2. Individual `/tickets/{id}/metrics.json` calls (capped at 200 per scrape)

### One fetch, three windows
Quality metrics (reply time, resolution time, one-touch, etc.) are fetched once for the 30d window, then **filtered client-side** for 1d and 7d. This avoids tripling the API calls.

### No SLA metrics
Zendesk REST API v2 does not expose SLA achievement rates. The only way is the Incremental Ticket Metric Events API (`/incremental/ticket_metric_events`) which requires admin + state management, or Zendesk Explore. Intentionally left out.

### Removed metrics (deliberate)
- `zendesk_satisfaction_*` — removed on request
- `zendesk_tickets_per_assignee` — removed on request
- `zendesk_automations/triggers/macros_count` — removed on request
- `zendesk_suspended_tickets_total` — requires admin role, removed so Agent role suffices
- `zendesk_unsolved_tickets_total` — calculated in Grafana from status gauges
- `zendesk_sla_*` — were hardcoded fakes, removed

## Zendesk API Usage

### Validated search keywords (against official docs)
```
type:ticket          — filter by resource type
status:open          — predefined: new, open, pending, hold, solved, closed
status<solved        — less-than operator on ordered status
created>YYYY-MM-DD   — date filter (absolute, YYYY-MM-DD format)
solved>YYYY-MM-DD    — date ticket was solved
priority:low         — predefined: low, normal, high, urgent
group:ID             — group by numeric ID (NOT group_id:)
assignee:none        — empty property search
```

### Invalid keywords (do NOT use)
- `reopens>0` — not a search keyword, use `ticket_metrics.reopens` field instead
- `group_id:` — correct keyword is `group:`
- `via:email` — `via:` exists but values are `mail` not `email`; we read `via.channel` from ticket data instead

### Endpoints used (all GET, read-only)
- `/api/v2/search/count.json` — exact counts
- `/api/v2/search.json` — paginated ticket data
- `/api/v2/tickets/{id}/metrics.json` — per-ticket metrics
- `/api/v2/groups.json` — support groups
- `/api/v2/users/me.json` — connection test

### Rate limiting
- 300ms between requests (~200 req/min)
- Auto-retry on 429 with `Retry-After` header
- ~220 API calls per scrape cycle, fits in 300s interval

## Metrics (40 exported)

### All-time (exact)
- `zendesk_tickets_total{status}` + `zendesk_tickets_total_{status}` (6 individual gauges)
- `zendesk_tickets_created_total`
- `zendesk_tickets_by_group{group}`
- `zendesk_tickets_by_priority{priority}`
- `zendesk_unassigned_tickets_total`

### Windowed (1d/7d/30d)
Counts (exact): `zendesk_tickets_created_last_*`, `zendesk_solved_tickets_last_*`, `zendesk_reopened_tickets_last_*`

Quality (sampled, max 200): `zendesk_first_reply_time_seconds_last_*`, `zendesk_full_resolution_time_seconds_last_*`, `zendesk_requester_wait_time_seconds_last_*`, `zendesk_one_touch_tickets_last_*`, `zendesk_replies_per_ticket_avg_last_*`

### Distribution (sampled, 30d, max 1000)
- `zendesk_tickets_by_channel{channel}`
- `zendesk_tickets_by_tag{tag}`

### Backlog (exact)
- `zendesk_backlog_age_tickets{bucket}` (lt_1d, 1d_3d, 3d_7d, 7d_30d, gt_30d)

### Transparency
- `zendesk_sample_size{window}` — how many tickets were sampled per window
- `zendesk_exporter_info{version,mode}`

## Grafana Dashboard

Dashboard JSON: `grafana/dashboards/zendesk-kpis.json`
Uses template variable `${DS_PROMETHEUS}` for portable datasource.

Key Grafana-calculated values:
- Unsolved: `zendesk_tickets_total_new + _open + _pending + _hold`
- Reopen Rate: `reopened / solved * 100`
- One-Touch Rate: `one_touch / sample_size * 100`
- Assignment Rate: `(unsolved - unassigned) / unsolved * 100`
- Burn Rate: `solved - created` (positive = backlog shrinking)

## File Structure
```
src/
  index.js          — Express server (/metrics, /health, /)
  zendesk-client.js — API client (read-only, rate-limited)
  mock-client.js    — Mock for testing (same interface)
  collector.js      — Orchestrates scraping + metric updates
  metrics.js        — Prometheus metric definitions
  logger.js         — Winston logger
tests/              — Jest tests (75 tests)
grafana/            — Dashboard JSON + provisioning
prometheus/         — Scrape config
k8s/                — Kubernetes manifests
```

## Git
- Push: `TOKEN=$(cat /Users/igor/github-token.txt | tr -d '[:space:]') && git push "https://${TOKEN}@github.com/rockinglama/Zendesk-Exporter-Prometheus.git" main`
- Email: `user@users.noreply.github.com`

## Environment
- Port: 9091 (default)
- Scrape interval: 300s
- Log level: info (default, suitable for prod)
- Auth: Agent role sufficient (no admin needed)
- GDPR: No PII in metrics — only counts, averages, categories
