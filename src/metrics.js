const client = require('prom-client');

/**
 * Prometheus metric registry and metric definitions for the Zendesk exporter.
 *
 * Design principles:
 * - All metrics are Gauges (we poll a REST API, not an event stream)
 * - Current-state metrics (tickets_total, unsolved) are point-in-time snapshots
 * - For time-based analysis, export totals and let Grafana handle windowing
 *   via delta()/increase() over the desired range
 * - No PII in labels — only IDs, categories, and aggregates
 * - Label cardinality is bounded (no unbounded user/ticket labels)
 *
 * @module metrics
 */

const register = new client.Registry();

// Add Node.js process metrics (CPU, memory, GC, event loop)
client.collectDefaultMetrics({
  register,
  prefix: 'zendesk_exporter_',
});

// ---------------------------------------------------------------------------
// Core ticket metrics
// ---------------------------------------------------------------------------

/** Current ticket count by status (point-in-time snapshot) */
const ticketsTotal = new client.Gauge({
  name: 'zendesk_tickets_total',
  help: 'Current ticket count by status',
  labelNames: ['status'],
  registers: [register],
});

/** Total unsolved tickets (new + open + pending + hold) */
const unsolvedTickets = new client.Gauge({
  name: 'zendesk_unsolved_tickets_total',
  help: 'Total number of unsolved tickets',
  registers: [register],
});

/**
 * Cumulative count of all tickets ever created.
 * Use delta(zendesk_tickets_created_total[24h]) in Grafana
 * to get tickets created in the last 24 hours, or any other window.
 */
const ticketsCreatedTotal = new client.Gauge({
  name: 'zendesk_tickets_created_total',
  help: 'Cumulative total of all tickets ever created (use delta() in Grafana for time windows)',
  registers: [register],
});

/** Current ticket count by support group */
const ticketsByGroup = new client.Gauge({
  name: 'zendesk_tickets_by_group',
  help: 'Ticket count by support group',
  labelNames: ['group'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// SLA metrics
// ---------------------------------------------------------------------------

/** SLA achievement rate by channel (estimated from ticket metrics) */
const slaAchievementRate = new client.Gauge({
  name: 'zendesk_sla_achievement_rate',
  help: 'SLA achievement rate percentage by channel (0-100)',
  labelNames: ['channel'],
  registers: [register],
});

/** Current SLA breach count by metric type */
const slaBreachCount = new client.Gauge({
  name: 'zendesk_sla_breach_count',
  help: 'Current number of SLA breaches by metric type',
  labelNames: ['metric'],
  registers: [register],
});

/** SLA breach rate by ticket priority */
const slaBreachRateByPriority = new client.Gauge({
  name: 'zendesk_sla_breach_rate_by_priority',
  help: 'SLA breach rate percentage by priority level (0-100)',
  labelNames: ['priority'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Response time metrics
// ---------------------------------------------------------------------------

/** Average first reply time (business hours, last 30 days) */
const firstReplyTime = new client.Gauge({
  name: 'zendesk_first_reply_time_seconds',
  help: 'Average first reply time in seconds (business hours, last 30 days)',
  registers: [register],
});

/** Average full resolution time (business hours, last 30 days) */
const fullResolutionTime = new client.Gauge({
  name: 'zendesk_full_resolution_time_seconds',
  help: 'Average full resolution time in seconds (business hours, last 30 days)',
  registers: [register],
});

/** Average total requester wait time */
const requesterWaitTimeSeconds = new client.Gauge({
  name: 'zendesk_requester_wait_time_seconds',
  help: 'Average total requester wait time in seconds',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Efficiency & quality metrics
// ---------------------------------------------------------------------------

/** Tickets reopened in last 30 days */
const reopenedTicketsTotal = new client.Gauge({
  name: 'zendesk_reopened_tickets_total',
  help: 'Number of tickets reopened in the last 30 days',
  registers: [register],
});

/** Reopen rate as percentage of solved tickets */
const reopenedTicketsRate = new client.Gauge({
  name: 'zendesk_reopened_tickets_rate',
  help: 'Percentage of solved tickets that were reopened (0-100)',
  registers: [register],
});

/** One-touch resolution rate */
const oneTouchResolutionRate = new client.Gauge({
  name: 'zendesk_one_touch_resolution_rate',
  help: 'Percentage of tickets resolved with a single reply (0-100)',
  registers: [register],
});

/** Average agent replies per ticket until resolution */
const repliesPerTicketAvg = new client.Gauge({
  name: 'zendesk_replies_per_ticket_avg',
  help: 'Average number of agent replies per ticket until resolution',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Capacity & workload metrics
// ---------------------------------------------------------------------------

/** Open ticket age distribution */
const backlogAgeTickets = new client.Gauge({
  name: 'zendesk_backlog_age_tickets',
  help: 'Open ticket count by age bucket',
  labelNames: ['bucket'],
  registers: [register],
});

/** Tickets with no assignee */
const unassignedTicketsTotal = new client.Gauge({
  name: 'zendesk_unassigned_tickets_total',
  help: 'Number of open tickets with no assignee',
  registers: [register],
});

/** Assignment rate of open tickets */
const assignmentRate = new client.Gauge({
  name: 'zendesk_assignment_rate',
  help: 'Percentage of open tickets that are assigned (0-100)',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Distribution metrics
// ---------------------------------------------------------------------------

/** Ticket distribution by communication channel */
const ticketsByChannel = new client.Gauge({
  name: 'zendesk_tickets_by_channel',
  help: 'Ticket count by communication channel',
  labelNames: ['channel'],
  registers: [register],
});

/** Ticket distribution by priority level */
const ticketsByPriority = new client.Gauge({
  name: 'zendesk_tickets_by_priority',
  help: 'Ticket count by priority level',
  labelNames: ['priority'],
  registers: [register],
});

/** Top ticket tags by frequency */
const ticketsByTag = new client.Gauge({
  name: 'zendesk_tickets_by_tag',
  help: 'Ticket count for top 10 tags',
  labelNames: ['tag'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Operational metrics
// ---------------------------------------------------------------------------

/** Suspended/spam queue size */
const suspendedTicketsTotal = new client.Gauge({
  name: 'zendesk_suspended_tickets_total',
  help: 'Number of tickets in suspended/spam queue',
  registers: [register],
});

/** Active automation rule count */
const automationsCount = new client.Gauge({
  name: 'zendesk_automations_count',
  help: 'Number of active automations',
  registers: [register],
});

/** Active trigger rule count */
const triggersCount = new client.Gauge({
  name: 'zendesk_triggers_count',
  help: 'Number of active triggers',
  registers: [register],
});

/** Active macro count */
const macrosCount = new client.Gauge({
  name: 'zendesk_macros_count',
  help: 'Number of active macros',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Exporter metadata
// ---------------------------------------------------------------------------

/** Exporter version and mode info */
const exporterInfo = new client.Gauge({
  name: 'zendesk_exporter_info',
  help: 'Exporter version and mode',
  labelNames: ['version', 'mode'],
  registers: [register],
});

module.exports = {
  register,

  // Core
  ticketsTotal,
  unsolvedTickets,
  ticketsCreatedTotal,
  ticketsByGroup,

  // SLA
  slaAchievementRate,
  slaBreachCount,
  slaBreachRateByPriority,

  // Response times
  firstReplyTime,
  fullResolutionTime,
  requesterWaitTimeSeconds,

  // Efficiency
  reopenedTicketsTotal,
  reopenedTicketsRate,
  oneTouchResolutionRate,
  repliesPerTicketAvg,

  // Capacity
  backlogAgeTickets,
  unassignedTicketsTotal,
  assignmentRate,

  // Distribution
  ticketsByChannel,
  ticketsByPriority,
  ticketsByTag,

  // Operational
  suspendedTicketsTotal,
  automationsCount,
  triggersCount,
  macrosCount,

  // Meta
  exporterInfo,
};
