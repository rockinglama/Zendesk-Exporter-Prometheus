# Zendesk Prometheus Exporter

Prometheus exporter for Zendesk Support metrics. Exports raw ticket KPIs — all rate/percentage calculations happen in Grafana.

## Features

- **Dual Auth**: OAuth Bearer token or API token (Basic Auth)
- **Windowed Metrics**: Quality/count metrics for 1d, 7d, and 30d
- **GDPR Compliant**: No PII — only aggregated counts, averages, and categories
- **Transparent Sampling**: Sample sizes exported as metrics, time windows in HELP texts
- **Docker Stack**: Exporter + Prometheus + Grafana with pre-built dashboard
- **Mock Mode**: Full local testing without Zendesk credentials

## Metrics

### All-Time Ticket Counts (exact, Search Count API)

| Metric | Description |
|--------|-------------|
| `zendesk_tickets_total{status}` | Current tickets by status (labelled) |
| `zendesk_tickets_total_new` | Current new tickets |
| `zendesk_tickets_total_open` | Current open tickets |
| `zendesk_tickets_total_pending` | Current pending tickets |
| `zendesk_tickets_total_hold` | Current hold tickets |
| `zendesk_tickets_total_solved` | Current solved tickets |
| `zendesk_tickets_total_closed` | Current closed tickets |
| `zendesk_tickets_created_total` | Cumulative total ever created (use `delta()` in Grafana) |
| `zendesk_tickets_by_group{group}` | Tickets per support group |
| `zendesk_tickets_by_priority{priority}` | Tickets per priority level |
| `zendesk_unassigned_tickets_total` | Open tickets without assignee |
| `zendesk_suspended_tickets_total` | Suspended/spam queue |

### Windowed Counts (exact, Search Count API)

Available as `_last_1d`, `_last_7d`, `_last_30d`:

| Metric | Description |
|--------|-------------|
| `zendesk_tickets_created_last_*` | Tickets created in window |
| `zendesk_solved_tickets_last_*` | Tickets solved in window |
| `zendesk_reopened_tickets_last_*` | Tickets reopened in window (from ticket_metrics.reopens) |

### Windowed Quality (sampled from solved tickets, max 200 metrics fetched)

Available as `_last_1d`, `_last_7d`, `_last_30d`:

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

### Transparency & Metadata

| Metric | Description |
|--------|-------------|
| `zendesk_sample_size{window}` | Tickets sampled per window for quality metrics |
| `zendesk_exporter_info{version,mode}` | Exporter version and mode |

### Grafana-Calculated Values

These are **not exported** — calculate in Grafana:

| Value | PromQL |
|-------|--------|
| Unsolved | `zendesk_tickets_total_new + zendesk_tickets_total_open + zendesk_tickets_total_pending + zendesk_tickets_total_hold` |
| Reopen Rate | `zendesk_reopened_tickets_last_30d / zendesk_solved_tickets_last_30d * 100` |
| One-Touch Rate | `zendesk_one_touch_tickets_last_30d / zendesk_sample_size{window="30d"} * 100` |
| Assignment Rate | `((unsolved) - zendesk_unassigned_tickets_total) / (unsolved) * 100` |
| Burn Rate | `zendesk_solved_tickets_last_1d - zendesk_tickets_created_last_1d` |
| Ticket Rate/h | `rate(zendesk_tickets_total{status="open"}[1h])` |

## Data Sources & Limitations

| Data | Source | Accuracy |
|------|--------|----------|
| Ticket counts, priority, backlog, groups | Search Count API | **Exact** |
| Created/solved per window | Search Count API | **Exact** |
| Reopened per window | ticket_metrics.reopens field | **Sampled** (max 200) |
| Response times, quality | `/tickets/{id}/metrics` | **Sampled** (max 200 metrics) |
| Channels, tags | Search API (last 30d) | **Sampled** (max 1000 tickets) |
| SLA achievement/breach | **Not implemented** — use Zendesk Explore |

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

**Security**: Create a dedicated Light Agent for monitoring. The exporter only makes GET requests but API tokens inherit user permissions.

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
```

### Kubernetes

```bash
# 1. Create secret (API token)
kubectl create secret generic zendesk-exporter \
  --from-literal=subdomain=yourcompany \
  --from-literal=email=agent@company.com \
  --from-literal=api-token=YOUR_TOKEN

# Or OAuth
kubectl create secret generic zendesk-exporter \
  --from-literal=subdomain=yourcompany \
  --from-literal=oauth-token=YOUR_OAUTH_TOKEN

# 2. Deploy
kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml

# 3. (Optional) ServiceMonitor for Prometheus Operator
kubectl apply -f k8s/servicemonitor.yaml
```

Manifests in `k8s/`:
- `deployment.yaml` — Deployment with health probes, resource limits, security context
- `service.yaml` — ClusterIP Service on port 9091
- `secret.yaml` — Example Secret template (do not commit with real values)
- `servicemonitor.yaml` — ServiceMonitor for Prometheus Operator (optional)

Resources: 64Mi/50m request, 128Mi/200m limit. Runs as non-root (UID 1001), read-only filesystem.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZENDESK_SUBDOMAIN` | Yes* | — | Part before `.zendesk.com` |
| `ZENDESK_OAUTH_TOKEN` | No* | — | OAuth Bearer token |
| `ZENDESK_EMAIL` | No* | — | Agent email for API token auth |
| `ZENDESK_API_TOKEN` | No* | — | Personal API token |
| `ZENDESK_MOCK` | No | `false` | Use mock data |
| `PORT` | No | `9091` | HTTP server port |
| `SCRAPE_INTERVAL_SECONDS` | No | `300` | Collection interval |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |

\* Either `ZENDESK_OAUTH_TOKEN` or both `ZENDESK_EMAIL` + `ZENDESK_API_TOKEN` required (unless mock mode).

## API Call Budget

Per scrape cycle (~220 calls at 300ms throttle ≈ 70s):

| Calls | Purpose |
|-------|---------|
| ~15 | Exact counts (status, priority, backlog, windows) |
| ~10 | Paginated search for solved tickets (30d) |
| ≤200 | Individual `/tickets/{id}/metrics` |
| ~10 | Groups, channels/tags search, suspended, connection test |

## Zendesk API Endpoints (all GET, read-only)

- `/api/v2/search/count.json` — exact ticket counts
- `/api/v2/search.json` — ticket data for channel/tag/quality analysis
- `/api/v2/tickets/{id}/metrics.json` — per-ticket response time metrics
- `/api/v2/groups.json` — support groups
- `/api/v2/suspended_tickets.json` — suspended queue
- `/api/v2/users/me.json` — connection test

## Grafana Dashboard

Pre-provisioned sections:

- **📊 Overview** — status pie, total created, unsolved, unassigned, suspended, assignment rate
- **📈 Tickets rate by hour** — `rate()` per status over time
- **📈 Ticket Rates** — created/solved/reopened for 1d, 7d, 30d (color: created=red, solved=green)
- **🔥 Burn Rate** — solved minus created per window
- **🎯 Quality** — channel + priority distribution
- **📊 Distribution** — top 10 tags
- **⚖️ Backlog** — age distribution pie + trend

## Project Structure

```
├── src/
│   ├── index.js          # Express server, /metrics and /health
│   ├── zendesk-client.js # Zendesk API client (read-only)
│   ├── mock-client.js    # Mock data for testing
│   ├── collector.js      # Metric collection orchestrator
│   ├── metrics.js        # Prometheus metric definitions
│   └── logger.js         # Winston logger
├── k8s/
│   ├── deployment.yaml   # Kubernetes Deployment
│   ├── service.yaml      # ClusterIP Service
│   ├── secret.yaml       # Example Secret (don't commit real values)
│   └── servicemonitor.yaml # Prometheus Operator ServiceMonitor
├── grafana/
│   ├── dashboards/       # Pre-built dashboard JSON
│   └── provisioning/     # Datasource + dashboard provisioning
├── prometheus/
│   └── prometheus.yml    # Scrape config (300s interval)
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── .gitignore
```

## License

MIT
