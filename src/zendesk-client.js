const axios = require('axios');
const logger = require('./logger');

/**
 * @constant {number} MAX_SAMPLES - Max results per aggregation query
 */
const MAX_SAMPLES = 100;

/**
 * @constant {string[]} PRIORITY_LEVELS - Zendesk ticket priority values
 */
const PRIORITY_LEVELS = ['low', 'normal', 'high', 'urgent'];

/**
 * Zendesk REST API v2 client.
 * Read-only — only GET requests, no writes.
 * Supports API token (Basic Auth) and OAuth Bearer token.
 *
 * @class ZendeskClient
 */
class ZendeskClient {
  /**
   * @param {string} subdomain - Zendesk subdomain (e.g. "mycompany")
   * @param {string} [email] - Agent email for API token auth
   * @param {string} [apiToken] - Personal API token
   * @param {string} [oauthToken] - OAuth Bearer token (takes precedence)
   */
  constructor(subdomain, email, apiToken, oauthToken) {
    this.baseUrl = `https://${subdomain}.zendesk.com/api/v2`;
    this.lastRequest = 0;

    const config = {
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    };

    if (oauthToken) {
      config.headers.Authorization = `Bearer ${oauthToken}`;
      logger.info(`ZendeskClient: OAuth auth for ${subdomain}.zendesk.com`);
    } else if (email && apiToken) {
      config.auth = { username: `${email}/token`, password: apiToken };
      logger.info(`ZendeskClient: API token auth for ${subdomain}.zendesk.com`);
    } else {
      throw new Error('Either OAuth token or email+API token required');
    }

    this.client = axios.create(config);

    // Auto-retry on 429 rate limit
    this.client.interceptors.response.use(null, async (error) => {
      if (error.response?.status === 429) {
        const wait = parseInt(error.response.headers['retry-after'] || '60', 10);
        logger.warn(`Rate limited, retrying after ${wait}s`);
        await this.sleep(wait * 1000);
        return this.client.request(error.config);
      }
      throw error;
    });
  }

  /** @private */
  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Rate-limited GET request.
   * @param {string} path - API path (e.g. '/search/count.json')
   * @param {Object} [params] - Query parameters
   * @returns {Promise<Object>} Response data
   */
  async makeRequest(path, params = {}) {
    // ~200 req/min max
    const elapsed = Date.now() - this.lastRequest;
    if (elapsed < 300) await this.sleep(300 - elapsed);
    this.lastRequest = Date.now();

    try {
      const { data } = await this.client.get(path, { params });
      return data;
    } catch (error) {
      logger.error(`API request failed: ${path}`, error.message);
      throw error;
    }
  }

  /**
   * Helper: search count query with error handling.
   * @param {string} query - Zendesk search query
   * @param {string} [label] - Label for log messages
   * @returns {Promise<number>}
   */
  async getSearchCount(query, label = 'search') {
    try {
      const data = await this.makeRequest('/search/count.json', { query });
      return data.count || 0;
    } catch (error) {
      logger.warn(`Failed to get ${label}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Format date for Zendesk search queries.
   * @param {number} daysAgo
   * @returns {string} YYYY-MM-DD
   */
  formatDate(daysAgo = 0) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
  }

  // -----------------------------------------------------------------------
  // Ticket counts
  // -----------------------------------------------------------------------

  /** Current ticket count per status */
  async getTicketCounts() {
    const statuses = ['new', 'open', 'pending', 'hold', 'solved', 'closed'];
    const results = {};
    for (const s of statuses) {
      results[s] = await this.getSearchCount(`type:ticket status:${s}`, `status:${s}`);
    }
    return results;
  }

  /** Unsolved tickets (everything except solved + closed) */
  async getUnsolvedTicketCount() {
    return this.getSearchCount('type:ticket -status:solved -status:closed', 'unsolved');
  }

  /** Cumulative total of all tickets ever created */
  async getTicketsCreatedTotal() {
    return this.getSearchCount('type:ticket', 'tickets created total');
  }

  /** Tickets solved in the last 30 days */
  async getSolvedTicketsTotal() {
    const since = this.formatDate(30);
    return this.getSearchCount(
      `type:ticket status:solved solved>${since}`,
      'solved tickets (30d)'
    );
  }

  // -----------------------------------------------------------------------
  // Distribution
  // -----------------------------------------------------------------------

  /** Ticket count per support group */
  async getTicketsByGroup() {
    try {
      const { groups } = await this.makeRequest('/groups.json');
      const results = {};
      if (!groups) return results;

      for (const g of groups) {
        results[g.name] = await this.getSearchCount(
          `type:ticket group_id:${g.id}`,
          `group ${g.name}`
        );
      }
      return results;
    } catch (error) {
      logger.error('Failed to get tickets by group', error);
      throw error;
    }
  }

  /**
   * Channel, priority, and tag distribution.
   * Channels come from ticket via.channel (no search filter exists for this).
   */
  async getChannelMetrics() {
    const results = {
      ticketsByChannel: {},
      ticketsByPriority: {},
      ticketsByTag: {},
    };

    // Channels — fetch tickets and group by via.channel
    try {
      const { results: tickets } = await this.makeRequest('/search.json', {
        query: `type:ticket created>${this.formatDate(30)}`,
        per_page: MAX_SAMPLES,
      });

      if (Array.isArray(tickets)) {
        tickets.forEach((t) => {
          const ch = t.via?.channel || 'unknown';
          results.ticketsByChannel[ch] = (results.ticketsByChannel[ch] || 0) + 1;
        });
      }
    } catch (error) {
      logger.warn('Failed to get tickets by channel', error.message);
    }

    // Priority — search API supports this natively
    for (const p of PRIORITY_LEVELS) {
      results.ticketsByPriority[p] = await this.getSearchCount(
        `type:ticket priority:${p}`,
        `priority:${p}`
      );
    }

    // Tags — fetch tickets and count tag occurrences
    try {
      const { results: tickets } = await this.makeRequest('/search.json', {
        query: `type:ticket created>${this.formatDate(30)}`,
        per_page: MAX_SAMPLES,
      });

      if (Array.isArray(tickets)) {
        const tagCounts = {};
        tickets.forEach((t) => {
          (t.tags || []).forEach((tag) => {
            if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          });
        });
        // Top 10 only
        results.ticketsByTag = Object.fromEntries(
          Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
        );
      }
    } catch (error) {
      logger.warn('Failed to get tag distribution', error.message);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Response times (from ticket_metrics API)
  // -----------------------------------------------------------------------

  /** Average first reply and full resolution times in seconds (business hours) */
  async getReplyTimeMetrics() {
    try {
      const { ticket_metrics: metrics } = await this.makeRequest('/ticket_metrics.json', {
        page: 1,
        per_page: MAX_SAMPLES,
      });

      if (!metrics?.length) throw new Error('No ticket metrics');

      const replyMetrics = metrics.filter(
        (m) => m.reply_time_in_minutes?.business != null
      );
      const resolutionMetrics = metrics.filter(
        (m) => m.full_resolution_time_in_minutes?.business != null
      );

      const avg = (arr, fn) =>
        arr.length ? Math.floor((arr.reduce((s, m) => s + fn(m), 0) / arr.length) * 60) : null;

      return {
        firstReplyTime:
          avg(replyMetrics, (m) => m.reply_time_in_minutes.business) ?? 3600,
        fullResolutionTime:
          avg(resolutionMetrics, (m) => m.full_resolution_time_in_minutes.business) ?? 86400,
      };
    } catch (error) {
      logger.error('Failed to get reply time metrics', error);
      return { firstReplyTime: 3600, fullResolutionTime: 86400 };
    }
  }

  // -----------------------------------------------------------------------
  // Quality indicators (raw counts — Grafana calculates rates)
  // -----------------------------------------------------------------------

  /**
   * Raw quality counts:
   * - reopenedTotal: tickets reopened in last 30d
   * - oneTouchTotal: tickets solved with <=1 reply
   * - avgReplies: average replies per ticket
   * - avgRequesterWait: average requester wait time in seconds
   */
  async getQualityMetrics() {
    const since = this.formatDate(30);

    // Reopened count
    const reopenedTotal = await this.getSearchCount(
      `type:ticket updated>${since} reopens>0`,
      'reopened tickets'
    );

    // Ticket metrics for reply analysis
    let oneTouchTotal = 0;
    let avgReplies = 0;
    let avgRequesterWait = 7200; // 2h default

    try {
      const { ticket_metrics: metrics } = await this.makeRequest('/ticket_metrics.json', {
        page: 1,
        per_page: MAX_SAMPLES,
      });

      if (metrics?.length) {
        const withReplies = metrics.filter((m) => typeof m.replies === 'number');
        if (withReplies.length) {
          oneTouchTotal = withReplies.filter((m) => m.replies <= 1).length;
          avgReplies = withReplies.reduce((s, m) => s + m.replies, 0) / withReplies.length;
        }

        const withWait = metrics.filter(
          (m) => m.requester_wait_time_in_minutes?.business != null
        );
        if (withWait.length) {
          avgRequesterWait = Math.floor(
            (withWait.reduce((s, m) => s + m.requester_wait_time_in_minutes.business, 0) /
              withWait.length) *
              60
          );
        }
      }
    } catch (error) {
      logger.warn('Failed to get ticket metrics for quality', error.message);
    }

    return { reopenedTotal, oneTouchTotal, avgReplies, avgRequesterWait };
  }

  // -----------------------------------------------------------------------
  // Backlog / capacity
  // -----------------------------------------------------------------------

  /** Open ticket age distribution + unassigned count */
  async getCapacityMetrics() {
    const results = { backlogAge: {}, unassignedTotal: 0 };

    // Age buckets
    const buckets = [
      ['lt_1d', `type:ticket status<solved created>${this.formatDate(1)}`],
      ['1d_3d', `type:ticket status<solved created<${this.formatDate(1)} created>${this.formatDate(3)}`],
      ['3d_7d', `type:ticket status<solved created<${this.formatDate(3)} created>${this.formatDate(7)}`],
      ['7d_30d', `type:ticket status<solved created<${this.formatDate(7)} created>${this.formatDate(30)}`],
      ['gt_30d', `type:ticket status<solved created<${this.formatDate(30)}`],
    ];

    for (const [bucket, query] of buckets) {
      results.backlogAge[bucket] = await this.getSearchCount(query, `backlog ${bucket}`);
    }

    results.unassignedTotal = await this.getSearchCount(
      'type:ticket status<solved assignee:none',
      'unassigned'
    );

    return results;
  }

  // -----------------------------------------------------------------------
  // Operational
  // -----------------------------------------------------------------------

  /** Suspended tickets, active automations, triggers, macros */
  async getOperationalMetrics() {
    const results = {
      suspendedTicketsTotal: 0,
      automationsCount: 0,
      triggersCount: 0,
      macrosCount: 0,
    };

    // Suspended tickets
    try {
      const data = await this.makeRequest('/suspended_tickets.json', { per_page: 1 });
      results.suspendedTicketsTotal = data.count || 0;
    } catch (error) {
      logger.warn('Failed to get suspended tickets', error.message);
    }

    // Automations (active only)
    try {
      const { automations } = await this.makeRequest('/automations.json');
      if (Array.isArray(automations)) {
        results.automationsCount = automations.filter((a) => a.active).length;
      }
    } catch (error) {
      logger.warn('Failed to get automations', error.message);
    }

    // Triggers (active only)
    try {
      const { triggers } = await this.makeRequest('/triggers.json');
      if (Array.isArray(triggers)) {
        results.triggersCount = triggers.filter((t) => t.active).length;
      }
    } catch (error) {
      logger.warn('Failed to get triggers', error.message);
    }

    // Macros (active only)
    try {
      const { macros } = await this.makeRequest('/macros.json');
      if (Array.isArray(macros)) {
        results.macrosCount = macros.filter((m) => m.active).length;
      }
    } catch (error) {
      logger.warn('Failed to get macros', error.message);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Connection test
  // -----------------------------------------------------------------------

  async testConnection() {
    try {
      await this.makeRequest('/users/me.json');
      logger.info('Zendesk connection test OK');
      return true;
    } catch (error) {
      logger.error('Connection test failed', error.message);
      return false;
    }
  }
}

module.exports = ZendeskClient;
