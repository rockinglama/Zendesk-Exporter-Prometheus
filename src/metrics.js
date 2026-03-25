const client = require('prom-client');

/**
 * Prometheus metrics for the Zendesk exporter.
 *
 * Naming convention for windowed metrics: {metric}_last_{window}
 * Windows: 1d (24h), 7d, 30d
 *
 * Data sources:
 * - "_total" / no suffix: all-time exact counts (Search Count API)
 * - "_last_Xd" counts: exact counts (Search Count API)
 * - "_last_Xd" averages: sampled from solved tickets via /tickets/{id}/metrics
 *   (one fetch for 30d, filtered client-side for 7d and 1d)
 *
 * @module metrics
 */

const register = new client.Registry();

client.collectDefaultMetrics({ register, prefix: 'zendesk_exporter_' });

// Helper to create windowed gauge triplets (1d, 7d, 30d)
function windowedGauges(baseName, help, opts = {}) {
  const windows = {};
  for (const w of ['1d', '7d', '30d']) {
    windows[w] = new client.Gauge({
      name: `${baseName}_last_${w}`,
      help: `${help} (last ${w})`,
      ...opts,
      registers: [register],
    });
  }
  return windows;
}

// ---------------------------------------------------------------------------
// All-time ticket counts (exact, Search Count API)
// ---------------------------------------------------------------------------

const ticketsTotal = new client.Gauge({
  name: 'zendesk_tickets_total',
  help: 'Current ticket count by status (all time)',
  labelNames: ['status'],
  registers: [register],
});

// Individual status gauges (easier to use in Grafana without label filters)
const STATUSES = ['new', 'open', 'pending', 'hold', 'solved', 'closed'];
const ticketsByStatus = {};
for (const s of STATUSES) {
  ticketsByStatus[s] = new client.Gauge({
    name: `zendesk_tickets_total_${s}`,
    help: `Current ${s} ticket count (all time)`,
    registers: [register],
  });
}

// Unsolved = new + open + pending + hold → calculate in Grafana:
// zendesk_tickets_total_new + zendesk_tickets_total_open + zendesk_tickets_total_pending + zendesk_tickets_total_hold

const ticketsCreatedTotal = new client.Gauge({
  name: 'zendesk_tickets_created_total',
  help: 'Cumulative total of all tickets ever created (use delta() in Grafana)',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Windowed counts (exact, Search Count API)
// ---------------------------------------------------------------------------

const ticketsCreated = windowedGauges(
  'zendesk_tickets_created',
  'Tickets created (exact count)'
);

const solvedTickets = windowedGauges(
  'zendesk_solved_tickets',
  'Tickets solved (exact count)'
);

const reopenedTickets = windowedGauges(
  'zendesk_reopened_tickets',
  'Tickets reopened (exact count)'
);

// ---------------------------------------------------------------------------
// Windowed quality metrics (sampled from solved tickets)
// ---------------------------------------------------------------------------

const firstReplyTime = windowedGauges(
  'zendesk_first_reply_time_seconds',
  'Avg first reply time in seconds, business hours (sampled from solved tickets)'
);

const fullResolutionTime = windowedGauges(
  'zendesk_full_resolution_time_seconds',
  'Avg full resolution time in seconds, business hours (sampled from solved tickets)'
);

const requesterWaitTime = windowedGauges(
  'zendesk_requester_wait_time_seconds',
  'Avg requester wait time in seconds (sampled from solved tickets)'
);

const oneTouchTickets = windowedGauges(
  'zendesk_one_touch_tickets',
  'Tickets solved with <= 1 reply (sampled from solved tickets)'
);

const repliesPerTicketAvg = windowedGauges(
  'zendesk_replies_per_ticket_avg',
  'Avg agent replies per ticket (sampled from solved tickets)'
);

// ---------------------------------------------------------------------------
// Distribution (exact counts or bounded samples)
// ---------------------------------------------------------------------------

const ticketsByGroup = new client.Gauge({
  name: 'zendesk_tickets_by_group',
  help: 'Ticket count by support group (all time, exact)',
  labelNames: ['group'],
  registers: [register],
});

const ticketsByChannel = new client.Gauge({
  name: 'zendesk_tickets_by_channel',
  help: 'Ticket count by channel (last 30d, sample max 1000)',
  labelNames: ['channel'],
  registers: [register],
});

const ticketsByPriority = new client.Gauge({
  name: 'zendesk_tickets_by_priority',
  help: 'Ticket count by priority (all time, exact)',
  labelNames: ['priority'],
  registers: [register],
});

const ticketsByTag = new client.Gauge({
  name: 'zendesk_tickets_by_tag',
  help: 'Top 10 tags by count (last 30d, sample max 1000)',
  labelNames: ['tag'],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Backlog
// ---------------------------------------------------------------------------

const backlogAgeTickets = new client.Gauge({
  name: 'zendesk_backlog_age_tickets',
  help: 'Open ticket count by age bucket (exact)',
  labelNames: ['bucket'],
  registers: [register],
});

const unassignedTicketsTotal = new client.Gauge({
  name: 'zendesk_unassigned_tickets_total',
  help: 'Open tickets with no assignee (exact)',
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
  help: 'Active automations',
  registers: [register],
});

const triggersCount = new client.Gauge({
  name: 'zendesk_triggers_count',
  help: 'Active triggers',
  registers: [register],
});

const macrosCount = new client.Gauge({
  name: 'zendesk_macros_count',
  help: 'Active macros',
  registers: [register],
});

// ---------------------------------------------------------------------------
// Transparency + metadata
// ---------------------------------------------------------------------------

const sampleSize = new client.Gauge({
  name: 'zendesk_sample_size',
  help: 'Tickets sampled for quality/time metrics per window',
  labelNames: ['window'],
  registers: [register],
});

const exporterInfo = new client.Gauge({
  name: 'zendesk_exporter_info',
  help: 'Exporter version and mode',
  labelNames: ['version', 'mode'],
  registers: [register],
});

module.exports = {
  register,

  // All-time
  ticketsTotal,
  ticketsByStatus,
  ticketsCreatedTotal,

  // Windowed counts (each is { '1d': Gauge, '7d': Gauge, '30d': Gauge })
  ticketsCreated,
  solvedTickets,
  reopenedTickets,

  // Windowed quality
  firstReplyTime,
  fullResolutionTime,
  requesterWaitTime,
  oneTouchTickets,
  repliesPerTicketAvg,

  // Distribution
  ticketsByGroup,
  ticketsByChannel,
  ticketsByPriority,
  ticketsByTag,

  // Backlog
  backlogAgeTickets,
  unassignedTicketsTotal,

  // Operational
  suspendedTicketsTotal,
  automationsCount,
  triggersCount,
  macrosCount,

  // Meta
  sampleSize,
  exporterInfo,
};
