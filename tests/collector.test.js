const MetricsCollector = require('../src/collector');

// Mock the logger to avoid console output during tests
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('MetricsCollector', () => {
  let collector;
  let originalEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };
    
    // Set mock mode for tests
    process.env.ZENDESK_MOCK = 'true';
    
    // Clear require cache to get fresh instances
    delete require.cache[require.resolve('../src/collector')];
    delete require.cache[require.resolve('../src/metrics')];
    
    const MetricsCollectorClass = require('../src/collector');
    collector = new MetricsCollectorClass();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('Constructor', () => {
    test('should initialize with mock client when ZENDESK_MOCK=true', () => {
      expect(collector.client).toBeDefined();
      expect(collector.client.constructor.name).toBe('MockZendeskClient');
      expect(collector.isCollecting).toBe(false);
      expect(collector.lastCollectionTime).toBe(null);
      expect(collector.collectionErrors).toBe(0);
    });

    test('should throw error without required environment variables in live mode', () => {
      process.env.ZENDESK_MOCK = 'false';
      delete process.env.ZENDESK_SUBDOMAIN;
      
      expect(() => {
        delete require.cache[require.resolve('../src/collector')];
        const MetricsCollectorClass = require('../src/collector');
        new MetricsCollectorClass();
      }).toThrow('ZENDESK_SUBDOMAIN is required');
    });

    test('should throw error without authentication in live mode', () => {
      process.env.ZENDESK_MOCK = 'false';
      process.env.ZENDESK_SUBDOMAIN = 'test';
      delete process.env.ZENDESK_OAUTH_TOKEN;
      delete process.env.ZENDESK_EMAIL;
      delete process.env.ZENDESK_API_TOKEN;
      
      expect(() => {
        delete require.cache[require.resolve('../src/collector')];
        const MetricsCollectorClass = require('../src/collector');
        new MetricsCollectorClass();
      }).toThrow('Set ZENDESK_OAUTH_TOKEN, or both ZENDESK_EMAIL and ZENDESK_API_TOKEN');
    });
  });

  describe('testConnection', () => {
    test('should return true for mock client', async () => {
      const result = await collector.testConnection();
      expect(result).toBe(true);
    });

    test('should return false and log error on connection failure', async () => {
      // Mock client to throw error
      collector.client.testConnection = jest.fn().mockRejectedValue(new Error('Connection failed'));
      
      const result = await collector.testConnection();
      expect(result).toBe(false);
    });
  });

  describe('collectMetrics', () => {
    test('should successfully collect all metrics', async () => {
      await collector.collectMetrics();
      
      expect(collector.lastCollectionTime).toBeDefined();
      expect(collector.lastCollectionTime).toBeInstanceOf(Date);
      expect(collector.collectionErrors).toBe(0);
      expect(collector.isCollecting).toBe(false);
    });

    test('should not collect if already collecting', async () => {
      collector.isCollecting = true;
      const originalLastCollection = collector.lastCollectionTime;
      
      await collector.collectMetrics();
      
      expect(collector.lastCollectionTime).toBe(originalLastCollection);
    });

    test('should handle partial API failures gracefully', async () => {
      // Mock some methods to fail
      collector.client.getTicketCounts = jest.fn().mockRejectedValue(new Error('API Error'));
      collector.client.getQualityMetrics = jest.fn().mockRejectedValue(new Error('Quality API Error'));
      
      // Should not throw
      await expect(collector.collectMetrics()).resolves.not.toThrow();
      
      // Should still complete and update last collection time
      expect(collector.lastCollectionTime).toBeDefined();
    });

    test('should populate metrics with mock data', async () => {
      const metrics = require('../src/metrics');
      
      // Clear any existing data
      await collector.collectMetrics();
      
      // Check that metrics were populated
      const registryMetrics = await metrics.register.getMetricsAsJSON();
      const metricNames = registryMetrics.map(m => m.name);
      
      expect(metricNames).toContain('zendesk_tickets_total');
      expect(metricNames).toContain('zendesk_tickets_total_new');
      expect(metricNames).toContain('zendesk_solved_tickets_last_1d');
      
      // Check that metrics have values
      const ticketsTotal = registryMetrics.find(m => m.name === 'zendesk_tickets_total');
      expect(ticketsTotal.values.length).toBeGreaterThan(0);
    });

    test('should reset isCollecting flag even if collection fails', async () => {
      // Mock all methods to fail
      const errorMethods = [
        'getTicketCounts',
        'getTicketsCreatedTotal',
        'getWindowedCounts',
        'getTicketsByGroup',
        'getChannelMetrics',
        'getQualityMetrics',
        'getCapacityMetrics',
      ];
      
      errorMethods.forEach(method => {
        collector.client[method] = jest.fn().mockRejectedValue(new Error(`${method} failed`));
      });
      
      await collector.collectMetrics();
      
      expect(collector.isCollecting).toBe(false);
    });
  });

  describe('getStatus', () => {
    test('should return correct status shape', () => {
      const status = collector.getStatus();
      
      expect(status).toHaveProperty('isCollecting');
      expect(status).toHaveProperty('lastCollectionTime');
      expect(status).toHaveProperty('collectionErrors');
      expect(status).toHaveProperty('mode');
      
      expect(typeof status.isCollecting).toBe('boolean');
      expect(typeof status.collectionErrors).toBe('number');
      expect(typeof status.mode).toBe('string');
    });

    test('should return null for lastCollectionTime initially', () => {
      const status = collector.getStatus();
      expect(status.lastCollectionTime).toBe(null);
    });

    test('should return Date object for lastCollectionTime after collection', async () => {
      await collector.collectMetrics();
      const status = collector.getStatus();
      
      expect(status.lastCollectionTime).toBeInstanceOf(Date);
    });
  });

  describe('Error Handling', () => {
    test('should increment error count on collection failure', async () => {
      // Mock to throw an error in the try/catch block
      collector.client.getTicketCounts = jest.fn(() => {
        throw new Error('Major failure');
      });
      
      const initialErrors = collector.collectionErrors;
      await collector.collectMetrics();
      
      expect(collector.collectionErrors).toBe(initialErrors + 1);
    });

    test('should reset error count on successful collection', async () => {
      // Set some errors initially
      collector.collectionErrors = 3;
      
      // Successful collection
      await collector.collectMetrics();
      
      expect(collector.collectionErrors).toBe(0);
    });
  });

  describe('Metrics Population', () => {
    test('should set exporter info metric', async () => {
      const metrics = require('../src/metrics');
      
      await collector.collectMetrics();
      
      const registryMetrics = await metrics.register.getMetricsAsJSON();
      const exporterInfo = registryMetrics.find(m => m.name === 'zendesk_exporter_info');
      
      expect(exporterInfo).toBeDefined();
      expect(exporterInfo.values.length).toBeGreaterThan(0);
      
      // Should have version and mode labels
      const value = exporterInfo.values[0];
      expect(value.labels).toHaveProperty('version');
      expect(value.labels).toHaveProperty('mode');
      expect(value.labels.mode).toBe('mock');
    });

    test('should populate all metric categories', async () => {
      const metrics = require('../src/metrics');
      
      await collector.collectMetrics();
      
      const registryMetrics = await metrics.register.getMetricsAsJSON();
      const metricNames = registryMetrics.map(m => m.name);
      
      // All-time metrics
      expect(metricNames).toContain('zendesk_tickets_total');
      expect(metricNames).toContain('zendesk_tickets_created_total');
      
      // Windowed metrics
      expect(metricNames).toContain('zendesk_tickets_created_last_1d');
      expect(metricNames).toContain('zendesk_solved_tickets_last_7d');
      expect(metricNames).toContain('zendesk_first_reply_time_seconds_last_30d');
      
      // Distribution metrics
      expect(metricNames).toContain('zendesk_tickets_by_group');
      expect(metricNames).toContain('zendesk_tickets_by_channel');
      expect(metricNames).toContain('zendesk_tickets_by_priority');
      expect(metricNames).toContain('zendesk_tickets_by_tag');
      
      // Capacity metrics
      expect(metricNames).toContain('zendesk_backlog_age_tickets');
      expect(metricNames).toContain('zendesk_unassigned_tickets_total');
      
      // Operational metrics
    });
  });
});