const logger = require('./logger');
const ZendeskClient = require('./zendesk-client');
const MockZendeskClient = require('./mock-client');
const m = require('./metrics');

/**
 * Orchestrates periodic metric collection.
 * Uses Promise.allSettled so partial failures never block other metrics.
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
    const { ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN, ZENDESK_OAUTH_TOKEN } = process.env;
    if (!ZENDESK_SUBDOMAIN) throw new Error('ZENDESK_SUBDOMAIN is required');
    if (!ZENDESK_OAUTH_TOKEN && !(ZENDESK_EMAIL && ZENDESK_API_TOKEN)) {
      throw new Error('Set ZENDESK_OAUTH_TOKEN, or both ZENDESK_EMAIL and ZENDESK_API_TOKEN');
    }
    this.client = new ZendeskClient(ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN, ZENDESK_OAUTH_TOKEN);
    logger.info(`Using real Zendesk client with ${ZENDESK_OAUTH_TOKEN ? 'OAuth' : 'API token'} auth`);
  }

  setExporterInfo() {
    const pkg = require('../package.json');
    m.exporterInfo.set({ version: pkg.version, mode: process.env.ZENDESK_MOCK === 'true' ? 'mock' : 'live' }, 1);
  }

  async testConnection() {
    try { return await this.client.testConnection(); }
    catch (e) { logger.error('Connection test failed', e); return false; }
  }

  async collectMetrics() {
    if (this.isCollecting) { logger.warn('Already collecting, skip'); return; }
    this.isCollecting = true;
    const t0 = Date.now();

    try {
      logger.info('Starting metrics collection');

      const [rCounts, rCreatedTotal, rWindowed, rGroups, rChannels, rQuality, rCapacity, rOps] =
        await Promise.allSettled([
          this.client.getTicketCounts(),
          this.client.getTicketsCreatedTotal(),
          this.client.getWindowedCounts(),
          this.client.getTicketsByGroup(),
          this.client.getChannelMetrics(),
          this.client.getQualityMetrics(),
          this.client.getCapacityMetrics(),
          this.client.getOperationalMetrics(),
        ]);

      // All-time counts (labelled + individual gauges)
      this.applyMap(rCounts, m.ticketsTotal, 'ticket counts');
      if (rCounts.status === 'fulfilled') {
        Object.entries(rCounts.value).forEach(([status, count]) => {
          if (m.ticketsByStatus[status]) m.ticketsByStatus[status].set(count);
        });
      }
      this.applyScalar(rCreatedTotal, m.ticketsCreatedTotal, 'created total');

      // Windowed counts (created, solved, reopened × 1d/7d/30d)
      if (rWindowed.status === 'fulfilled') {
        const w = rWindowed.value;
        for (const window of ['1d', '7d', '30d']) {
          m.ticketsCreated[window].set(w.created[window]);
          m.solvedTickets[window].set(w.solved[window]);
          m.reopenedTickets[window].set(w.reopened[window]);
        }
      } else {
        logger.error('Failed: windowed counts', rWindowed.reason);
      }

      // Groups
      this.applyMap(rGroups, m.ticketsByGroup, 'groups', true);

      // Channel distribution
      if (rChannels.status === 'fulfilled') {
        const ch = rChannels.value;
        m.ticketsByChannel.reset();
        Object.entries(ch.ticketsByChannel).forEach(([k, v]) => m.ticketsByChannel.set({ channel: k }, v));
        m.ticketsByPriority.reset();
        Object.entries(ch.ticketsByPriority).forEach(([k, v]) => m.ticketsByPriority.set({ priority: k }, v));
        m.ticketsByTag.reset();
        Object.entries(ch.ticketsByTag).forEach(([k, v]) => m.ticketsByTag.set({ tag: k }, v));
      } else {
        logger.error('Failed: channels', rChannels.reason);
      }

      // Quality + response times (windowed)
      if (rQuality.status === 'fulfilled') {
        const q = rQuality.value;
        for (const window of ['1d', '7d', '30d']) {
          const d = q[window];
          m.firstReplyTime[window].set(d.firstReplyTime);
          m.fullResolutionTime[window].set(d.fullResolutionTime);
          m.requesterWaitTime[window].set(d.requesterWaitTime);
          m.oneTouchTickets[window].set(d.oneTouchTotal);
          m.repliesPerTicketAvg[window].set(d.avgReplies);
          m.sampleSize.set({ window }, d.sampleSize);
        }
      } else {
        logger.error('Failed: quality', rQuality.reason);
      }

      // Capacity
      if (rCapacity.status === 'fulfilled') {
        m.backlogAgeTickets.reset();
        Object.entries(rCapacity.value.backlogAge).forEach(([k, v]) => m.backlogAgeTickets.set({ bucket: k }, v));
        m.unassignedTicketsTotal.set(rCapacity.value.unassignedTotal);
      } else {
        logger.error('Failed: capacity', rCapacity.reason);
      }

      // Operational
      if (rOps.status === 'fulfilled') {
        m.suspendedTicketsTotal.set(rOps.value.suspendedTicketsTotal);
      } else {
        logger.error('Failed: operational', rOps.reason);
      }

      this.collectionErrors = 0;
      this.lastCollectionTime = new Date();
      logger.info(`Collection completed in ${Date.now() - t0}ms`);
    } catch (error) {
      this.collectionErrors++;
      logger.error(`Collection failed (${this.collectionErrors}/${this.maxConsecutiveErrors})`, error);
    } finally {
      this.isCollecting = false;
    }
  }

  applyMap(result, gauge, label, reset = false) {
    if (result.status === 'fulfilled') {
      if (reset) gauge.reset();
      Object.entries(result.value).forEach(([k, v]) => gauge.set({ [gauge.labelNames[0]]: k }, v));
    } else { logger.error(`Failed: ${label}`, result.reason); }
  }

  applyScalar(result, gauge, label) {
    if (result.status === 'fulfilled') gauge.set(result.value);
    else logger.error(`Failed: ${label}`, result.reason);
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
