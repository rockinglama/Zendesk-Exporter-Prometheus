const logger = require('./logger');

/**
 * Mock Zendesk client for local testing without API credentials.
 * Returns realistic, slightly fluctuating data on each call.
 *
 * @class MockZendeskClient
 */
class MockZendeskClient {
  constructor() {
    this.baseTicketCount = 1500;
    this.startTime = Date.now();
    logger.info('MockZendeskClient initialized');
  }

  /** Add random variance to a base value */
  addVariance(base, pct = 0.1) {
    return Math.floor(base + (Math.random() - 0.5) * 2 * base * pct);
  }

  /** Simulate API latency */
  async delay() {
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100));
  }

  // -- Ticket counts ------------------------------------------------------

  async getTicketCounts() {
    await this.delay();
    const t = this.addVariance(this.baseTicketCount, 0.05);
    return {
      new: this.addVariance(t * 0.15, 0.3),
      open: this.addVariance(t * 0.25, 0.2),
      pending: this.addVariance(t * 0.20, 0.3),
      hold: this.addVariance(t * 0.10, 0.4),
      solved: this.addVariance(t * 0.25, 0.1),
      closed: this.addVariance(t * 0.05, 0.5),
    };
  }

  async getUnsolvedTicketCount() {
    await this.delay();
    return this.addVariance(900, 0.15);
  }

  async getTicketsCreatedTotal() {
    await this.delay();
    const daysSinceStart = (Date.now() - this.startTime) / (24 * 60 * 60 * 1000);
    return this.addVariance(this.baseTicketCount + Math.floor(daysSinceStart * 45), 0.02);
  }

  async getSolvedTicketsTotal() {
    await this.delay();
    return this.addVariance(450, 0.15);
  }

  // -- Distribution -------------------------------------------------------

  async getTicketsByGroup() {
    await this.delay();
    return {
      'Technical Support': this.addVariance(200, 0.4),
      Sales: this.addVariance(150, 0.4),
      Billing: this.addVariance(180, 0.4),
      'General Inquiries': this.addVariance(220, 0.4),
      'Product Questions': this.addVariance(170, 0.4),
    };
  }

  async getChannelMetrics() {
    await this.delay();
    return {
      ticketsByChannel: {
        email: this.addVariance(850, 0.15),
        chat: this.addVariance(320, 0.25),
        voice: this.addVariance(180, 0.3),
        web: this.addVariance(120, 0.4),
        api: this.addVariance(50, 0.6),
      },
      ticketsByPriority: {
        low: this.addVariance(380, 0.2),
        normal: this.addVariance(920, 0.15),
        high: this.addVariance(160, 0.3),
        urgent: this.addVariance(40, 0.5),
      },
      ticketsByTag: {
        billing: this.addVariance(125, 0.3),
        technical: this.addVariance(98, 0.4),
        account: this.addVariance(87, 0.3),
        bug: this.addVariance(76, 0.5),
        feature_request: this.addVariance(65, 0.4),
        integration: this.addVariance(54, 0.6),
        refund: this.addVariance(43, 0.7),
        urgent: this.addVariance(32, 0.8),
        escalated: this.addVariance(21, 0.9),
        vip: this.addVariance(18, 1.0),
      },
    };
  }

  // -- Response times -----------------------------------------------------

  async getReplyTimeMetrics() {
    await this.delay();
    return {
      firstReplyTime: this.addVariance(3600, 0.2),
      fullResolutionTime: this.addVariance(86400, 0.3),
      sampleSize: this.addVariance(180, 0.1),
    };
  }

  // -- Quality ------------------------------------------------------------

  async getQualityMetrics() {
    await this.delay();
    return {
      reopenedTotal: this.addVariance(15, 0.4),
      oneTouchTotal: this.addVariance(180, 0.2),
      avgReplies: parseFloat((this.addVariance(28, 0.2) / 10).toFixed(1)),
      avgRequesterWait: this.addVariance(7200, 0.3),
      sampleSize: this.addVariance(180, 0.1),
    };
  }

  // -- Capacity -----------------------------------------------------------

  async getCapacityMetrics() {
    await this.delay();
    const total = this.addVariance(320, 0.2);
    return {
      backlogAge: {
        lt_1d: this.addVariance(total * 0.35, 0.3),
        '1d_3d': this.addVariance(total * 0.25, 0.3),
        '3d_7d': this.addVariance(total * 0.20, 0.3),
        '7d_30d': this.addVariance(total * 0.15, 0.3),
        gt_30d: this.addVariance(total * 0.05, 0.3),
      },
      unassignedTotal: this.addVariance(25, 0.6),
    };
  }

  // -- Operational --------------------------------------------------------

  async getOperationalMetrics() {
    await this.delay();
    return {
      suspendedTicketsTotal: this.addVariance(23, 0.8),
      automationsCount: this.addVariance(15, 0.2),
      triggersCount: this.addVariance(28, 0.15),
      macrosCount: this.addVariance(45, 0.1),
    };
  }

  // -- Connection test ----------------------------------------------------

  async testConnection() {
    await this.delay();
    logger.info('Mock connection test OK');
    return true;
  }
}

module.exports = MockZendeskClient;
