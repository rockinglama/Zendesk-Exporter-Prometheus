# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0-beta.1] — 2026-03-26

First beta release.

### Added
- Prometheus exporter with 40 metrics covering ticket counts, response times, quality, distribution, and backlog
- Dual authentication: OAuth Bearer token and API token (Basic Auth)
- Windowed metrics for 1d, 7d, and 30d time windows
- Individual status gauges (`zendesk_tickets_total_{status}`)
- Sample size transparency metric (`zendesk_sample_size{window}`)
- Mock mode for local testing without Zendesk credentials
- Pre-built Grafana dashboard with 27 panels (best practice layout)
- Ticket burn rate chart (solved - created)
- Docker Compose stack (exporter + Prometheus + Grafana)
- Kubernetes manifests (Deployment, Service, Secret, ServiceMonitor)
- Comprehensive Jest test suite (75 tests)
- AGENTS.md for AI agent context

### Architecture
- Exporter exports raw data only — all rates/percentages calculated in Grafana
- Search API with pagination (up to 1000 tickets) instead of `/ticket_metrics.json` (which returns oldest first)
- One fetch for 30d, client-side filtering for 1d/7d/30d windows
- ~220 API calls per scrape cycle at 300s interval
- Agent role sufficient (no admin required)

### Security
- No PII in metrics (GDPR compliant)
- Read-only API access (GET only)
- Non-root container (UID 1001)
- Credentials via environment variables / Kubernetes Secrets
- npm audit clean

### Removed (deliberate)
- SLA metrics (Zendesk REST API v2 doesn't expose achievement rates)
- Satisfaction ratings, tickets per assignee, automations/triggers/macros (by request)
- Suspended tickets (requires admin role)
- `unsolved_tickets_total` (calculated in Grafana from status gauges)
