const express = require('express');
const logger = require('./logger');
const { register } = require('./metrics');
const MetricsCollector = require('./collector');

const app = express();
const port = process.env.PORT || 3000;
const scrapeInterval = parseInt(process.env.SCRAPE_INTERVAL_SECONDS || '60', 10) * 1000;

// Initialize metrics collector
const collector = new MetricsCollector();

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const connectionOk = await collector.testConnection();
    const status = collector.getStatus();
    
    const health = {
      status: connectionOk ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      ...status,
    };
    
    res.status(connectionOk ? 200 : 503).json(health);
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    // Force a collection if metrics are stale (older than 2x scrape interval)
    const status = collector.getStatus();
    const isStale = !status.lastCollectionTime || 
      (Date.now() - status.lastCollectionTime.getTime()) > (scrapeInterval * 2);
    
    if (isStale && !status.isCollecting) {
      logger.info('Metrics are stale, triggering collection');
      // Don't await - let it run in background and return current metrics
      collector.collectMetrics().catch(error => {
        logger.error('Background metrics collection failed', error);
      });
    }
    
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    logger.error('Failed to generate metrics', error);
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});

// Root endpoint with basic info
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
      port: port,
      scrapeInterval: `${scrapeInterval / 1000}s`,
      mode: process.env.ZENDESK_MOCK === 'true' ? 'mock' : 'live',
    },
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Express error handler', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
async function start() {
  try {
    // Test connection on startup
    logger.info('Testing Zendesk connection...');
    const connectionOk = await collector.testConnection();
    
    if (!connectionOk && process.env.ZENDESK_MOCK !== 'true') {
      logger.warn('Zendesk connection failed, but continuing startup');
    }
    
    // Do initial metrics collection
    logger.info('Performing initial metrics collection...');
    await collector.collectMetrics();
    
    // Start the HTTP server
    app.listen(port, () => {
      logger.info(`Zendesk Prometheus Exporter listening on port ${port}`);
      logger.info(`Metrics available at http://localhost:${port}/metrics`);
      logger.info(`Health check at http://localhost:${port}/health`);
      logger.info(`Scrape interval: ${scrapeInterval / 1000} seconds`);
    });
    
    // Set up periodic metrics collection
    setInterval(async () => {
      try {
        await collector.collectMetrics();
      } catch (error) {
        logger.error('Scheduled metrics collection failed', error);
      }
    }, scrapeInterval);
    
    logger.info('Zendesk Prometheus Exporter started successfully');
    
  } catch (error) {
    logger.error('Failed to start exporter', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  process.exit(1);
});

// Start the application
start();