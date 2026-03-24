const axios = require('axios');
const logger = require('./logger');

/**
 * Search API returns max 1000 results (100/page × 10 pages).
 * We paginate up to this limit for representative samples.
 * @constant {number}
 */
const SEARCH_MAX_RESULTS = 1000;
const SEARCH_PER_PAGE = 100;
const SEARCH_MAX_PAGES = 10;

/** @constant {string[]} */
const PRIORITY_LEVELS = ['low', 'normal', 'high', 'urgent'];

/**
 * Zendesk REST API v2 client — read-only (GET requests only).
 * Supports API token (Basic Auth) and OAuth Bearer token.
 *
 * Data sources and their limitations:
 * - Search count API: exact counts, no result limit
 * - Search API: max 1000 results (100/page × 10 pages), sorted by relevance
 * - ticket_metrics API: NOT USED (sorts by ticket ID asc = oldest first, useless for 70k+ tickets)
 *
 * All time-windowed metrics use the Search API with date filters,
 * so they reflect recent data, not the oldest tickets.
 *
 * @class ZendeskClient
 */
class ZendeskClient {
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
   * Rate-limited GET request (~200 req/min).
   * @param {string} path
   * @param {Object} [params]
   * @returns {Promise<Object>}
   */
  async makeRequest(path, params = {}) {
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
   * Search count — returns exact count, no result limit.
   * @param {string} query
   * @param {string} [label]
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
   * Paginated search — fetches up to 1000 ticket results.
   * Uses sort_by=created_at&sort_order=desc so newest tickets come first.
   * @param {string} query - Zendesk search query (must include type:ticket)
   * @param {number} [maxPages=SEARCH_MAX_PAGES] - Max pages to fetch (1-10)
   * @returns {Promise<Object[]>} Array of ticket objects
   */
  async searchTickets(query, maxPages = SEARCH_MAX_PAGES) {
    const allResults = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const data = await this.makeRequest('/search.json', {
          query,
          per_page: SEARCH_PER_PAGE,
          sort_by: 'created_at',
          sort_order: 'desc',
          page,
        });

        if (!data.results?.length) break;
        allResults.push(...data.results);

        // Stop if we got all results or no next page
        if (!data.next_page || allResults.length >= (data.count || 0)) break;

        logger.debug(`Search page ${page}: ${allResults.length}/${data.count} results`);
      } catch (error) {
        logger.warn(`Search pagination failed on page ${page}: ${error.message}`);
        break;
      }
    }

    return allResults;
  }

  /** @returns {string} YYYY-MM-DD */
  formatDate(daysAgo = 0) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
  }

  // -----------------------------------------------------------------------
  // Ticket counts (exact via search count API — no sample limitation)
  // -----------------------------------------------------------------------

  /** Current ticket count per status (all tickets, all time) */
  async getTicketCounts() {
    const statuses = ['new', 'open', 'pending', 'hold', 'solved', 'closed'];
    const results = {};
    for (const s of statuses) {
      results[s] = await this.getSearchCount(`type:ticket status:${s}`, `status:${s}`);
    }
    return results;
  }

  /** All unsolved tickets (all time) */
  async getUnsolvedTicketCount() {
    return this.getSearchCount('type:ticket -status:solved -status:closed', 'unsolved');
  }

  /** Cumulative total of all tickets ever created (all time) */
  async getTicketsCreatedTotal() {
    return this.getSearchCount('type:ticket', 'tickets created total');
  }

  /** Tickets solved in the last 30 days */
  async getSolvedTicketsTotal() {
    return this.getSearchCount(
      `type:ticket status:solved solved>${this.formatDate(30)}`,
      'solved tickets (30d)'
    );
  }

  // -----------------------------------------------------------------------
  // Distribution
  // -----------------------------------------------------------------------

  /** Ticket count per support group (all tickets, all time) */
  async getTicketsByGroup() {
    try {
      const { groups } = await this.makeRequest('/groups.json');
      if (!groups) return {};

      const results = {};
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
   *
   * - Channels: from ticket via.channel, sample of last 30d (up to 1000 tickets)
   * - Priority: exact counts via search count API (all tickets)
   * - Tags: from ticket data, sample of last 30d (up to 1000 tickets)
   */
  async getChannelMetrics() {
    const results = {
      ticketsByChannel: {},
      ticketsByPriority: {},
      ticketsByTag: {},
    };

    // Channels + Tags — paginated search of last 30 days (up to 1000 tickets)
    try {
      const tickets = await this.searchTickets(
        `type:ticket created>${this.formatDate(30)}`
      );

      logger.info(`Channel/tag analysis: ${tickets.length} tickets from last 30 days`);

      // Group by via.channel
      tickets.forEach((t) => {
        const ch = t.via?.channel || 'unknown';
        results.ticketsByChannel[ch] = (results.ticketsByChannel[ch] || 0) + 1;
      });

      // Count tags
      const tagCounts = {};
      tickets.forEach((t) => {
        (t.tags || []).forEach((tag) => {
          if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      });
      results.ticketsByTag = Object.fromEntries(
        Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
      );
    } catch (error) {
      logger.warn('Failed to get channel/tag distribution', error.message);
    }

    // Priority — exact counts (all tickets, all time)
    for (const p of PRIORITY_LEVELS) {
      results.ticketsByPriority[p] = await this.getSearchCount(
        `type:ticket priority:${p}`,
        `priority:${p}`
      );
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Response times + Quality
  // Uses Search API with sideloaded metric_sets for recent tickets,
  // NOT /ticket_metrics.json (which returns oldest tickets first).
  // -----------------------------------------------------------------------

  /**
   * Average response times from recently solved tickets (last 30 days).
   * Fetches up to 1000 solved tickets via paginated search, then reads
   * the metric fields from each ticket's metric_set sideload.
   *
   * Sample size: up to 1000 tickets (Search API limit).
   * Time window: last 30 days.
   */
  async getReplyTimeMetrics() {
    try {
      const tickets = await this.searchTickets(
        `type:ticket status:solved solved>${this.formatDate(30)}`
      );

      if (!tickets.length) {
        logger.warn('No solved tickets found for reply time calculation');
        return { firstReplyTime: 0, fullResolutionTime: 0, sampleSize: 0 };
      }

      // Fetch metrics for these tickets via their IDs (batch via ticket_metrics)
      // The search results include metric_set if sideloaded, but the search API
      // doesn't support sideloading metric_set. We fetch individual ticket metrics.
      // To minimize API calls, fetch metrics page by page matching our ticket IDs.
      const ticketIds = tickets.map((t) => t.id);
      const metrics = await this.fetchTicketMetricsBatch(ticketIds);

      const replyTimes = [];
      const resolutionTimes = [];

      metrics.forEach((m) => {
        if (m.reply_time_in_minutes?.business != null) {
          replyTimes.push(m.reply_time_in_minutes.business);
        }
        if (m.full_resolution_time_in_minutes?.business != null) {
          resolutionTimes.push(m.full_resolution_time_in_minutes.business);
        }
      });

      const avg = (arr) => arr.length ? Math.floor((arr.reduce((a, b) => a + b, 0) / arr.length) * 60) : 0;

      const result = {
        firstReplyTime: avg(replyTimes),
        fullResolutionTime: avg(resolutionTimes),
        sampleSize: metrics.length,
      };

      logger.info(`Reply time metrics: ${metrics.length} samples, avg first reply ${result.firstReplyTime}s, avg resolution ${result.fullResolutionTime}s`);
      return result;
    } catch (error) {
      logger.error('Failed to get reply time metrics', error);
      return { firstReplyTime: 0, fullResolutionTime: 0, sampleSize: 0 };
    }
  }

  /**
   * Quality metrics from recently solved tickets (last 30 days).
   * Uses Search API (up to 1000 tickets) for representative data.
   *
   * Sample size: up to 1000 tickets.
   * Time window: last 30 days.
   */
  async getQualityMetrics() {
    const since = this.formatDate(30);

    // Exact count via search count API
    const reopenedTotal = await this.getSearchCount(
      `type:ticket updated>${since} reopens>0`,
      'reopened tickets (30d)'
    );

    // Fetch solved tickets for reply analysis
    let oneTouchTotal = 0;
    let avgReplies = 0;
    let avgRequesterWait = 0;
    let sampleSize = 0;

    try {
      const tickets = await this.searchTickets(
        `type:ticket status:solved solved>${since}`
      );

      if (tickets.length) {
        const ticketIds = tickets.map((t) => t.id);
        const metrics = await this.fetchTicketMetricsBatch(ticketIds);
        sampleSize = metrics.length;

        const withReplies = metrics.filter((m) => typeof m.replies === 'number');
        if (withReplies.length) {
          oneTouchTotal = withReplies.filter((m) => m.replies <= 1).length;
          avgReplies = withReplies.reduce((s, m) => s + m.replies, 0) / withReplies.length;
        }

        const withWait = metrics.filter((m) => m.requester_wait_time_in_minutes?.business != null);
        if (withWait.length) {
          avgRequesterWait = Math.floor(
            (withWait.reduce((s, m) => s + m.requester_wait_time_in_minutes.business, 0) / withWait.length) * 60
          );
        }
      }

      logger.info(`Quality metrics: ${sampleSize} samples from last 30d`);
    } catch (error) {
      logger.warn('Failed to get quality metrics', error.message);
    }

    return { reopenedTotal, oneTouchTotal, avgReplies, avgRequesterWait, sampleSize };
  }

  /**
   * Fetch ticket metrics for a batch of ticket IDs.
   * Uses individual /tickets/{id}/metrics.json calls.
   * Caps at 200 to stay within rate limits per scrape cycle.
   *
   * @param {number[]} ticketIds
   * @param {number} [maxFetch=200] - Max individual metrics to fetch
   * @returns {Promise<Object[]>} Array of ticket_metric objects
   */
  async fetchTicketMetricsBatch(ticketIds, maxFetch = 200) {
    const idsToFetch = ticketIds.slice(0, maxFetch);
    const metrics = [];

    for (const id of idsToFetch) {
      try {
        const data = await this.makeRequest(`/tickets/${id}/metrics.json`);
        if (data.ticket_metric) {
          metrics.push(data.ticket_metric);
        }
      } catch (error) {
        // Skip individual failures (deleted tickets, permission issues)
        logger.debug(`Failed to fetch metrics for ticket ${id}: ${error.message}`);
      }
    }

    logger.debug(`Fetched metrics for ${metrics.length}/${idsToFetch.length} tickets`);
    return metrics;
  }

  // -----------------------------------------------------------------------
  // Backlog / capacity (exact counts via search count API)
  // -----------------------------------------------------------------------

  /** Open ticket age distribution + unassigned count (all open tickets) */
  async getCapacityMetrics() {
    const results = { backlogAge: {}, unassignedTotal: 0 };

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

  async getOperationalMetrics() {
    const results = { suspendedTicketsTotal: 0, automationsCount: 0, triggersCount: 0, macrosCount: 0 };

    try {
      const data = await this.makeRequest('/suspended_tickets.json', { per_page: 1 });
      results.suspendedTicketsTotal = data.count || 0;
    } catch (e) { logger.warn('Failed to get suspended tickets', e.message); }

    try {
      const { automations } = await this.makeRequest('/automations.json');
      if (Array.isArray(automations)) results.automationsCount = automations.filter((a) => a.active).length;
    } catch (e) { logger.warn('Failed to get automations', e.message); }

    try {
      const { triggers } = await this.makeRequest('/triggers.json');
      if (Array.isArray(triggers)) results.triggersCount = triggers.filter((t) => t.active).length;
    } catch (e) { logger.warn('Failed to get triggers', e.message); }

    try {
      const { macros } = await this.makeRequest('/macros.json');
      if (Array.isArray(macros)) results.macrosCount = macros.filter((m) => m.active).length;
    } catch (e) { logger.warn('Failed to get macros', e.message); }

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
