const client = require('prom-client');

describe('Metrics Module', () => {
  let metrics;
  
  beforeEach(() => {
    // Clear registry first, then require metrics
    client.register.clear();
    // Delete from require cache to get fresh instance
    delete require.cache[require.resolve('../src/metrics')];
    metrics = require('../src/metrics');
  });

  describe('Metric Registry', () => {
    test('should have a custom registry instance', () => {
      expect(metrics.register).toBeInstanceOf(client.Registry);
    });

    test('should register all metrics in the registry', async () => {
      const registryMetrics = await metrics.register.getMetricsAsJSON();
      const metricNames = registryMetrics.map(m => m.name);
      
      // Should include default metrics (with prefix)
      expect(metricNames.some(name => name.startsWith('zendesk_exporter_'))).toBe(true);
      
      // Should include our custom metrics
      expect(metricNames).toContain('zendesk_tickets_total');
      expect(metricNames).toContain('zendesk_tickets_total_new');
      expect(metricNames).toContain('zendesk_tickets_created_total');
      expect(metricNames).toContain('zendesk_solved_tickets_last_1d');
      expect(metricNames).toContain('zendesk_first_reply_time_seconds_last_7d');
      expect(metricNames).toContain('zendesk_tickets_by_channel');
      expect(metricNames).toContain('zendesk_backlog_age_tickets');
      expect(metricNames).toContain('zendesk_suspended_tickets_total');
      expect(metricNames).toContain('zendesk_exporter_info');
    });

    test('should not have duplicate metric names', async () => {
      const registryMetrics = await metrics.register.getMetricsAsJSON();
      const metricNames = registryMetrics.map(m => m.name);
      const uniqueNames = [...new Set(metricNames)];
      
      expect(metricNames.length).toBe(uniqueNames.length);
    });
  });

  describe('Windowed Gauges', () => {
    test('should create windowed gauges for all time windows', () => {
      const windows = ['1d', '7d', '30d'];
      
      // Test created tickets
      windows.forEach(window => {
        expect(metrics.ticketsCreated[window]).toBeInstanceOf(client.Gauge);
        expect(metrics.ticketsCreated[window].name).toBe(`zendesk_tickets_created_last_${window}`);
      });
      
      // Test solved tickets
      windows.forEach(window => {
        expect(metrics.solvedTickets[window]).toBeInstanceOf(client.Gauge);
        expect(metrics.solvedTickets[window].name).toBe(`zendesk_solved_tickets_last_${window}`);
      });
      
      // Test reopened tickets
      windows.forEach(window => {
        expect(metrics.reopenedTickets[window]).toBeInstanceOf(client.Gauge);
        expect(metrics.reopenedTickets[window].name).toBe(`zendesk_reopened_tickets_last_${window}`);
      });
      
      // Test quality metrics
      windows.forEach(window => {
        expect(metrics.firstReplyTime[window]).toBeInstanceOf(client.Gauge);
        expect(metrics.fullResolutionTime[window]).toBeInstanceOf(client.Gauge);
        expect(metrics.requesterWaitTime[window]).toBeInstanceOf(client.Gauge);
        expect(metrics.oneTouchTickets[window]).toBeInstanceOf(client.Gauge);
        expect(metrics.repliesPerTicketAvg[window]).toBeInstanceOf(client.Gauge);
      });
    });
  });

  describe('Individual Status Gauges', () => {
    test('should create gauges for all ticket statuses', () => {
      const statuses = ['new', 'open', 'pending', 'hold', 'solved', 'closed'];
      
      statuses.forEach(status => {
        expect(metrics.ticketsByStatus[status]).toBeInstanceOf(client.Gauge);
        expect(metrics.ticketsByStatus[status].name).toBe(`zendesk_tickets_total_${status}`);
      });
    });
  });

  describe('Metric Naming Conventions', () => {
    test('windowed metrics should follow naming convention', async () => {
      const registryMetrics = await metrics.register.getMetricsAsJSON();
      const windowedMetrics = registryMetrics.filter(m => 
        m.name.includes('_last_1d') || 
        m.name.includes('_last_7d') || 
        m.name.includes('_last_30d')
      );
      
      // Should have windowed metrics
      expect(windowedMetrics.length).toBeGreaterThan(0);
      
      // Each windowed metric should follow the pattern
      windowedMetrics.forEach(metric => {
        expect(metric.name).toMatch(/_last_(1d|7d|30d)$/);
      });
    });

    test('total metrics should use _total suffix or no suffix', async () => {
      const registryMetrics = await metrics.register.getMetricsAsJSON();
      const totalMetrics = registryMetrics.filter(m => 
        m.name.startsWith('zendesk_') && 
        !m.name.startsWith('zendesk_exporter_') &&
        !m.name.includes('_last_')
      );
      
      totalMetrics.forEach(metric => {
        // Should either end with _total or be a distribution metric
        const isTotal = metric.name.endsWith('_total');
        const isDistribution = metric.name.includes('_by_') || metric.name === 'zendesk_tickets_total';
        const isInfo = metric.name.endsWith('_info');
        const isSampleSize = metric.name.endsWith('_size');
        const isAvg = metric.name.includes('_avg');
        const isTime = metric.name.includes('_time_') || metric.name.includes('_seconds');
        const isTickets = metric.name.includes('_tickets') && !metric.name.includes('_by_');
        
        expect(isTotal || isDistribution || isInfo || isSampleSize || isAvg || isTime || isTickets).toBe(true);
      });
    });
  });

  describe('Metric Types', () => {
    test('all metrics should be gauges', () => {
      expect(metrics.ticketsTotal).toBeInstanceOf(client.Gauge);
      expect(metrics.ticketsCreatedTotal).toBeInstanceOf(client.Gauge);
      expect(metrics.ticketsByChannel).toBeInstanceOf(client.Gauge);
      expect(metrics.backlogAgeTickets).toBeInstanceOf(client.Gauge);
      expect(metrics.suspendedTicketsTotal).toBeInstanceOf(client.Gauge);
      expect(metrics.exporterInfo).toBeInstanceOf(client.Gauge);
    });
  });

  describe('Label Names', () => {
    test('distribution metrics should have appropriate labels', () => {
      expect(metrics.ticketsTotal.labelNames).toEqual(['status']);
      expect(metrics.ticketsByChannel.labelNames).toEqual(['channel']);
      expect(metrics.ticketsByPriority.labelNames).toEqual(['priority']);
      expect(metrics.ticketsByTag.labelNames).toEqual(['tag']);
      expect(metrics.ticketsByGroup.labelNames).toEqual(['group']);
      expect(metrics.backlogAgeTickets.labelNames).toEqual(['bucket']);
      expect(metrics.sampleSize.labelNames).toEqual(['window']);
      expect(metrics.exporterInfo.labelNames).toEqual(['version', 'mode']);
    });
  });
});