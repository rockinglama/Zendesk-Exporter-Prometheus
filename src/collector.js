const logger = require('./logger');
const ZendeskClient = require('./zendesk-client');
const MockZendeskClient = require('./mock-client');
const {
  ticketsTotal,
  unsolvedTickets,
  ticketsCreatedTotal,
  solvedTicketsTotal,
  ticketsByGroup,
  ticketsByChannel,
  ticketsByPriority,
  ticketsByTag,
  firstReplyTime,
  fullResolutionTime,
  requesterWaitTimeSeconds,
  reopenedTicketsTotal,
  oneTouchTicketsTotal,
  repliesPerTicketAvg,
  backlogAgeTickets,
  unassignedTicketsTotal,
  suspendedTicketsTotal,
  automationsCount,
  triggersCount,
  macrosCount,
  exporterInfo,
} = require('./metrics');

/**
 * Orchestrates periodic metric collection from the Zendesk API (or mock).
 *
 * Philosophy: collect raw data only. All rate/percentage calculations
 * happen in Grafana dashboards, not here.
 *
 * @class MetricsCollector
 */
class MetricsCollector {
  constructor() {
    this.client = null;
    this.isCollecting = false;
    this.lastCollectionTime = null;
    this.collectionErrors = 0;
    this.maxConsecutiveErrors = 5;

    this.initializeClient();
    this.setExporterInfo();
  }

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

    logger.info(`Using real Zendesk client with ${hasOAuth ? 'OAuth' : 'API token'} auth`);
  }

  setExporterInfo() {
    const pkg = require('../package.json');
    const mode = process.env.ZENDESK_MOCK === 'true' ? 'mock' : 'live';
    exporterInfo.set({ version: pkg.version, mode }, 1);
  }

  async testConnection() {
    try {
      return await this.client.testConnection();
    } catch (error) {
      logger.error('Connection test failed', error);
      return false;
    }
  }

  /**
   * Collect all metrics. Each group runs independently via Promise.allSettled.
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
        rSolvedTotal,
        rGroups,
        rChannels,
        rReplyTimes,
        rQuality,
        rCapacity,
        rOperational,
      ] = await Promise.allSettled([
        this.client.getTicketCounts(),
        this.client.getUnsolvedTicketCount(),
        this.client.getTicketsCreatedTotal(),
        this.client.getSolvedTicketsTotal(),
        this.client.getTicketsByGroup(),
        this.client.getChannelMetrics(),
        this.client.getReplyTimeMetrics(),
        this.client.getQualityMetrics(),
        this.client.getCapacityMetrics(),
        this.client.getOperationalMetrics(),
      ]);

      // Ticket counts by status
      this.applyMap(rTicketCounts, ticketsTotal, 'ticket counts');

      // Scalar counts
      this.applyScalar(rUnsolved, unsolvedTickets, 'unsolved tickets');
      this.applyScalar(rCreatedTotal, ticketsCreatedTotal, 'tickets created total');
      this.applyScalar(rSolvedTotal, solvedTicketsTotal, 'solved tickets total');

      // Groups
      this.applyMap(rGroups, ticketsByGroup, 'tickets by group', true);

      // Channel distribution
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

      // Response times
      if (rReplyTimes.status === 'fulfilled') {
        firstReplyTime.set(rReplyTimes.value.firstReplyTime);
        fullResolutionTime.set(rReplyTimes.value.fullResolutionTime);
      } else {
        logger.error('Failed to collect reply time metrics', rReplyTimes.reason);
      }

      // Quality (raw counts)
      if (rQuality.status === 'fulfilled') {
        const q = rQuality.value;
        reopenedTicketsTotal.set(q.reopenedTotal);
        oneTouchTicketsTotal.set(q.oneTouchTotal);
        repliesPerTicketAvg.set(q.avgReplies);
        requesterWaitTimeSeconds.set(q.avgRequesterWait);
      } else {
        logger.error('Failed to collect quality metrics', rQuality.reason);
      }

      // Capacity
      if (rCapacity.status === 'fulfilled') {
        const c = rCapacity.value;
        backlogAgeTickets.reset();
        Object.entries(c.backlogAge).forEach(([bucket, count]) => {
          backlogAgeTickets.set({ bucket }, count);
        });
        unassignedTicketsTotal.set(c.unassignedTotal);
      } else {
        logger.error('Failed to collect capacity metrics', rCapacity.reason);
      }

      // Operational
      if (rOperational.status === 'fulfilled') {
        const o = rOperational.value;
        suspendedTicketsTotal.set(o.suspendedTicketsTotal);
        automationsCount.set(o.automationsCount);
        triggersCount.set(o.triggersCount);
        macrosCount.set(o.macrosCount);
      } else {
        logger.error('Failed to collect operational metrics', rOperational.reason);
      }

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

  /** Set a labelled gauge from { key: value } */
  applyMap(result, gauge, label, reset = false) {
    if (result.status === 'fulfilled') {
      if (reset) gauge.reset();
      Object.entries(result.value).forEach(([k, v]) => gauge.set({ [gauge.labelNames[0]]: k }, v));
      logger.debug(`Updated ${label}`);
    } else {
      logger.error(`Failed to collect ${label}`, result.reason);
    }
  }

  /** Set a scalar gauge */
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
