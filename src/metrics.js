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

// === NEW METRICS ===

// Efficiency & Quality Metrics
const reopenedTicketsTotal = new client.Gauge({
  name: 'zendesk_reopened_tickets_total',
  help: 'Number of tickets that were reopened in the last 30 days',
  registers: [register],
});

const reopenedTicketsRate = new client.Gauge({
  name: 'zendesk_reopened_tickets_rate',
  help: 'Percentage of solved tickets that were reopened (0-100)',
  registers: [register],
});

const oneTouchResolutionRate = new client.Gauge({
  name: 'zendesk_one_touch_resolution_rate',
  help: 'Percentage of tickets solved with a single reply (0-100)',
  registers: [register],
});

const repliesPerTicketAvg = new client.Gauge({
  name: 'zendesk_replies_per_ticket_avg',
  help: 'Average number of replies per ticket until resolution (last 30d)',
  registers: [register],
});

const requesterWaitTimeSeconds = new client.Gauge({
  name: 'zendesk_requester_wait_time_seconds',
  help: 'Average total requester wait time in seconds',
  registers: [register],
});

// Capacity & Workload Metrics
const backlogAgeTickets = new client.Gauge({
  name: 'zendesk_backlog_age_tickets',
  help: 'Open ticket count by age bucket',
  labelNames: ['bucket'],
  registers: [register],
});

const ticketsPerAssignee = new client.Gauge({
  name: 'zendesk_tickets_per_assignee',
  help: 'Number of tickets per agent (by assignee ID only, never names)',
  labelNames: ['assignee_id'],
  registers: [register],
});

const unassignedTicketsTotal = new client.Gauge({
  name: 'zendesk_unassigned_tickets_total',
  help: 'Number of tickets with no assignee',
  registers: [register],
});

const assignmentRate = new client.Gauge({
  name: 'zendesk_assignment_rate',
  help: 'Percentage of open tickets that are assigned (0-100)',
  registers: [register],
});

// Channels & Trends Metrics
const ticketsByChannel = new client.Gauge({
  name: 'zendesk_tickets_by_channel',
  help: 'Ticket distribution by channel',
  labelNames: ['channel'],
  registers: [register],
});

const ticketsByPriority = new client.Gauge({
  name: 'zendesk_tickets_by_priority',
  help: 'Ticket distribution by priority level',
  labelNames: ['priority'],
  registers: [register],
});

const ticketsByTag = new client.Gauge({
  name: 'zendesk_tickets_by_tag',
  help: 'Top ticket tags by count',
  labelNames: ['tag'],
  registers: [register],
});

const satisfactionScoreRate = new client.Gauge({
  name: 'zendesk_satisfaction_score_rate',
  help: 'Aggregated CSAT good/(good+bad) ratio as percentage (0-100)',
  registers: [register],
});

const satisfactionGoodTotal = new client.Gauge({
  name: 'zendesk_satisfaction_good_total',
  help: 'Total number of good satisfaction ratings',
  registers: [register],
});

const satisfactionBadTotal = new client.Gauge({
  name: 'zendesk_satisfaction_bad_total',
  help: 'Total number of bad satisfaction ratings',
  registers: [register],
});

// SLA Detail Metrics
const slaBreachCount = new client.Gauge({
  name: 'zendesk_sla_breach_count',
  help: 'Current number of SLA breaches',
  labelNames: ['metric'],
  registers: [register],
});

const slaBreachRateByPriority = new client.Gauge({
  name: 'zendesk_sla_breach_rate_by_priority',
  help: 'SLA breach rate as percentage by priority level (0-100)',
  labelNames: ['priority'],
  registers: [register],
});

// Operational Metrics
const suspendedTicketsTotal = new client.Gauge({
  name: 'zendesk_suspended_tickets_total',
  help: 'Number of tickets in suspended/spam queue',
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

module.exports = {
  register,
  
  // Original metrics
  slaAchievementRate,
  firstReplyTime,
  fullResolutionTime,
  ticketsTotal,
  unsolvedTickets,
  ticketsCreated,
  ticketsByGroup,
  exporterInfo,
  
  // New metrics
  reopenedTicketsTotal,
  reopenedTicketsRate,
  oneTouchResolutionRate,
  repliesPerTicketAvg,
  requesterWaitTimeSeconds,
  backlogAgeTickets,
  ticketsPerAssignee,
  unassignedTicketsTotal,
  assignmentRate,
  ticketsByChannel,
  ticketsByPriority,
  ticketsByTag,
  satisfactionScoreRate,
  satisfactionGoodTotal,
  satisfactionBadTotal,
  slaBreachCount,
  slaBreachRateByPriority,
  suspendedTicketsTotal,
  automationsCount,
  triggersCount,
  macrosCount,
};