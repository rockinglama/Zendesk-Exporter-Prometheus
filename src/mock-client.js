const logger = require('./logger');

class MockZendeskClient {
  constructor() {
    this.baseTicketCount = 1500;
    this.startTime = Date.now();
    logger.info('MockZendeskClient initialized - serving fake data');
  }

  // Add some variance to make mock data more realistic
  addVariance(baseValue, percentage = 0.1) {
    const variance = baseValue * percentage;
    return Math.floor(baseValue + (Math.random() - 0.5) * 2 * variance);
  }

  async getTicketCounts() {
    await this.mockDelay();
    
    const total = this.addVariance(this.baseTicketCount, 0.05);
    
    return {
      new: this.addVariance(Math.floor(total * 0.15), 0.3),
      open: this.addVariance(Math.floor(total * 0.25), 0.2),
      pending: this.addVariance(Math.floor(total * 0.20), 0.3),
      hold: this.addVariance(Math.floor(total * 0.10), 0.4),
      solved: this.addVariance(Math.floor(total * 0.25), 0.1),
      closed: this.addVariance(Math.floor(total * 0.05), 0.5),
    };
  }

  async getUnsolvedTicketCount() {
    await this.mockDelay();
    const counts = await this.getTicketCounts();
    return counts.new + counts.open + counts.pending + counts.hold;
  }

  /**
   * Mock cumulative total of all tickets.
   * Increases slowly over time to simulate real ticket creation.
   * @returns {Promise<number>}
   */
  async getTicketsCreatedTotal() {
    await this.mockDelay();
    // Simulate a growing total — base count + ~45 tickets/day since start
    const daysSinceStart = (Date.now() - this.startTime) / (24 * 60 * 60 * 1000);
    const growth = Math.floor(daysSinceStart * 45);
    return this.addVariance(this.baseTicketCount + growth, 0.02);
  }

  async getSLAMetrics() {
    await this.mockDelay();
    
    return {
      email: this.addVariance(85, 0.1),
      phone: this.addVariance(92, 0.08),
      chat: this.addVariance(78, 0.15),
    };
  }

  async getReplyTimeMetrics() {
    await this.mockDelay();
    
    // Times in seconds
    return {
      firstReplyTime: this.addVariance(3600, 0.2), // ~1 hour average
      fullResolutionTime: this.addVariance(86400, 0.3), // ~24 hours average
    };
  }

  async getTicketsByGroup() {
    await this.mockDelay();
    
    const groups = [
      'Technical Support',
      'Sales',
      'Billing',
      'General Inquiries',
      'Product Questions',
    ];
    
    const result = {};
    groups.forEach(group => {
      result[group] = this.addVariance(200, 0.4);
    });
    
    return result;
  }

  async mockDelay() {
    // Simulate API response time (50-200ms)
    const delay = 50 + Math.random() * 150;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Mock efficiency and quality metrics with realistic variance
   * @returns {Promise<Object>} Mock efficiency metrics
   */
  async getEfficiencyMetrics() {
    await this.mockDelay();
    
    const baseReopened = 15;
    const baseSolved = 450;
    const reopenedTotal = this.addVariance(baseReopened, 0.4);
    const solvedTotal = this.addVariance(baseSolved, 0.1);
    const reopenedRate = Math.min(100, (reopenedTotal / solvedTotal) * 100);
    
    return {
      reopenedTotal,
      reopenedRate: this.addVariance(reopenedRate, 0.2),
      oneTouchRate: this.addVariance(72, 0.15), // 72% one-touch resolution
      avgReplies: this.addVariance(2.8, 0.2), // Average 2.8 replies per ticket
      avgRequesterWait: this.addVariance(7200, 0.3), // 2 hours average wait
    };
  }

  /**
   * Mock capacity and workload metrics with realistic distribution
   * @returns {Promise<Object>} Mock capacity metrics
   */
  async getCapacityMetrics() {
    await this.mockDelay();
    
    const totalBacklog = this.addVariance(320, 0.2);
    
    // Realistic age distribution (more recent tickets)
    const distribution = {
      lt_1d: 0.35,
      '1d_3d': 0.25,
      '3d_7d': 0.20,
      '7d_30d': 0.15,
      'gt_30d': 0.05,
    };
    
    const backlogAge = {};
    Object.entries(distribution).forEach(([bucket, ratio]) => {
      backlogAge[bucket] = this.addVariance(Math.floor(totalBacklog * ratio), 0.3);
    });
    
    const unassignedTotal = this.addVariance(25, 0.6);
    const totalOpen = Object.values(backlogAge).reduce((sum, count) => sum + count, 0);
    const assignmentRate = Math.min(100, ((totalOpen - unassignedTotal) / totalOpen) * 100);
    
    return {
      backlogAge,
      unassignedTotal,
      assignmentRate: this.addVariance(assignmentRate, 0.1),
    };
  }

  /**
   * Mock channel and trend metrics with realistic patterns
   * @returns {Promise<Object>} Mock channel metrics
   */
  async getChannelMetrics() {
    await this.mockDelay();
    
    // Realistic channel distribution
    const ticketsByChannel = {
      email: this.addVariance(850, 0.15),
      chat: this.addVariance(320, 0.25),
      phone: this.addVariance(180, 0.3),
      web: this.addVariance(120, 0.4),
      api: this.addVariance(50, 0.6),
    };
    
    // Realistic priority distribution  
    const ticketsByPriority = {
      low: this.addVariance(380, 0.2),
      normal: this.addVariance(920, 0.15),
      high: this.addVariance(160, 0.3),
      urgent: this.addVariance(40, 0.5),
    };
    
    // Mock top tags
    const commonTags = {
      'billing': this.addVariance(125, 0.3),
      'technical': this.addVariance(98, 0.4),
      'account': this.addVariance(87, 0.3),
      'bug': this.addVariance(76, 0.5),
      'feature_request': this.addVariance(65, 0.4),
      'integration': this.addVariance(54, 0.6),
      'refund': this.addVariance(43, 0.7),
      'urgent': this.addVariance(32, 0.8),
      'escalated': this.addVariance(21, 0.9),
      'vip': this.addVariance(18, 1.0),
    };
    
    return {
      ticketsByChannel,
      ticketsByPriority,
      ticketsByTag: commonTags,
    };
  }

  /**
   * Mock SLA detail metrics with realistic breach patterns
   * @returns {Promise<Object>} Mock SLA metrics
   */
  async getSLADetailMetrics() {
    await this.mockDelay();
    
    return {
      breachCount: {
        reply_time: this.addVariance(12, 0.5),
        resolution_time: this.addVariance(8, 0.6),
      },
      breachRateByPriority: {
        low: this.addVariance(18, 0.4), // Higher breach rate for low priority
        normal: this.addVariance(12, 0.3),
        high: this.addVariance(8, 0.4),
        urgent: this.addVariance(5, 0.5), // Lower breach rate for urgent
      },
    };
  }

  /**
   * Mock operational metrics with realistic counts
   * @returns {Promise<Object>} Mock operational metrics
   */
  async getOperationalMetrics() {
    await this.mockDelay();
    
    return {
      suspendedTicketsTotal: this.addVariance(23, 0.8), // Spam queue size
      automationsCount: this.addVariance(15, 0.2), // Stable automation count
      triggersCount: this.addVariance(28, 0.15), // Stable trigger count  
      macrosCount: this.addVariance(45, 0.1), // Stable macro count
    };
  }

  async testConnection() {
    await this.mockDelay();
    logger.info('Mock connection test - OK');
    return true;
  }
}

module.exports = MockZendeskClient;