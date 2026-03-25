# Zendesk Prometheus Exporter

Prometheus exporter for Zendesk Support metrics. Exports raw ticket KPIs — all rate/percentage calculations happen in Grafana.

## Features

- **Dual Auth**: OAuth Bearer token or API token (Basic Auth)
- **Windowed Metrics**: Every quality/count metric available for 1d, 7d, and 30d
- **GDPR Compliant**: No PII — only aggregated counts, averages, and categories
- **Transparent Sampling**: Sample sizes exported as metrics, time windows in HELP texts
- **Docker Stack**: Exporter + Prometheus + Grafana with pre-built dashboard
- **Mock Mode**: Full local testing without Zendesk credentials

## Metrics

### All-Time Counts (exact, Search Count API)

| Metric | Description |
|--------|-------------|
| `zendesk_tickets_total{status}` | Current tickets by status |
| `zendesk_unsolved_tickets_total` | All unsolved tickets |
| `zendesk_tickets_created_total` | Cumulative total (use `delta()` in Grafana) |
| `zendesk_tickets_by_group{group}` | Tickets per support group |
| `zendesk_tickets_by_priority{priority}` | Tickets per priority level |
| `zendesk_unassigned_tickets_total` | Open tickets without assignee |

### Windowed Counts (exact, Search Count API)

Available for `_last_1d`, `_last_7d`, `_last_30d`:

| Metric | Description |
|--------|-------------|
| `zendesk_tickets_created_last_*` | Tickets created in window |
| `zendesk_solved_tickets_last_*` | Tickets solved in window |
| `zendesk_reopened_tickets_last_*` | Tickets reopened in window |

### Windowed Quality (sampled from solved tickets, max 200 metrics)

Available for `_last_1d`, `_last_7d`, `_last_30d`:

| Metric | Description |
|--------|-------------|
| `zendesk_first_reply_time_seconds_last_*` | Avg first reply time (business hours) |
| `zendesk_full_resolution_time_seconds_last_*` | Avg resolution time (business hours) |
| `zendesk_requester_wait_time_seconds_last_*` | Avg customer wait time |
| `zendesk_one_touch_tickets_last_*` | Tickets solved with ≤1 reply |
| `zendesk_replies_per_ticket_avg_last_*` | Avg replies per ticket |

### Distribution (sampled, last 30d, max 1000 tickets)

| Metric | Description |
|--------|-------------|
| `zendesk_tickets_by_channel{channel}` | By communication channel (from `via.channel`) |
| `zendesk_tickets_by_tag{tag}` | Top 10 tags |

### Backlog (exact)

| Metric | Description |
|--------|-------------|
| `zendesk_backlog_age_tickets{bucket}` | Open tickets by age (`lt_1d`, `1d_3d`, `3d_7d`, `7d_30d`, `gt_30d`) |

### Operational

| Metric | Description |
|--------|-------------|
| `zendesk_suspended_tickets_total` | Suspended/spam queue |
| `zendesk_automations_count` | Active automations |
| `zendesk_triggers_count` | Active triggers |
| `zendesk_macros_count` | Active macros |

### Transparency

| Metric | Description |
|--------|-------------|
| `zendesk_sample_size{window}` | Tickets sampled per window for quality metrics |
| `zendesk_exporter_info{version,mode}` | Exporter metadata |

### Grafana-Calculated Rates

These are **not exported** — calculate them in Grafana:

| Rate | PromQL |
|------|--------|
| Reopen Rate | `zendesk_reopened_tickets_last_30d / zendesk_solved_tickets_last_30d * 100` |
| One-Touch Rate | `zendesk_one_touch_tickets_last_30d / zendesk_sample_size{window="30d"} * 100` |
| Assignment Rate | `(zendesk_unsolved_tickets_total - zendesk_unassigned_tickets_total) / zendesk_unsolved_tickets_total * 100` |

## Data Sources & Limitations

| Data | Source | Accuracy |
|------|--------|----------|
| Ticket counts, priority, backlog | Search Count API | **Exact** |
| Created/solved/reopened per window | Search Count API | **Exact** |
| Response times, quality | Search API → `/tickets/{id}/metrics` | **Sampled** (max 200 metrics fetched) |
| Channels, tags | Search API (last 30d) | **Sampled** (max 1000 tickets) |
| SLA achievement/breach | **Not implemented** — Zendesk REST API v2 doesn't expose SLA achievement rates. Use Zendesk Explore for SLA reporting. |

## Authentication

### Option 1: OAuth Token (recommended)

```bash
ZENDESK_SUBDOMAIN=yourcompany
ZENDESK_OAUTH_TOKEN=your-oauth-token
```

### Option 2: API Token

```bash
ZENDESK_SUBDOMAIN=yourcompany
ZENDESK_EMAIL=agent@company.com
ZENDESK_API_TOKEN=your-api-token
```

If both are set, OAuth takes precedence.

**Security recommendation**: Create a dedicated Light Agent or read-only admin for monitoring. Zendesk API tokens inherit the user's permissions — the exporter only makes GET requests but the token itself isn't scoped.

## Quick Start

### Docker (recommended)

```bash
cp .env.example .env
# Edit .env with credentials (or leave ZENDESK_MOCK=true for testing)
docker compose up -d
```

Services:
- Exporter: http://localhost:9091/metrics
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin / admin123)

### Local

```bash
npm install
ZENDESK_MOCK=true npm start
# or with real credentials:
ZENDESK_SUBDOMAIN=x ZENDESK_EMAIL=x ZENDESK_API_TOKEN=x npm start
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZENDESK_SUBDOMAIN` | Yes* | — | Subdomain (the part before `.zendesk.com`) |
| `ZENDESK_OAUTH_TOKEN` | No* | — | OAuth Bearer token |
| `ZENDESK_EMAIL` | No* | — | Agent email for API token auth |
| `ZENDESK_API_TOKEN` | No* | — | Personal API token |
| `ZENDESK_MOCK` | No | `false` | Use mock data (no API calls) |
| `PORT` | No | `9091` | HTTP server port |
| `SCRAPE_INTERVAL_SECONDS` | No | `300` | Collection interval in seconds |
| `LOG_LEVEL` | No | `info` | Log level (`debug`, `info`, `warn`, `error`) |

\* Either `ZENDESK_OAUTH_TOKEN` or both `ZENDESK_EMAIL` + `ZENDESK_API_TOKEN` required (unless `ZENDESK_MOCK=true`).

## API Call Budget

Per scrape cycle (~220 calls, fits within Zendesk's 200 req/min with the 300ms throttle):

| Call | Count | Purpose |
|------|-------|---------|
| Search Count | ~20 | Exact ticket counts (status, priority, backlog, windows) |
| Search (paginated) | ~10 | Fetch solved tickets (30d) for quality metrics |
| `/tickets/{id}/metrics` | ≤200 | Individual ticket metrics for reply/resolution times |
| Groups/automations/etc. | ~10 | Distribution and operational data |

## Zendesk API Endpoints Used (all GET, read-only)

- `/api/v2/search/count.json` — exact ticket counts
- `/api/v2/search.json` — ticket data for channel/tag/quality analysis
- `/api/v2/tickets/{id}/metrics.json` — per-ticket response time metrics
- `/api/v2/groups.json` — support groups
- `/api/v2/suspended_tickets.json` — suspended queue
- `/api/v2/automations.json` — active automations
- `/api/v2/triggers.json` — active triggers
- `/api/v2/macros.json` — active macros
- `/api/v2/users/me.json` — connection test

No POST/PUT/PATCH/DELETE requests. The exporter is strictly read-only.

## Grafana Dashboard

Pre-provisioned dashboard with sections:

- **📊 Overview** — ticket status, unsolved, created, unassigned
- **📈 Ticket Rates** — created/solved/reopened bars for 1d, 7d, 30d
- **⏱️ Response Times** — first reply, resolution, wait time per window
- **🎯 Quality** — reopen rate, one-touch rate, replies/ticket, assignment rate (calculated in Grafana)
- **📊 Distribution** — by channel, priority, group, top tags
- **⚖️ Backlog** — age distribution pie + stacked trend
- **⚙️ Operational** — suspended, automations, triggers, macros
- **ℹ️ Data Transparency** — sample sizes per window + legend

## Project Structure

```
├── src/
│   ├── index.js          # Express server, /metrics and /health endpoints
│   ├── zendesk-client.js # Zendesk API client (read-only, rate-limited)
│   ├── mock-client.js    # Mock data for testing
│   ├── collector.js      # Metric collection orchestrator
│   ├── metrics.js        # Prometheus metric definitions
│   └── logger.js         # Winston logger
├── grafana/
│   ├── dashboards/       # Pre-built dashboard JSON
│   └── provisioning/     # Auto-provisioning config
├── prometheus/
│   └── prometheus.yml    # Scrape config
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## License

MIT
