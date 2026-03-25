const logger = require('./logger');

class MockZendeskClient {
  constructor() {
    this.baseTicketCount = 1500;
    this.startTime = Date.now();
    logger.info('MockZendeskClient initialized');
  }

  v(base, pct = 0.1) { return Math.floor(base + (Math.random() - 0.5) * 2 * base * pct); }
  async delay() { await new Promise((r) => setTimeout(r, 50 + Math.random() * 100)); }

  async getTicketCounts() {
    await this.delay();
    const t = this.v(this.baseTicketCount, 0.05);
    return { new: this.v(t * 0.15, 0.3), open: this.v(t * 0.25, 0.2), pending: this.v(t * 0.2, 0.3), hold: this.v(t * 0.1, 0.4), solved: this.v(t * 0.25, 0.1), closed: this.v(t * 0.05, 0.5) };
  }


  async getTicketsCreatedTotal() {
    await this.delay();
    const days = (Date.now() - this.startTime) / 86400000;
    return this.v(this.baseTicketCount + Math.floor(days * 45), 0.02);
  }

  async getWindowedCounts() {
    await this.delay();
    return {
      created: { '1d': this.v(45, 0.4), '7d': this.v(320, 0.2), '30d': this.v(1350, 0.15) },
      solved: { '1d': this.v(40, 0.4), '7d': this.v(280, 0.2), '30d': this.v(1200, 0.15) },
      reopened: { '1d': 0, '7d': 0, '30d': 0 }, // actual counts come from getQualityMetrics
    };
  }

  async getTicketsByGroup() {
    await this.delay();
    return { 'Technical Support': this.v(200, 0.4), Sales: this.v(150, 0.4), Billing: this.v(180, 0.4), 'General Inquiries': this.v(220, 0.4), 'Product Questions': this.v(170, 0.4) };
  }

  async getChannelMetrics() {
    await this.delay();
    return {
      ticketsByChannel: { email: this.v(850, 0.15), chat: this.v(320, 0.25), voice: this.v(180, 0.3), web: this.v(120, 0.4), api: this.v(50, 0.6) },
      ticketsByPriority: { low: this.v(380, 0.2), normal: this.v(920, 0.15), high: this.v(160, 0.3), urgent: this.v(40, 0.5) },
      ticketsByTag: { billing: this.v(125, 0.3), technical: this.v(98, 0.4), account: this.v(87, 0.3), bug: this.v(76, 0.5), feature_request: this.v(65, 0.4), integration: this.v(54, 0.6), refund: this.v(43, 0.7), urgent: this.v(32, 0.8), escalated: this.v(21, 0.9), vip: this.v(18, 1.0) },
    };
  }

  async getQualityMetrics() {
    await this.delay();
    const result = {};
    const configs = { '1d': { solved: 40, oneTouch: 20, reopened: 1, replies: 2.5, wait: 5400, sample: 35 }, '7d': { solved: 280, oneTouch: 140, reopened: 5, replies: 2.7, wait: 6600, sample: 180 }, '30d': { solved: 1200, oneTouch: 600, reopened: 15, replies: 2.9, wait: 7200, sample: 200 } };
    for (const [w, c] of Object.entries(configs)) {
      result[w] = {
        firstReplyTime: this.v(3600, 0.2),
        fullResolutionTime: this.v(86400, 0.3),
        requesterWaitTime: this.v(c.wait, 0.3),
        oneTouchTotal: this.v(c.oneTouch, 0.2),
        reopenedTotal: this.v(c.reopened, 0.5),
        avgReplies: parseFloat((this.v(c.replies * 10, 0.2) / 10).toFixed(1)),
        sampleSize: this.v(c.sample, 0.1),
      };
    }
    return result;
  }

  async getCapacityMetrics() {
    await this.delay();
    const t = this.v(320, 0.2);
    return {
      backlogAge: { lt_1d: this.v(t * 0.35, 0.3), '1d_3d': this.v(t * 0.25, 0.3), '3d_7d': this.v(t * 0.2, 0.3), '7d_30d': this.v(t * 0.15, 0.3), gt_30d: this.v(t * 0.05, 0.3) },
      unassignedTotal: this.v(25, 0.6),
    };
  }

  async testConnection() { await this.delay(); logger.info('Mock connection OK'); return true; }
}

module.exports = MockZendeskClient;
