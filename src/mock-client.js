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

  async getTicketsCreatedByPeriod() {
    await this.mockDelay();
    
    return {
      '24h': this.addVariance(45, 0.4),
      '7d': this.addVariance(320, 0.2),
      '30d': this.addVariance(1350, 0.15),
    };
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

  async testConnection() {
    await this.mockDelay();
    logger.info('Mock connection test - OK');
    return true;
  }
}

module.exports = MockZendeskClient;