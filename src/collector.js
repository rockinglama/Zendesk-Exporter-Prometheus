const logger = require('./logger');
const ZendeskClient = require('./zendesk-client');
const MockZendeskClient = require('./mock-client');
const {
  slaAchievementRate,
  firstReplyTime,
  fullResolutionTime,
  ticketsTotal,
  unsolvedTickets,
  ticketsCreated,
  ticketsByGroup,
  exporterInfo,
  // New metrics
  reopenedTicketsTotal,
  reopenedTicketsRate,
  oneTouchResolutionRate,
  repliesPerTicketAvg,
  requesterWaitTimeSeconds,
  backlogAgeTickets,
  ticketsPerAssignee,
  unassignedTicketsTotal,
  assignmentRate,
  ticketsByChannel,
  ticketsByPriority,
  ticketsByTag,
  satisfactionScoreRate,
  satisfactionGoodTotal,
  satisfactionBadTotal,
  slaBreachCount,
  slaBreachRateByPriority,
  suspendedTicketsTotal,
  automationsCount,
  triggersCount,
  macrosCount,
} = require('./metrics');

class MetricsCollector {
  constructor() {
    this.client = null;
    this.isCollecting = false;
    this.lastCollectionTime = null;
    this.collectionErrors = 0;
    this.maxErrors = 5;
    
    this.initializeClient();
    this.setExporterInfo();
  }

  initializeClient() {
    const isMockMode = process.env.ZENDESK_MOCK === 'true';
    
    if (isMockMode) {
      this.client = new MockZendeskClient();
      logger.info('Using mock Zendesk client');
    } else {
      const { 
        ZENDESK_SUBDOMAIN, 
        ZENDESK_EMAIL, 
        ZENDESK_API_TOKEN,
        ZENDESK_OAUTH_TOKEN 
      } = process.env;
      
      if (!ZENDESK_SUBDOMAIN) {
        throw new Error('ZENDESK_SUBDOMAIN is required');
      }
      
      // Check authentication methods
      const hasOAuth = !!ZENDESK_OAUTH_TOKEN;
      const hasApiToken = !!(ZENDESK_EMAIL && ZENDESK_API_TOKEN);
      
      if (!hasOAuth && !hasApiToken) {
        throw new Error('Authentication required: Set either ZENDESK_OAUTH_TOKEN or both ZENDESK_EMAIL and ZENDESK_API_TOKEN');
      }
      
      this.client = new ZendeskClient(
        ZENDESK_SUBDOMAIN, 
        ZENDESK_EMAIL, 
        ZENDESK_API_TOKEN,
        ZENDESK_OAUTH_TOKEN
      );
      
      const authMethod = hasOAuth ? 'OAuth Bearer token' : 'API token';
      logger.info(`Using real Zendesk client with ${authMethod} authentication`);
    }
  }

  setExporterInfo() {
    const pkg = require('../package.json');
    const mode = process.env.ZENDESK_MOCK === 'true' ? 'mock' : 'live';
    exporterInfo.set({ version: pkg.version, mode }, 1);
  }

  async testConnection() {
    try {
      return await this.client.testConnection();
    } catch (error) {
      logger.error('Connection test failed', error);
      return false;
    }
  }

  async collectMetrics() {
    if (this.isCollecting) {
      logger.warn('Collection already in progress, skipping');
      return;
    }

    this.isCollecting = true;
    const startTime = Date.now();
    
    try {
      logger.info('Starting metrics collection');
      
      // Collect all metrics in parallel where possible for better performance
      // Use Promise.allSettled to ensure resilience - partial failures won't stop other metrics
      const [
        ticketCounts,
        unsolvedCount,
        createdCounts,
        slaMetrics,
        replyMetrics,
        groupCounts,
        efficiencyMetrics,
        capacityMetrics,
        channelMetrics,
        slaDetailMetrics,
        operationalMetrics,
      ] = await Promise.allSettled([
        this.client.getTicketCounts(),
        this.client.getUnsolvedTicketCount(),
        this.client.getTicketsCreatedByPeriod(),
        this.client.getSLAMetrics(),
        this.client.getReplyTimeMetrics(),
        this.client.getTicketsByGroup(),
        this.client.getEfficiencyMetrics(),
        this.client.getCapacityMetrics(),
        this.client.getChannelMetrics(),
        this.client.getSLADetailMetrics(),
        this.client.getOperationalMetrics(),
      ]);

      // Update ticket counts by status
      if (ticketCounts.status === 'fulfilled') {
        Object.entries(ticketCounts.value).forEach(([status, count]) => {
          ticketsTotal.set({ status }, count);
        });
        logger.debug('Updated ticket counts by status');
      } else {
        logger.error('Failed to collect ticket counts', ticketCounts.reason);
      }

      // Update unsolved tickets count
      if (unsolvedCount.status === 'fulfilled') {
        unsolvedTickets.set(unsolvedCount.value);
        logger.debug('Updated unsolved tickets count');
      } else {
        logger.error('Failed to collect unsolved tickets count', unsolvedCount.reason);
      }

      // Update tickets created by period
      if (createdCounts.status === 'fulfilled') {
        Object.entries(createdCounts.value).forEach(([period, count]) => {
          ticketsCreated.set({ period }, count);
        });
        logger.debug('Updated tickets created by period');
      } else {
        logger.error('Failed to collect tickets created counts', createdCounts.reason);
      }

      // Update SLA achievement rates
      if (slaMetrics.status === 'fulfilled') {
        Object.entries(slaMetrics.value).forEach(([channel, rate]) => {
          slaAchievementRate.set({ channel }, rate);
        });
        logger.debug('Updated SLA achievement rates');
      } else {
        logger.error('Failed to collect SLA metrics', slaMetrics.reason);
      }

      // Update reply time metrics
      if (replyMetrics.status === 'fulfilled') {
        const { firstReplyTime: frt, fullResolutionTime: rrt } = replyMetrics.value;
        firstReplyTime.set(frt);
        fullResolutionTime.set(rrt);
        logger.debug('Updated reply time metrics');
      } else {
        logger.error('Failed to collect reply time metrics', replyMetrics.reason);
      }

      // Update tickets by group
      if (groupCounts.status === 'fulfilled') {
        // Clear existing group metrics
        ticketsByGroup.reset();
        
        Object.entries(groupCounts.value).forEach(([group, count]) => {
          ticketsByGroup.set({ group }, count);
        });
        logger.debug('Updated tickets by group');
      } else {
        logger.error('Failed to collect tickets by group', groupCounts.reason);
      }

      // === UPDATE NEW METRICS ===

      // Update efficiency metrics
      if (efficiencyMetrics.status === 'fulfilled') {
        const {
          reopenedTotal,
          reopenedRate,
          oneTouchRate,
          avgReplies,
          avgRequesterWait,
        } = efficiencyMetrics.value;

        reopenedTicketsTotal.set(reopenedTotal);
        reopenedTicketsRate.set(reopenedRate);
        oneTouchResolutionRate.set(oneTouchRate);
        repliesPerTicketAvg.set(avgReplies);
        requesterWaitTimeSeconds.set(avgRequesterWait);
        
        logger.debug('Updated efficiency metrics');
      } else {
        logger.error('Failed to collect efficiency metrics', efficiencyMetrics.reason);
      }

      // Update capacity metrics  
      if (capacityMetrics.status === 'fulfilled') {
        const {
          backlogAge,
          ticketsPerAssignee: assigneeTickets,
          unassignedTotal,
          assignmentRate: assignedRate,
        } = capacityMetrics.value;

        // Clear existing backlog age and assignee metrics
        backlogAgeTickets.reset();
        ticketsPerAssignee.reset();

        Object.entries(backlogAge).forEach(([bucket, count]) => {
          backlogAgeTickets.set({ bucket }, count);
        });

        Object.entries(assigneeTickets).forEach(([assignee_id, count]) => {
          // GDPR compliance: use only numeric IDs, never names
          ticketsPerAssignee.set({ assignee_id }, count);
        });

        unassignedTicketsTotal.set(unassignedTotal);
        assignmentRate.set(assignedRate);
        
        logger.debug('Updated capacity metrics');
      } else {
        logger.error('Failed to collect capacity metrics', capacityMetrics.reason);
      }

      // Update channel metrics
      if (channelMetrics.status === 'fulfilled') {
        const {
          ticketsByChannel: channelCounts,
          ticketsByPriority: priorityCounts,
          ticketsByTag: tagCounts,
          satisfactionScoreRate: csatRate,
          satisfactionGoodTotal: goodTotal,
          satisfactionBadTotal: badTotal,
        } = channelMetrics.value;

        // Clear existing channel, priority, and tag metrics
        ticketsByChannel.reset();
        ticketsByPriority.reset();
        ticketsByTag.reset();

        Object.entries(channelCounts).forEach(([channel, count]) => {
          ticketsByChannel.set({ channel }, count);
        });

        Object.entries(priorityCounts).forEach(([priority, count]) => {
          ticketsByPriority.set({ priority }, count);
        });

        Object.entries(tagCounts).forEach(([tag, count]) => {
          ticketsByTag.set({ tag }, count);
        });

        satisfactionScoreRate.set(csatRate);
        satisfactionGoodTotal.set(goodTotal);
        satisfactionBadTotal.set(badTotal);
        
        logger.debug('Updated channel metrics');
      } else {
        logger.error('Failed to collect channel metrics', channelMetrics.reason);
      }

      // Update SLA detail metrics
      if (slaDetailMetrics.status === 'fulfilled') {
        const {
          breachCount,
          breachRateByPriority: breachRates,
        } = slaDetailMetrics.value;

        // Clear existing SLA metrics
        slaBreachCount.reset();
        slaBreachRateByPriority.reset();

        Object.entries(breachCount).forEach(([metric, count]) => {
          slaBreachCount.set({ metric }, count);
        });

        Object.entries(breachRates).forEach(([priority, rate]) => {
          slaBreachRateByPriority.set({ priority }, rate);
        });
        
        logger.debug('Updated SLA detail metrics');
      } else {
        logger.error('Failed to collect SLA detail metrics', slaDetailMetrics.reason);
      }

      // Update operational metrics
      if (operationalMetrics.status === 'fulfilled') {
        const {
          suspendedTicketsTotal: suspendedTotal,
          automationsCount: automationCount,
          triggersCount: triggerCount,
          macrosCount: macroCount,
        } = operationalMetrics.value;

        suspendedTicketsTotal.set(suspendedTotal);
        automationsCount.set(automationCount);
        triggersCount.set(triggerCount);
        macrosCount.set(macroCount);
        
        logger.debug('Updated operational metrics');
      } else {
        logger.error('Failed to collect operational metrics', operationalMetrics.reason);
      }

      this.collectionErrors = 0; // Reset error counter on success
      this.lastCollectionTime = new Date();
      
      const duration = Date.now() - startTime;
      logger.info(`Metrics collection completed in ${duration}ms`);
      
    } catch (error) {
      this.collectionErrors++;
      logger.error(`Metrics collection failed (error ${this.collectionErrors}/${this.maxErrors})`, error);
      
      if (this.collectionErrors >= this.maxErrors) {
        logger.error('Max collection errors reached, stopping collection');
        // Could implement exponential backoff here
      }
    } finally {
      this.isCollecting = false;
    }
  }

  getStatus() {
    return {
      isCollecting: this.isCollecting,
      lastCollectionTime: this.lastCollectionTime,
      collectionErrors: this.collectionErrors,
      mode: process.env.ZENDESK_MOCK === 'true' ? 'mock' : 'live',
    };
  }
}

module.exports = MetricsCollector;