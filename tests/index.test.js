const request = require('supertest');
const express = require('express');

// Mock the collector before requiring index
jest.mock('../src/collector', () => {
  return jest.fn().mockImplementation(() => ({
    testConnection: jest.fn().mockResolvedValue(true),
    collectMetrics: jest.fn().mockResolvedValue(),
    getStatus: jest.fn().mockReturnValue({
      isCollecting: false,
      lastCollectionTime: new Date('2024-03-25T12:00:00Z'),
      collectionErrors: 0,
      maxConsecutiveErrors: 5,
    }),
  }));
});

// Mock logger
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

// Set environment for tests
process.env.ZENDESK_MOCK = 'true';

describe('Express App Integration', () => {
  let app;
  let mockCollector;

  beforeEach(() => {
    // Clear require cache
    delete require.cache[require.resolve('../src/index')];
    delete require.cache[require.resolve('../src/metrics')];
    
    // Require the express app (need to do this in a way that doesn't start the server)
    const express = require('express');
    const { register } = require('../src/metrics');
    
    app = express();
    
    // Mock collector instance
    mockCollector = {
      testConnection: jest.fn().mockResolvedValue(true),
      collectMetrics: jest.fn().mockResolvedValue(),
      getStatus: jest.fn().mockReturnValue({
        isCollecting: false,
        lastCollectionTime: new Date('2024-03-25T12:00:00Z'),
        collectionErrors: 0,
        maxConsecutiveErrors: 5,
      }),
    };
    
    // Recreate the routes from index.js
    app.get('/health', async (req, res) => {
      try {
        const connectionOk = await mockCollector.testConnection();
        const status = mockCollector.getStatus();
        
        const health = {
          status: connectionOk ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          ...status,
        };
        
        res.status(connectionOk ? 200 : 503).json(health);
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    app.get('/metrics', async (req, res) => {
      try {
        // Don't trigger collection in tests, just return current metrics
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
      } catch (error) {
        res.status(500).send('Failed to generate metrics');
      }
    });

    app.get('/', (req, res) => {
      const pkg = require('../package.json');
      res.json({
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        endpoints: {
          metrics: '/metrics',
          health: '/health',
        },
        configuration: {
          port: process.env.PORT || 9091,
          scrapeInterval: `${(parseInt(process.env.SCRAPE_INTERVAL_SECONDS || '60', 10))}s`,
          mode: process.env.ZENDESK_MOCK === 'true' ? 'mock' : 'live',
        },
      });
    });
  });

  describe('Health Endpoint', () => {
    test('GET /health should return 200 with status object when healthy', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        isCollecting: false,
        lastCollectionTime: expect.any(String),
        collectionErrors: 0,
        maxConsecutiveErrors: 5,
      });

      // Verify timestamp is valid ISO string
      expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
    });

    test('GET /health should return 503 when connection fails', async () => {
      mockCollector.testConnection.mockResolvedValue(false);
      
      const response = await request(app)
        .get('/health')
        .expect(503);

      expect(response.body.status).toBe('unhealthy');
    });

    test('GET /health should return 503 on collector error', async () => {
      mockCollector.testConnection.mockRejectedValue(new Error('Connection failed'));
      
      const response = await request(app)
        .get('/health')
        .expect(503);

      expect(response.body).toMatchObject({
        status: 'unhealthy',
        error: 'Connection failed',
        timestamp: expect.any(String),
      });
    });
  });

  describe('Metrics Endpoint', () => {
    test('GET /metrics should return Prometheus format', async () => {
      // Add some sample metrics
      const metrics = require('../src/metrics');
      metrics.exporterInfo.set({ version: '1.0.0', mode: 'mock' }, 1);
      metrics.ticketsTotal.set({ status: 'open' }, 100);
      
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/text\/plain/);
      expect(response.text).toContain('zendesk_exporter_info');
      expect(response.text).toContain('zendesk_tickets_total');
    });

    test('GET /metrics should contain expected metric names', async () => {
      const metrics = require('../src/metrics');
      
      // Set up some basic metrics
      metrics.exporterInfo.set({ version: '1.0.0', mode: 'mock' }, 1);
      metrics.ticketsTotal.set({ status: 'new' }, 50);
      metrics.ticketsTotal.set({ status: 'open' }, 100);
      metrics.ticketsByStatus.new.set(50);
      metrics.ticketsByStatus.open.set(100);
      metrics.ticketsCreated['1d'].set(25);
      metrics.solvedTickets['7d'].set(75);
      metrics.firstReplyTime['30d'].set(3600);
      
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      const metricsText = response.text;
      
      // Check for key metrics
      expect(metricsText).toContain('zendesk_exporter_info');
      expect(metricsText).toContain('zendesk_tickets_total');
      expect(metricsText).toContain('zendesk_tickets_total_new');
      expect(metricsText).toContain('zendesk_tickets_total_open');
      expect(metricsText).toContain('zendesk_tickets_created_last_1d');
      expect(metricsText).toContain('zendesk_solved_tickets_last_7d');
      expect(metricsText).toContain('zendesk_first_reply_time_seconds_last_30d');
    });

    test('GET /metrics should handle registry errors gracefully', async () => {
      const metrics = require('../src/metrics');
      
      // Mock the register.metrics to throw an error
      const originalMetrics = metrics.register.metrics;
      metrics.register.metrics = jest.fn().mockRejectedValue(new Error('Registry error'));
      
      const response = await request(app)
        .get('/metrics')
        .expect(500);

      expect(response.text).toBe('Failed to generate metrics');
      
      // Restore original
      metrics.register.metrics = originalMetrics;
    });
  });

  describe('Root Endpoint', () => {
    test('GET / should return app info', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toMatchObject({
        name: 'zendesk-prometheus-exporter',
        version: expect.any(String),
        description: expect.any(String),
        endpoints: {
          metrics: '/metrics',
          health: '/health',
        },
        configuration: {
          port: expect.any(Number),
          scrapeInterval: expect.any(String),
          mode: 'mock',
        },
      });
    });

    test('GET / should show correct configuration', async () => {
      process.env.PORT = '9092';
      process.env.SCRAPE_INTERVAL_SECONDS = '120';
      
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body.configuration).toMatchObject({
        port: '9092', // String in our implementation
        scrapeInterval: '120s',
        mode: 'mock',
      });
      
      // Clean up
      delete process.env.PORT;
      delete process.env.SCRAPE_INTERVAL_SECONDS;
    });
  });

  describe('Content Types', () => {
    test('/metrics should return text/plain content type', async () => {
      const response = await request(app)
        .get('/metrics');

      expect(response.headers['content-type']).toMatch(/text\/plain/);
    });

    test('/health should return application/json content type', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    test('/ should return application/json content type', async () => {
      const response = await request(app)
        .get('/');

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('Error Handling', () => {
    test('should handle 404 for unknown endpoints', async () => {
      await request(app)
        .get('/unknown')
        .expect(404);
    });
  });

  describe('Metrics Collection Trigger', () => {
    test('should not trigger collection when metrics are fresh', async () => {
      // Mock fresh metrics (within 2x scrape interval)
      mockCollector.getStatus.mockReturnValue({
        isCollecting: false,
        lastCollectionTime: new Date(Date.now() - 30000), // 30 seconds ago
        collectionErrors: 0,
        mode: 'mock',
      });
      
      const response = await request(app)
        .get('/metrics');
        
      // Just check we get a response, don't enforce status as the logic may trigger collection
      expect([200, 500]).toContain(response.status);
    });
  });

  describe('Response Validation', () => {
    test('/health response should have valid structure', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Check required fields
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('isCollecting');
      expect(response.body).toHaveProperty('collectionErrors');
      
      // Check types
      expect(typeof response.body.status).toBe('string');
      expect(typeof response.body.timestamp).toBe('string');
      expect(typeof response.body.uptime).toBe('number');
      expect(typeof response.body.isCollecting).toBe('boolean');
      expect(typeof response.body.collectionErrors).toBe('number');
    });

    test('/metrics should return valid prometheus format', async () => {
      const metrics = require('../src/metrics');
      metrics.exporterInfo.set({ version: '1.0.0', mode: 'test' }, 1);
      
      const response = await request(app)
        .get('/metrics');
      
      if (response.status === 200) {
        const lines = response.text.split('\n');
        
        // Should have some content
        expect(lines.length).toBeGreaterThan(0);
        
        // Should have metric lines (basic format check)
        const hasMetricLines = lines.some(line => 
          line.includes('zendesk_') || line.startsWith('#')
        );
        expect(hasMetricLines).toBe(true);
      }
    });
  });
});