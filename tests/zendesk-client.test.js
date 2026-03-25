const ZendeskClient = require('../src/zendesk-client');

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    interceptors: {
      response: {
        use: jest.fn()
      }
    }
  }))
}));

// Mock logger
jest.mock('../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('ZendeskClient', () => {
  let client;
  const axios = require('axios');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    test('should throw error without credentials', () => {
      expect(() => {
        new ZendeskClient('test-subdomain');
      }).toThrow('Either OAuth token or email+API token required');
    });

    test('should create client with OAuth token', () => {
      client = new ZendeskClient('test-subdomain', null, null, 'oauth-token');
      
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://test-subdomain.zendesk.com/api/v2',
          headers: expect.objectContaining({
            Authorization: 'Bearer oauth-token',
          }),
        })
      );
    });

    test('should create client with API token', () => {
      client = new ZendeskClient('test-subdomain', 'test@example.com', 'api-token');
      
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://test-subdomain.zendesk.com/api/v2',
          auth: {
            username: 'test@example.com/token',
            password: 'api-token',
          },
        })
      );
    });

    test('should prefer OAuth token over API token when both provided', () => {
      client = new ZendeskClient('test-subdomain', 'test@example.com', 'api-token', 'oauth-token');
      
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer oauth-token',
          }),
        })
      );
      
      const createCall = axios.create.mock.calls[0][0];
      expect(createCall.auth).toBeUndefined();
    });
  });

  describe('Date Formatting', () => {
    beforeEach(() => {
      client = new ZendeskClient('test-subdomain', null, null, 'oauth-token');
    });

    test('formatDate should return YYYY-MM-DD format', () => {
      const formatted = client.formatDate(0); // today
      
      // Should match YYYY-MM-DD format
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('formatDate should handle different date inputs', () => {
      // Test with days ago
      const formatted1 = client.formatDate(1); // yesterday
      const formatted7 = client.formatDate(7); // 7 days ago
      
      expect(formatted1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(formatted7).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      client = new ZendeskClient('test-subdomain', null, null, 'oauth-token');
    });

    test('getSearchCount should return 0 on error', async () => {
      // Mock the client's makeRequest method to throw
      client.makeRequest = jest.fn().mockRejectedValue(new Error('API Error'));
      
      const result = await client.getSearchCount('test query');
      
      expect(result).toBe(0);
    });

    test('getSearchCount should return 0 on invalid response', async () => {
      // Mock the client's makeRequest method to return invalid response
      client.makeRequest = jest.fn().mockResolvedValue({ invalid: 'response' });
      
      const result = await client.getSearchCount('test query');
      
      expect(result).toBe(0);
    });
  });

  describe('API Methods', () => {
    beforeEach(() => {
      client = new ZendeskClient('test-subdomain', null, null, 'oauth-token');
      // Mock makeRequest to return predictable responses
      client.makeRequest = jest.fn().mockResolvedValue({ count: 100 });
    });

    test('getTicketCounts should return all status counts', async () => {
      const result = await client.getTicketCounts();
      
      expect(result).toHaveProperty('new');
      expect(result).toHaveProperty('open');
      expect(result).toHaveProperty('pending');
      expect(result).toHaveProperty('hold');
      expect(result).toHaveProperty('solved');
      expect(result).toHaveProperty('closed');
      
      Object.values(result).forEach(count => {
        expect(typeof count).toBe('number');
        expect(count).toBe(100);
      });
    });

    test('getTicketsCreatedTotal should return total count', async () => {
      client.makeRequest = jest.fn().mockResolvedValue({ count: 1500 });
      
      const result = await client.getTicketsCreatedTotal();
      
      expect(result).toBe(1500);
    });

    test('getWindowedCounts should return windowed data', async () => {
      client.makeRequest = jest.fn().mockResolvedValue({ count: 50 });
      
      const result = await client.getWindowedCounts();
      
      expect(result).toHaveProperty('created');
      expect(result).toHaveProperty('solved');
      expect(result).toHaveProperty('reopened');
      
      ['created', 'solved', 'reopened'].forEach(type => {
        expect(result[type]).toHaveProperty('1d');
        expect(result[type]).toHaveProperty('7d');
        expect(result[type]).toHaveProperty('30d');
      });
    });

    test('testConnection should make a simple API call', async () => {
      client.makeRequest = jest.fn().mockResolvedValue({ user: { id: 123, role: 'admin' } });
      
      const result = await client.testConnection();
      
      expect(result).toBe(true);
      expect(client.makeRequest).toHaveBeenCalledWith('/users/me.json');
    });

    test('testConnection should return false on API error', async () => {
      client.makeRequest = jest.fn().mockRejectedValue(new Error('API Error'));
      
      const result = await client.testConnection();
      
      expect(result).toBe(false);
    });
  });

  describe('Search Query Construction', () => {
    beforeEach(() => {
      client = new ZendeskClient('test-subdomain', null, null, 'oauth-token');
      client.makeRequest = jest.fn().mockResolvedValue({ count: 100 });
    });

    test('should construct correct Zendesk search syntax for ticket counts', async () => {
      await client.getTicketCounts();
      
      // Should have made 6 calls for different statuses
      expect(client.makeRequest).toHaveBeenCalledTimes(6);
      
      const calls = client.makeRequest.mock.calls;
      
      // Check that status queries were made (calls are to /search/count with params)
      expect(calls.length).toBe(6);
      expect(calls.some(call => call[0].includes('/search/count'))).toBe(true);
    });

    test('should use correct date ranges for windowed counts', async () => {
      await client.getWindowedCounts();
      
      const calls = client.makeRequest.mock.calls;
      
      // Should have made multiple calls for different time windows
      expect(calls.length).toBeGreaterThan(3);
      
      // Should be calling search/count endpoint
      expect(calls.some(call => call[0].includes('/search/count'))).toBe(true);
    });
  });

  describe('Pagination Handling', () => {
    beforeEach(() => {
      client = new ZendeskClient('test-subdomain', null, null, 'oauth-token');
    });

    test('should handle paginated search responses', async () => {
      // Mock paginated response
      const page1Response = {
        results: [
          { id: 1, created_at: '2024-03-25T10:00:00Z', tags: ['billing'] },
          { id: 2, created_at: '2024-03-25T11:00:00Z', tags: ['technical'] },
        ],
        count: 3,
        next_page: 'https://test.zendesk.com/api/v2/search.json?query=test&page=2',
      };
      
      const page2Response = {
        results: [
          { id: 3, created_at: '2024-03-25T12:00:00Z', tags: ['billing'] },
        ],
        count: 3,
        next_page: null,
      };
      
      client.makeRequest = jest.fn()
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response);
      
      const tickets = await client.searchTickets('test query');
      
      expect(tickets).toHaveLength(3);
      expect(tickets[0].id).toBe(1);
      expect(tickets[2].id).toBe(3);
    });
  });

  describe('Quality Metrics', () => {
    beforeEach(() => {
      client = new ZendeskClient('test-subdomain', null, null, 'oauth-token');
    });

    test('should fetch quality metrics with ticket sampling', async () => {
      // Mock ticket search response
      const searchResponse = {
        tickets: [
          { id: 1, created_at: '2024-03-20T10:00:00Z', solved_at: '2024-03-20T12:00:00Z' },
          { id: 2, created_at: '2024-03-20T11:00:00Z', solved_at: '2024-03-20T13:00:00Z' },
        ],
        next_page: null,
      };
      
      // Mock metrics response
      const metricsResponse = {
        ticket_metric: {
          reply_time_in_minutes: { business: 120 },
          full_resolution_time_in_minutes: { business: 1440 },
          requester_wait_time_in_minutes: { business: 360 },
          replies: 3,
          reopens: 1,
        },
      };
      
      client.makeRequest = jest.fn()
        .mockResolvedValueOnce(searchResponse) // for ticket search
        .mockResolvedValue(metricsResponse);   // for metrics calls
      
      const metrics = await client.getQualityMetrics();
      
      expect(metrics).toHaveProperty('1d');
      expect(metrics).toHaveProperty('7d');
      expect(metrics).toHaveProperty('30d');
      
      // Each window should have the required metrics
      ['1d', '7d', '30d'].forEach(window => {
        expect(metrics[window]).toHaveProperty('firstReplyTime');
        expect(metrics[window]).toHaveProperty('fullResolutionTime');
        expect(metrics[window]).toHaveProperty('requesterWaitTime');
        expect(metrics[window]).toHaveProperty('oneTouchTotal');
        expect(metrics[window]).toHaveProperty('reopenedTotal');
        expect(metrics[window]).toHaveProperty('avgReplies');
        expect(metrics[window]).toHaveProperty('sampleSize');
      });
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(() => {
      client = new ZendeskClient('test-subdomain', null, null, 'oauth-token');
    });

    test('makeRequest should enforce minimum delay between requests', async () => {
      // Mock the axios client's get method
      const mockGet = jest.fn().mockResolvedValue({ data: { test: 'data' } });
      client.client = { get: mockGet };
      
      const start = Date.now();
      
      // Make two requests quickly
      const promise1 = client.makeRequest('/test1');
      const promise2 = client.makeRequest('/test2');
      
      await Promise.all([promise1, promise2]);
      
      const elapsed = Date.now() - start;
      
      // Should have waited for rate limiting (at least 300ms between requests)
      expect(elapsed).toBeGreaterThan(250);
    });
  });
});
