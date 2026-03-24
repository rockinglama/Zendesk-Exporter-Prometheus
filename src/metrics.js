const client = require('prom-client');

/**
 * Prometheus metric registry and definitions for the Zendesk exporter.
 *
 * Design principles:
 * - Exporter only exports raw data — counts, totals, averages from the API
 * - All rate/percentage calculations happen in Grafana queries
 * - Gauges only (we poll a REST API, not an event stream)
 * - No PII in labels — only categories, IDs, and aggregates
 * - Bounded label cardinality
 *
 * @module metrics
 */

const register = new client.Registry();

client.collectDefaultMetrics({
  register,
  prefix: 'zendesk_exporter_',
});

// ---------------------------------------------------------------------------
// Ticket counts
// ---------------------------------------------------------------------------

const ticketsTotal = new client.Gauge({
  name: 'zendesk_tickets_total',
  help: 'Current ticket count by status',
  labelNames: ['status'],
  registers: [register],
});

const unsolvedTickets = new client.Gauge({
  name: 'zendesk_unsolved_tickets_total',
  help: 'Total unsolved tickets (new + open + pending + hold)',
  registers: [register],
});

const ticketsCreatedTotal = new client.Gauge({
  name: 'zendesk_tickets_created_total',
  help: 'Cumulative total of all tickets ever created (use delta() in Grafana for time windows)',
  registers: [register],
});

const solvedTicketsTotal = new client.Gauge({
  name: 'zendesk_solved_tickets_total',
  help: 'Tickets solved in the last 30 days (for rate calculations in Grafana)',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

const ticketsByGroup = new client.Gauge({
  name: 'zendesk_tickets_by_group',
  help: 'Ticket count by support group',
  labelNames: ['group'],
  registers: [register],
});

const ticketsByChannel = new client.Gauge({
  name: 'zendesk_tickets_by_channel',
  help: 'Ticket count by communication channel (from via.channel)',
  labelNames: ['channel'],
  registers: [register],
});

const ticketsByPriority = new client.Gauge({
  name: 'zendesk_tickets_by_priority',
  help: 'Ticket count by priority level',
  labelNames: ['priority'],
  registers: [register],
});

const ticketsByTag = new client.Gauge({
  name: 'zendesk_tickets_by_tag',
  help: 'Ticket count for top 10 tags',
  labelNames: ['tag'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Response times (averages from Zendesk ticket_metrics API)
// ---------------------------------------------------------------------------

const firstReplyTime = new client.Gauge({
  name: 'zendesk_first_reply_time_seconds',
  help: 'Average first reply time in seconds (business hours)',
  registers: [register],
});

const fullResolutionTime = new client.Gauge({
  name: 'zendesk_full_resolution_time_seconds',
  help: 'Average full resolution time in seconds (business hours)',
  registers: [register],
});

const requesterWaitTimeSeconds = new client.Gauge({
  name: 'zendesk_requester_wait_time_seconds',
  help: 'Average total requester wait time in seconds',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Quality indicators (raw counts — Grafana calculates rates)
// ---------------------------------------------------------------------------

const reopenedTicketsTotal = new client.Gauge({
  name: 'zendesk_reopened_tickets_total',
  help: 'Tickets reopened in the last 30 days (Grafana: reopened / solved * 100 = reopen rate)',
  registers: [register],
});

const oneTouchTicketsTotal = new client.Gauge({
  name: 'zendesk_one_touch_tickets_total',
  help: 'Tickets solved with <= 1 agent reply (Grafana: one_touch / solved * 100 = one-touch rate)',
  registers: [register],
});

const repliesPerTicketAvg = new client.Gauge({
  name: 'zendesk_replies_per_ticket_avg',
  help: 'Average number of agent replies per ticket (from ticket_metrics API)',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Backlog
// ---------------------------------------------------------------------------

const backlogAgeTickets = new client.Gauge({
  name: 'zendesk_backlog_age_tickets',
  help: 'Open ticket count by age bucket',
  labelNames: ['bucket'],
  registers: [register],
});

const unassignedTicketsTotal = new client.Gauge({
  name: 'zendesk_unassigned_tickets_total',
  help: 'Open tickets with no assignee (Grafana: (unsolved - unassigned) / unsolved * 100 = assignment rate)',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Operational
// ---------------------------------------------------------------------------

const suspendedTicketsTotal = new client.Gauge({
  name: 'zendesk_suspended_tickets_total',
  help: 'Tickets in suspended/spam queue',
  registers: [register],
});

const automationsCount = new client.Gauge({
  name: 'zendesk_automations_count',
  help: 'Number of active automations',
  registers: [register],
});

const triggersCount = new client.Gauge({
  name: 'zendesk_triggers_count',
  help: 'Number of active triggers',
  registers: [register],
});

const macrosCount = new client.Gauge({
  name: 'zendesk_macros_count',
  help: 'Number of active macros',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Transparency
// ---------------------------------------------------------------------------

/** Sample size for sampled metrics (Search API max: 1000, metric fetch max: 200) */
const sampleSize = new client.Gauge({
  name: 'zendesk_sample_size',
  help: 'Number of tickets sampled for calculations (metric_group: reply_times, quality, channels)',
  labelNames: ['metric_group'],
  registers: [register],
});

// Exporter metadata
// ---------------------------------------------------------------------------

const exporterInfo = new client.Gauge({
  name: 'zendesk_exporter_info',
  help: 'Exporter version and mode',
  labelNames: ['version', 'mode'],
  registers: [register],
});

module.exports = {
  register,

  // Counts
  ticketsTotal,
  unsolvedTickets,
  ticketsCreatedTotal,
  solvedTicketsTotal,

  // Distribution
  ticketsByGroup,
  ticketsByChannel,
  ticketsByPriority,
  ticketsByTag,

  // Response times
  firstReplyTime,
  fullResolutionTime,
  requesterWaitTimeSeconds,

  // Quality (raw counts)
  reopenedTicketsTotal,
  oneTouchTicketsTotal,
  repliesPerTicketAvg,

  // Backlog
  backlogAgeTickets,
  unassignedTicketsTotal,

  // Operational
  suspendedTicketsTotal,
  automationsCount,
  triggersCount,
  macrosCount,

  // Transparency
  sampleSize,

  // Meta
  exporterInfo,
};
