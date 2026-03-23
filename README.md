# Zendesk Prometheus Exporter

A Prometheus exporter for Zendesk Support metrics, providing comprehensive monitoring of your customer support KPIs.

## Features

- **Dual Authentication Support**: OAuth Bearer tokens or API token authentication
- **Comprehensive Metrics**: 29+ metrics covering efficiency, capacity, channels, SLA, and operations
- **GDPR Compliant**: No PII in metrics - only aggregated counts and numeric IDs
- **Production Ready**: Built-in rate limiting, error handling, and graceful degradation
- **Docker Support**: Full containerization with Prometheus and Grafana
- **Mock Mode**: Test without real Zendesk API access

## Metrics Exposed

### Core Ticket Metrics

| Metric Name | Type | Description | Labels |
|------------|------|-------------|---------|
| `zendesk_tickets_total` | Gauge | Current ticket counts by status | `status` |
| `zendesk_unsolved_tickets_total` | Gauge | Total number of unsolved tickets | - |
| `zendesk_tickets_created` | Gauge | Number of tickets created in time period | `period` |
| `zendesk_tickets_by_group` | Gauge | Number of tickets by group | `group` |

### Efficiency & Quality Metrics

| Metric Name | Type | Description | Labels |
|------------|------|-------------|---------|
| `zendesk_reopened_tickets_total` | Gauge | Tickets reopened in the last 30 days | - |
| `zendesk_reopened_tickets_rate` | Gauge | Percentage of solved tickets that were reopened (0-100) | - |
| `zendesk_one_touch_resolution_rate` | Gauge | Percentage of tickets solved with single reply (0-100) | - |
| `zendesk_replies_per_ticket_avg` | Gauge | Average replies until resolution (last 30d) | - |
| `zendesk_requester_wait_time_seconds` | Gauge | Average total requester wait time in seconds | - |

### Capacity & Workload Metrics

| Metric Name | Type | Description | Labels |
|------------|------|-------------|---------|
| `zendesk_backlog_age_tickets` | Gauge | Open ticket age distribution | `bucket` |
| `zendesk_tickets_per_assignee` | Gauge | Tickets per agent (ID only, GDPR compliant) | `assignee_id` |
| `zendesk_unassigned_tickets_total` | Gauge | Tickets with no assignee | - |
| `zendesk_assignment_rate` | Gauge | Percentage of open tickets that are assigned (0-100) | - |

### Channels & Trends Metrics

| Metric Name | Type | Description | Labels |
|------------|------|-------------|---------|
| `zendesk_tickets_by_channel` | Gauge | Ticket distribution by channel | `channel` |
| `zendesk_tickets_by_priority` | Gauge | Ticket distribution by priority | `priority` |
| `zendesk_tickets_by_tag` | Gauge | Top 10 ticket tags by count | `tag` |
| `zendesk_satisfaction_score_rate` | Gauge | Aggregated CSAT good/(good+bad) ratio (0-100) | - |
| `zendesk_satisfaction_good_total` | Gauge | Total good satisfaction ratings | - |
| `zendesk_satisfaction_bad_total` | Gauge | Total bad satisfaction ratings | - |

### SLA & Performance Metrics

| Metric Name | Type | Description | Labels |
|------------|------|-------------|---------|
| `zendesk_sla_achievement_rate` | Gauge | SLA achievement rate percentage by channel | `channel` |
| `zendesk_first_reply_time_seconds` | Gauge | Average first reply time in seconds | - |
| `zendesk_full_resolution_time_seconds` | Gauge | Average full resolution time in seconds | - |
| `zendesk_sla_breach_count` | Gauge | Current SLA breaches by metric type | `metric` |
| `zendesk_sla_breach_rate_by_priority` | Gauge | SLA breach rate by priority (0-100) | `priority` |

### Operational Metrics

| Metric Name | Type | Description | Labels |
|------------|------|-------------|---------|
| `zendesk_suspended_tickets_total` | Gauge | Tickets in suspended/spam queue | - |
| `zendesk_automations_count` | Gauge | Number of active automations | - |
| `zendesk_triggers_count` | Gauge | Number of active triggers | - |
| `zendesk_macros_count` | Gauge | Number of active macros | - |

### System Metrics

| Metric Name | Type | Description | Labels |
|------------|------|-------------|---------|
| `zendesk_exporter_info` | Gauge | Information about the exporter | `version`, `mode` |

### Privacy & GDPR Compliance

**🔒 This exporter is GDPR compliant:**

- **No Personal Data**: Never caches or exposes names, emails, or ticket content
- **Agent Privacy**: Metrics use only numeric IDs (`assignee_id`), never agent names
- **Aggregated CSAT**: Satisfaction metrics are aggregated ratios only, never per-ticket
- **Counts Only**: All metrics are aggregated counts and averages, no individual records

## Authentication

The exporter supports two authentication methods:

### 1. OAuth Bearer Token (Recommended)

For OAuth applications or integrations:

```bash
export ZENDESK_SUBDOMAIN=your-company
export ZENDESK_OAUTH_TOKEN=your-oauth-access-token
```

### 2. API Token (Personal Use)

For personal API tokens:

```bash
export ZENDESK_SUBDOMAIN=your-company
export ZENDESK_EMAIL=your-email@company.com
export ZENDESK_API_TOKEN=your-api-token
```

**Note**: If both are provided, OAuth token takes precedence. You must provide at least one authentication method.

## Quick Start

### Local Development

1. **Clone and install dependencies:**
   ```bash
   git clone <repository>
   cd zendesk-prometheus-exporter
   npm install
   ```

2. **Configure authentication:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Run the exporter:**
   ```bash
   npm start
   ```

4. **Test the endpoints:**
   ```bash
   curl http://localhost:3000/health
   curl http://localhost:3000/metrics
   ```

### Docker Deployment

The repository includes a complete monitoring stack with Prometheus and Grafana:

1. **Start the stack:**
   ```bash
   docker compose up -d
   ```

2. **Access the services:**
   - Exporter: http://localhost:3000
   - Prometheus: http://localhost:9090
   - Grafana: http://localhost:3001 (admin/admin123)

### Mock Mode

Test the exporter without real Zendesk API access:

```bash
ZENDESK_MOCK=true npm start
```

## Configuration

| Environment Variable | Required | Description | Default |
|---------------------|----------|-------------|---------|
| `ZENDESK_SUBDOMAIN` | Yes | Your Zendesk subdomain | - |
| `ZENDESK_OAUTH_TOKEN` | No* | OAuth access token | - |
| `ZENDESK_EMAIL` | No* | Email for API token auth | - |
| `ZENDESK_API_TOKEN` | No* | API token for auth | - |
| `PORT` | No | HTTP server port | `3000` |
| `SCRAPE_INTERVAL_SECONDS` | No | Metrics collection interval | `60` |
| `LOG_LEVEL` | No | Logging level | `info` |
| `ZENDESK_MOCK` | No | Use mock data instead of API | `false` |

*Either `ZENDESK_OAUTH_TOKEN` OR (`ZENDESK_EMAIL` + `ZENDESK_API_TOKEN`) must be provided.

## API Endpoints

### Health Check

```bash
GET /health
```

Returns the health status and connection information:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456,
  "isCollecting": false,
  "lastCollectionTime": "2024-01-01T00:00:00.000Z",
  "collectionErrors": 0,
  "mode": "live"
}
```

### Prometheus Metrics

```bash
GET /metrics
```

Returns metrics in Prometheus exposition format.

### Application Info

```bash
GET /
```

Returns basic application information and configuration.

## Zendesk API Integration

The exporter uses the following Zendesk REST API v2 endpoints:

- `/api/v2/search/count.json` - Ticket counts and filtering
- `/api/v2/search.json` - Ticket data for aggregations (limited samples)
- `/api/v2/ticket_metrics.json` - Response time and efficiency metrics
- `/api/v2/satisfaction_ratings.json` - Customer satisfaction data (aggregated only)
- `/api/v2/groups.json` - Support group information
- `/api/v2/automations.json` - Active automation counts
- `/api/v2/triggers.json` - Active trigger counts  
- `/api/v2/macros.json` - Active macro counts
- `/api/v2/suspended_tickets/count.json` - Suspended ticket queue size
- `/api/v2/slas/policies.json` - SLA policy information

**Rate Limiting**: The exporter implements intelligent rate limiting with:
- 200 requests per minute maximum (300ms between requests)
- Automatic retry with exponential backoff for 429 responses
- Respect for `Retry-After` headers
- Promise.allSettled for resilient parallel data collection
- Graceful degradation on API failures

## Grafana Dashboard

The included Grafana dashboard provides:

- **📊 Overview**: SLA achievement rates and ticket status distribution
- **⏱️ Performance**: Response times and key performance indicators
- **🎯 Efficiency & Quality**: Reopened rates, one-touch resolution, customer wait times
- **⚖️ Capacity & Workload**: Backlog age distribution, assignee workload, assignment rates
- **📊 Channels & Trends**: Distribution by channel, priority, tags, and CSAT scores
- **🎯 SLA Detail**: Breach counts and rates by priority level
- **⚙️ Operational**: Suspended tickets, automation counts, system health
- **📈 Trends & Volume**: Historical ticket creation and group performance

Import the dashboard from `grafana/dashboards/zendesk-kpis.json` or use the automatic provisioning in Docker.

## Monitoring and Alerting

Example Prometheus alerting rules:

```yaml
groups:
  - name: zendesk
    rules:
      - alert: HighUnsolvedTickets
        expr: zendesk_unsolved_tickets_total > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High number of unsolved tickets"
          
      - alert: SLABreach
        expr: zendesk_sla_achievement_rate < 80
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "SLA achievement below threshold"
```

## Development

### Project Structure

```
├── src/
│   ├── index.js          # Main application entry
│   ├── zendesk-client.js # Zendesk API client
│   ├── collector.js      # Metrics collection logic
│   ├── metrics.js        # Prometheus metrics definitions
│   ├── mock-client.js    # Mock data for testing
│   └── logger.js         # Logging configuration
├── docker-compose.yml    # Docker stack definition
├── prometheus/           # Prometheus configuration
├── grafana/             # Grafana dashboards and config
└── tests/               # Test files
```

### Running Tests

```bash
npm test
```

### Environment Variables for Development

```bash
# Test with mock data
ZENDESK_MOCK=true npm start

# Test with real API but faster collection
SCRAPE_INTERVAL_SECONDS=30 npm start

# Enable debug logging
LOG_LEVEL=debug npm start
```

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify your credentials are correct
   - Ensure your API token has sufficient permissions
   - Check if OAuth token has necessary scopes

2. **Connection Timeouts**
   - Verify network connectivity to `https://yoursubdomain.zendesk.com`
   - Check firewall rules if running in restricted environment

3. **Rate Limiting**
   - The exporter handles rate limits automatically
   - Consider increasing `SCRAPE_INTERVAL_SECONDS` for high-volume instances

4. **Missing Metrics**
   - Some metrics require specific Zendesk plan features
   - SLA metrics require SLA policies to be configured

### Debugging

Enable debug logging to see detailed API interactions:

```bash
LOG_LEVEL=debug npm start
```

Check health endpoint for connection status:

```bash
curl http://localhost:3000/health | jq
```

## Production Deployment

### Security Considerations

- Use OAuth tokens instead of API tokens when possible
- Store credentials in secure secret management systems
- Run with non-root user in containers
- Enable HTTPS for production deployments

### Scaling

- The exporter is stateless and can be horizontally scaled
- Consider running multiple instances behind a load balancer
- Use external Prometheus for high-availability setups

### Monitoring the Exporter

Monitor the exporter itself using the built-in metrics:

- `zendesk_exporter_*` metrics for application performance
- `/health` endpoint for automated health checks
- Application logs for troubleshooting

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see LICENSE file for details.