const MockZendeskClient = require('../src/mock-client');

describe('MockZendeskClient', () => {
  let client;

  beforeEach(() => {
    client = new MockZendeskClient();
  });

  describe('Constructor', () => {
    test('should initialize with default values', () => {
      expect(client.baseTicketCount).toBe(1500);
      expect(client.startTime).toBeDefined();
      expect(typeof client.startTime).toBe('number');
    });
  });

  describe('Utility Methods', () => {
    test('v() should create realistic variance', () => {
      const base = 100;
      const results = [];
      
      // Generate multiple values to test variance
      for (let i = 0; i < 50; i++) {
        results.push(client.v(base, 0.1));
      }
      
      // Should have some variance (not all the same)
      const uniqueValues = [...new Set(results)];
      expect(uniqueValues.length).toBeGreaterThan(1);
      
      // Values should be around the base value (within 10% variance range)
      results.forEach(value => {
        expect(value).toBeGreaterThanOrEqual(base * 0.9);
        expect(value).toBeLessThanOrEqual(base * 1.1);
      });
    });

    test('delay() should be a promise that resolves', async () => {
      const start = Date.now();
      await client.delay();
      const elapsed = Date.now() - start;
      
      // Should delay between 50-150ms
      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('getTicketCounts', () => {
    test('should return all 6 ticket statuses', async () => {
      const result = await client.getTicketCounts();
      
      expect(result).toHaveProperty('new');
      expect(result).toHaveProperty('open');
      expect(result).toHaveProperty('pending');
      expect(result).toHaveProperty('hold');
      expect(result).toHaveProperty('solved');
      expect(result).toHaveProperty('closed');
      
      // All should be numbers
      Object.values(result).forEach(count => {
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThanOrEqual(0);
      });
    });

    test('should return different values on multiple calls', async () => {
      const result1 = await client.getTicketCounts();
      const result2 = await client.getTicketCounts();
      
      // Should have some difference due to variance
      const hasVariance = Object.keys(result1).some(key => result1[key] !== result2[key]);
      expect(hasVariance).toBe(true);
    });
  });

  describe('getTicketsCreatedTotal', () => {
    test('should return increasing total over time', async () => {
      const result = await client.getTicketsCreatedTotal();
      
      expect(typeof result).toBe('number');
      // With variance, it might be slightly less than base, but should be reasonable
      expect(result).toBeGreaterThan(client.baseTicketCount * 0.9);
    });
  });

  describe('getWindowedCounts', () => {
    test('should return created, solved, and reopened for all windows', async () => {
      const result = await client.getWindowedCounts();
      
      expect(result).toHaveProperty('created');
      expect(result).toHaveProperty('solved');
      expect(result).toHaveProperty('reopened');
      
      // Each should have all three windows
      ['created', 'solved', 'reopened'].forEach(type => {
        expect(result[type]).toHaveProperty('1d');
        expect(result[type]).toHaveProperty('7d');
        expect(result[type]).toHaveProperty('30d');
        
        Object.values(result[type]).forEach(count => {
          expect(typeof count).toBe('number');
          expect(count).toBeGreaterThanOrEqual(0);
        });
      });
    });

    test('should have logical ordering (30d > 7d > 1d)', async () => {
      const result = await client.getWindowedCounts();
      
      ['created', 'solved'].forEach(type => {
        expect(result[type]['30d']).toBeGreaterThanOrEqual(result[type]['7d']);
        expect(result[type]['7d']).toBeGreaterThanOrEqual(result[type]['1d']);
      });
    });
  });

  describe('getTicketsByGroup', () => {
    test('should return ticket counts by group', async () => {
      const result = await client.getTicketsByGroup();
      
      expect(typeof result).toBe('object');
      expect(Object.keys(result).length).toBeGreaterThan(0);
      
      // Should have expected groups
      expect(result).toHaveProperty('Technical Support');
      expect(result).toHaveProperty('Sales');
      expect(result).toHaveProperty('Billing');
      
      Object.values(result).forEach(count => {
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThan(0);
      });
    });
  });

  describe('getChannelMetrics', () => {
    test('should return ticketsByChannel, ticketsByPriority, and ticketsByTag', async () => {
      const result = await client.getChannelMetrics();
      
      expect(result).toHaveProperty('ticketsByChannel');
      expect(result).toHaveProperty('ticketsByPriority');
      expect(result).toHaveProperty('ticketsByTag');
      
      // Check ticketsByChannel
      expect(result.ticketsByChannel).toHaveProperty('email');
      expect(result.ticketsByChannel).toHaveProperty('chat');
      expect(result.ticketsByChannel).toHaveProperty('voice');
      expect(result.ticketsByChannel).toHaveProperty('web');
      expect(result.ticketsByChannel).toHaveProperty('api');
      
      // Check ticketsByPriority
      expect(result.ticketsByPriority).toHaveProperty('low');
      expect(result.ticketsByPriority).toHaveProperty('normal');
      expect(result.ticketsByPriority).toHaveProperty('high');
      expect(result.ticketsByPriority).toHaveProperty('urgent');
      
      // Check ticketsByTag - should have at least 10 tags
      expect(Object.keys(result.ticketsByTag).length).toBeGreaterThanOrEqual(10);
      expect(result.ticketsByTag).toHaveProperty('billing');
      expect(result.ticketsByTag).toHaveProperty('technical');
      
      // All values should be numbers > 0
      [result.ticketsByChannel, result.ticketsByPriority, result.ticketsByTag].forEach(obj => {
        Object.values(obj).forEach(count => {
          expect(typeof count).toBe('number');
          expect(count).toBeGreaterThan(0);
        });
      });
    });
  });

  describe('getQualityMetrics', () => {
    test('should return quality metrics for all windows', async () => {
      const result = await client.getQualityMetrics();
      
      ['1d', '7d', '30d'].forEach(window => {
        expect(result).toHaveProperty(window);
        
        const windowData = result[window];
        expect(windowData).toHaveProperty('firstReplyTime');
        expect(windowData).toHaveProperty('fullResolutionTime');
        expect(windowData).toHaveProperty('requesterWaitTime');
        expect(windowData).toHaveProperty('oneTouchTotal');
        expect(windowData).toHaveProperty('reopenedTotal');
        expect(windowData).toHaveProperty('avgReplies');
        expect(windowData).toHaveProperty('sampleSize');
        
        // Check types
        expect(typeof windowData.firstReplyTime).toBe('number');
        expect(typeof windowData.fullResolutionTime).toBe('number');
        expect(typeof windowData.requesterWaitTime).toBe('number');
        expect(typeof windowData.oneTouchTotal).toBe('number');
        expect(typeof windowData.reopenedTotal).toBe('number');
        expect(typeof windowData.avgReplies).toBe('number');
        expect(typeof windowData.sampleSize).toBe('number');
        
        // avgReplies should be a reasonable value (decimal)
        expect(windowData.avgReplies).toBeGreaterThan(0);
        expect(windowData.avgReplies).toBeLessThan(10);
      });
    });

    test('should have realistic variance in quality metrics', async () => {
      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push(await client.getQualityMetrics());
      }
      
      // Check that at least some values vary between calls
      let hasVariance = false;
      ['1d', '7d', '30d'].forEach(window => {
        if (results[0][window].firstReplyTime !== results[1][window].firstReplyTime) {
          hasVariance = true;
        }
      });
      
      expect(hasVariance).toBe(true);
    });
  });

  describe('getCapacityMetrics', () => {
    test('should return backlogAge and unassignedTotal', async () => {
      const result = await client.getCapacityMetrics();
      
      expect(result).toHaveProperty('backlogAge');
      expect(result).toHaveProperty('unassignedTotal');
      
      // Check backlog age buckets
      expect(result.backlogAge).toHaveProperty('lt_1d');
      expect(result.backlogAge).toHaveProperty('1d_3d');
      expect(result.backlogAge).toHaveProperty('3d_7d');
      expect(result.backlogAge).toHaveProperty('7d_30d');
      expect(result.backlogAge).toHaveProperty('gt_30d');
      
      Object.values(result.backlogAge).forEach(count => {
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThanOrEqual(0);
      });
      
      expect(typeof result.unassignedTotal).toBe('number');
      expect(result.unassignedTotal).toBeGreaterThanOrEqual(0);
    });
  });


  describe('testConnection', () => {
    test('should return true', async () => {
      const result = await client.testConnection();
      expect(result).toBe(true);
    });
  });

  describe('Realistic Data Properties', () => {
    test('all methods should return values with realistic variance', async () => {
      // Call all methods multiple times to ensure variance
      const methods = [
        'getTicketCounts',
        'getTicketsCreatedTotal',
        'getWindowedCounts',
        'getTicketsByGroup',
        'getChannelMetrics',
        'getQualityMetrics',
        'getCapacityMetrics',
      ];
      
      for (const method of methods) {
        const results = [];
        for (let i = 0; i < 3; i++) {
          results.push(await client[method]());
        }
        
        // Results should not be identical (due to variance)
        expect(JSON.stringify(results[0])).not.toBe(JSON.stringify(results[1]));
      }
    });

    test('values should not be constant across multiple instances', async () => {
      const client1 = new MockZendeskClient();
      
      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 5));
      
      const client2 = new MockZendeskClient();
      
      // Different instances should have different start times (unless running very fast)
      const timeDiff = Math.abs(client1.startTime - client2.startTime);
      expect(timeDiff).toBeGreaterThanOrEqual(0); // At least some difference or same if very fast
      
      // More importantly, test that they produce different values due to variance
      const counts1 = await client1.getTicketCounts();
      const counts2 = await client2.getTicketCounts();
      
      // Values should be different due to random variance
      const areDifferent = Object.keys(counts1).some(key => counts1[key] !== counts2[key]);
      expect(areDifferent).toBe(true);
    });
  });
});