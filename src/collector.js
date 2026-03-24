const logger = require('./logger');
const ZendeskClient = require('./zendesk-client');
const MockZendeskClient = require('./mock-client');
const {
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
} = require('./metrics');

/**
 * Orchestrates periodic metric collection from the Zendesk API (or mock).
 * Uses Promise.allSettled so partial API failures never block other metrics.
 *
 * @class MetricsCollector
 */
class MetricsCollector {
  constructor() {
    this.client = null;
    this.isCollecting = false;
    this.lastCollectionTime = null;
    this.collectionErrors = 0;

    /** Stop retrying after this many consecutive failures */
    this.maxConsecutiveErrors = 5;

    this.initializeClient();
    this.setExporterInfo();
  }

  /**
   * Pick real or mock client based on ZENDESK_MOCK env var.
   * Validates auth config before creating a real client.
   */
  initializeClient() {
    if (process.env.ZENDESK_MOCK === 'true') {
      this.client = new MockZendeskClient();
      logger.info('Using mock Zendesk client');
      return;
    }

    const {
      ZENDESK_SUBDOMAIN,
      ZENDESK_EMAIL,
      ZENDESK_API_TOKEN,
      ZENDESK_OAUTH_TOKEN,
    } = process.env;

    if (!ZENDESK_SUBDOMAIN) {
      throw new Error('ZENDESK_SUBDOMAIN is required');
    }

    const hasOAuth = !!ZENDESK_OAUTH_TOKEN;
    const hasApiToken = !!(ZENDESK_EMAIL && ZENDESK_API_TOKEN);

    if (!hasOAuth && !hasApiToken) {
      throw new Error(
        'Authentication required: set ZENDESK_OAUTH_TOKEN, or both ZENDESK_EMAIL and ZENDESK_API_TOKEN'
      );
    }

    this.client = new ZendeskClient(
      ZENDESK_SUBDOMAIN,
      ZENDESK_EMAIL,
      ZENDESK_API_TOKEN,
      ZENDESK_OAUTH_TOKEN
    );

    const method = hasOAuth ? 'OAuth Bearer token' : 'API token';
    logger.info(`Using real Zendesk client with ${method} authentication`);
  }

  setExporterInfo() {
    const pkg = require('../package.json');
    const mode = process.env.ZENDESK_MOCK === 'true' ? 'mock' : 'live';
    exporterInfo.set({ version: pkg.version, mode }, 1);
  }

  /** @returns {Promise<boolean>} */
  async testConnection() {
    try {
      return await this.client.testConnection();
    } catch (error) {
      logger.error('Connection test failed', error);
      return false;
    }
  }

  /**
   * Collect all metrics in one pass.
   * Each data source runs independently via Promise.allSettled —
   * a failure in one group never blocks the others.
   */
  async collectMetrics() {
    if (this.isCollecting) {
      logger.warn('Collection already in progress, skipping');
      return;
    }

    this.isCollecting = true;
    const t0 = Date.now();

    try {
      logger.info('Starting metrics collection');

      const [
        rTicketCounts,
        rUnsolved,
        rCreatedTotal,
        rSla,
        rReplyTimes,
        rGroups,
        rEfficiency,
        rCapacity,
        rChannels,
        rSlaDetail,
        rOperational,
      ] = await Promise.allSettled([
        this.client.getTicketCounts(),
        this.client.getUnsolvedTicketCount(),
        this.client.getTicketsCreatedTotal(),
        this.client.getSLAMetrics(),
        this.client.getReplyTimeMetrics(),
        this.client.getTicketsByGroup(),
        this.client.getEfficiencyMetrics(),
        this.client.getCapacityMetrics(),
        this.client.getChannelMetrics(),
        this.client.getSLADetailMetrics(),
        this.client.getOperationalMetrics(),
      ]);

      // --- Core -----------------------------------------------------------
      this.applyMap(rTicketCounts, ticketsTotal, 'ticket counts');
      this.applyScalar(rUnsolved, unsolvedTickets, 'unsolved tickets');
      this.applyScalar(rCreatedTotal, ticketsCreatedTotal, 'tickets created total');
      this.applyMap(rGroups, ticketsByGroup, 'tickets by group', true);

      // --- SLA ------------------------------------------------------------
      this.applyMap(rSla, slaAchievementRate, 'SLA achievement');

      // --- Response times -------------------------------------------------
      if (rReplyTimes.status === 'fulfilled') {
        firstReplyTime.set(rReplyTimes.value.firstReplyTime);
        fullResolutionTime.set(rReplyTimes.value.fullResolutionTime);
      } else {
        logger.error('Failed to collect reply time metrics', rReplyTimes.reason);
      }

      // --- Efficiency -----------------------------------------------------
      if (rEfficiency.status === 'fulfilled') {
        const e = rEfficiency.value;
        reopenedTicketsTotal.set(e.reopenedTotal);
        reopenedTicketsRate.set(e.reopenedRate);
        oneTouchResolutionRate.set(e.oneTouchRate);
        repliesPerTicketAvg.set(e.avgReplies);
        requesterWaitTimeSeconds.set(e.avgRequesterWait);
      } else {
        logger.error('Failed to collect efficiency metrics', rEfficiency.reason);
      }

      // --- Capacity -------------------------------------------------------
      if (rCapacity.status === 'fulfilled') {
        const c = rCapacity.value;
        backlogAgeTickets.reset();
        Object.entries(c.backlogAge).forEach(([bucket, count]) => {
          backlogAgeTickets.set({ bucket }, count);
        });
        unassignedTicketsTotal.set(c.unassignedTotal);
        assignmentRate.set(c.assignmentRate);
      } else {
        logger.error('Failed to collect capacity metrics', rCapacity.reason);
      }

      // --- Distribution ---------------------------------------------------
      if (rChannels.status === 'fulfilled') {
        const ch = rChannels.value;

        ticketsByChannel.reset();
        Object.entries(ch.ticketsByChannel).forEach(([channel, count]) => {
          ticketsByChannel.set({ channel }, count);
        });

        ticketsByPriority.reset();
        Object.entries(ch.ticketsByPriority).forEach(([priority, count]) => {
          ticketsByPriority.set({ priority }, count);
        });

        ticketsByTag.reset();
        Object.entries(ch.ticketsByTag).forEach(([tag, count]) => {
          ticketsByTag.set({ tag }, count);
        });
      } else {
        logger.error('Failed to collect channel metrics', rChannels.reason);
      }

      // --- SLA detail -----------------------------------------------------
      if (rSlaDetail.status === 'fulfilled') {
        const s = rSlaDetail.value;
        slaBreachCount.reset();
        Object.entries(s.breachCount).forEach(([metric, count]) => {
          slaBreachCount.set({ metric }, count);
        });
        slaBreachRateByPriority.reset();
        Object.entries(s.breachRateByPriority).forEach(([priority, rate]) => {
          slaBreachRateByPriority.set({ priority }, rate);
        });
      } else {
        logger.error('Failed to collect SLA detail metrics', rSlaDetail.reason);
      }

      // --- Operational ----------------------------------------------------
      if (rOperational.status === 'fulfilled') {
        const o = rOperational.value;
        suspendedTicketsTotal.set(o.suspendedTicketsTotal);
        automationsCount.set(o.automationsCount);
        triggersCount.set(o.triggersCount);
        macrosCount.set(o.macrosCount);
      } else {
        logger.error('Failed to collect operational metrics', rOperational.reason);
      }

      // Reset consecutive error counter on any successful pass
      this.collectionErrors = 0;
      this.lastCollectionTime = new Date();
      logger.info(`Metrics collection completed in ${Date.now() - t0}ms`);
    } catch (error) {
      this.collectionErrors++;
      logger.error(
        `Metrics collection failed (${this.collectionErrors}/${this.maxConsecutiveErrors})`,
        error
      );
    } finally {
      this.isCollecting = false;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers to reduce repetition in collectMetrics()
  // -----------------------------------------------------------------------

  /**
   * Set a labelled gauge from { key: value } result.
   * @param {PromiseSettledResult} result
   * @param {import('prom-client').Gauge} gauge
   * @param {string} label - for log messages
   * @param {boolean} [reset=false] - reset gauge before setting
   */
  applyMap(result, gauge, label, reset = false) {
    if (result.status === 'fulfilled') {
      if (reset) gauge.reset();
      Object.entries(result.value).forEach(([k, v]) => gauge.set({ [gauge.labelNames[0]]: k }, v));
      logger.debug(`Updated ${label}`);
    } else {
      logger.error(`Failed to collect ${label}`, result.reason);
    }
  }

  /**
   * Set a scalar gauge from a single-value result.
   * @param {PromiseSettledResult} result
   * @param {import('prom-client').Gauge} gauge
   * @param {string} label
   */
  applyScalar(result, gauge, label) {
    if (result.status === 'fulfilled') {
      gauge.set(result.value);
      logger.debug(`Updated ${label}`);
    } else {
      logger.error(`Failed to collect ${label}`, result.reason);
    }
  }

  getStatus() {
    return {
      isCollecting: this.isCollecting,
      lastCollectionTime: this.lastCollectionTime,
      collectionErrors: this.collectionErrors,
      mode: process.env.ZENDESK_MOCK === 'true' ? 'mock' : 'live',
    };
  }
}

module.exports = MetricsCollector;
