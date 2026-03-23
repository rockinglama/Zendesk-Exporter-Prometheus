const client = require('prom-client');

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics
client.collectDefaultMetrics({
  register,
  prefix: 'zendesk_exporter_',
});

// SLA Achievement Rate by channel
const slaAchievementRate = new client.Gauge({
  name: 'zendesk_sla_achievement_rate',
  help: 'SLA achievement rate percentage by channel',
  labelNames: ['channel'],
  registers: [register],
});

// First Reply Time - average last 30 days in seconds
const firstReplyTime = new client.Gauge({
  name: 'zendesk_first_reply_time_seconds',
  help: 'Average first reply time in seconds over last 30 days',
  registers: [register],
});

// Full Resolution Time - average last 30 days in seconds
const fullResolutionTime = new client.Gauge({
  name: 'zendesk_full_resolution_time_seconds',
  help: 'Average full resolution time in seconds over last 30 days',
  registers: [register],
});

// Ticket Volume by status
const ticketsTotal = new client.Gauge({
  name: 'zendesk_tickets_total',
  help: 'Current ticket counts by status',
  labelNames: ['status'],
  registers: [register],
});

// Unsolved Tickets
const unsolvedTickets = new client.Gauge({
  name: 'zendesk_unsolved_tickets_total',
  help: 'Total number of unsolved tickets',
  registers: [register],
});

// Tickets Created by period
const ticketsCreated = new client.Gauge({
  name: 'zendesk_tickets_created',
  help: 'Number of tickets created in time period',
  labelNames: ['period'],
  registers: [register],
});

// Tickets by Group
const ticketsByGroup = new client.Gauge({
  name: 'zendesk_tickets_by_group',
  help: 'Number of tickets by group',
  labelNames: ['group'],
  registers: [register],
});

// Exporter info
const exporterInfo = new client.Gauge({
  name: 'zendesk_exporter_info',
  help: 'Information about the exporter',
  labelNames: ['version', 'mode'],
  registers: [register],
});

module.exports = {
  register,
  slaAchievementRate,
  firstReplyTime,
  fullResolutionTime,
  ticketsTotal,
  unsolvedTickets,
  ticketsCreated,
  ticketsByGroup,
  exporterInfo,
};