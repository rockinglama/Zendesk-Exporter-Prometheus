const axios = require('axios');
const logger = require('./logger');

const SEARCH_PER_PAGE = 100;
const SEARCH_MAX_PAGES = 10;
const PRIORITY_LEVELS = ['low', 'normal', 'high', 'urgent'];

/** Time windows in days — used for windowed metrics */
const WINDOWS = [1, 7, 30];

/**
 * Max individual ticket metrics to fetch per scrape.
 * At 300ms rate limit = ~60s for 200 calls.
 * @constant {number}
 */
const MAX_METRIC_FETCHES = 200;

/**
 * Zendesk REST API v2 client — read-only.
 *
 * API call strategy to minimize requests:
 * - Counts: Search Count API (1 call each, exact)
 * - Quality metrics: ONE paginated search for 30d solved tickets,
 *   ONE batch of /tickets/{id}/metrics fetches,
 *   then client-side filtering for 1d/7d/30d windows
 * - Channels/tags: ONE paginated search, grouped client-side
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

  sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async makeRequest(path, params = {}) {
    const elapsed = Date.now() - this.lastRequest;
    if (elapsed < 300) await this.sleep(300 - elapsed);
    this.lastRequest = Date.now();
    try {
      const { data } = await this.client.get(path, { params });
      return data;
    } catch (error) {
      const status = error.response?.status;
      const detail = error.response?.data?.error || error.response?.data?.description || error.message;
      logger.error(`API request failed: ${path} — ${status || 'no response'} — ${detail}`);
      throw error;
    }
  }

  async getSearchCount(query, label = 'search') {
    try {
      const data = await this.makeRequest('/search/count.json', { query });
      return data.count || 0;
    } catch (error) {
      logger.warn(`Failed to get ${label}: ${error.message}`);
      return 0;
    }
  }

  async searchTickets(query, maxPages = SEARCH_MAX_PAGES) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      try {
        const data = await this.makeRequest('/search.json', {
          query, per_page: SEARCH_PER_PAGE, sort_by: 'created_at', sort_order: 'desc', page,
        });
        if (!data.results?.length) break;
        all.push(...data.results);
        if (!data.next_page || all.length >= (data.count || 0)) break;
      } catch (error) {
        logger.warn(`Search page ${page} failed: ${error.message}`);
        break;
      }
    }
    return all;
  }

  formatDate(daysAgo = 0) {
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
  }

  /** @returns {Date} threshold date for N days ago */
  dateThreshold(daysAgo) {
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    return d;
  }

  // -----------------------------------------------------------------------
  // Ticket counts (exact, cheap — 1 Search Count call each)
  // -----------------------------------------------------------------------

  async getTicketCounts() {
    const statuses = ['new', 'open', 'pending', 'hold', 'solved', 'closed'];
    const results = {};
    for (const s of statuses) {
      results[s] = await this.getSearchCount(`type:ticket status:${s}`, `status:${s}`);
    }
    return results;
  }

  // Unsolved tickets = calculated in Grafana from per-status gauges

  async getTicketsCreatedTotal() {
    return this.getSearchCount('type:ticket', 'tickets created total');
  }

  // -----------------------------------------------------------------------
  // Windowed counts (exact — 3 Search Count calls per metric × 3 windows = 9)
  // -----------------------------------------------------------------------

  /**
   * Returns { '1d': N, '7d': N, '30d': N } for created, solved, reopened.
   * 9 API calls total (3 metrics × 3 windows).
   */
  async getWindowedCounts() {
    const results = {
      created: {},
      solved: {},
      reopened: {},
    };

    for (const days of WINDOWS) {
      const since = this.formatDate(days);
      const w = `${days}d`;

      results.created[w] = await this.getSearchCount(
        `type:ticket created>${since}`, `created (${w})`
      );
      results.solved[w] = await this.getSearchCount(
        `type:ticket status:solved solved>${since}`, `solved (${w})`
      );
      // reopened counts come from getQualityMetrics() (ticket_metrics.reopens field)
      // "reopens" is not a valid search keyword
      results.reopened[w] = 0;
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Quality + response times (ONE search + ONE batch fetch, filter client-side)
  // -----------------------------------------------------------------------

  /**
   * Fetches solved tickets from last 30d, gets their metrics,
   * then filters by solved_at date for 1d/7d/30d windows.
   *
   * API calls: ~10 (search pages) + up to 200 (individual metrics) = ~210
   * All three windows come from one data fetch.
   *
   * @returns {Object} { '1d': {...}, '7d': {...}, '30d': {...} }
   */
  async getQualityMetrics() {
    const results = {};
    for (const w of ['1d', '7d', '30d']) {
      results[w] = {
        firstReplyTime: 0, fullResolutionTime: 0,
        requesterWaitTime: 0, oneTouchTotal: 0,
        avgReplies: 0, reopenedTotal: 0, sampleSize: 0,
      };
    }

    try {
      // ONE search: all solved tickets in last 30 days
      const tickets = await this.searchTickets(
        `type:ticket status:solved solved>${this.formatDate(30)}`
      );

      if (!tickets.length) {
        logger.warn('No solved tickets found for quality metrics');
        return results;
      }

      logger.info(`Quality metrics: found ${tickets.length} solved tickets (30d), fetching metrics...`);

      // ONE batch: fetch individual metrics (capped at MAX_METRIC_FETCHES)
      const ticketIds = tickets.slice(0, MAX_METRIC_FETCHES).map((t) => t.id);
      const metricsMap = await this.fetchTicketMetricsBatch(ticketIds);

      // Build enriched list: ticket + its metrics + solved_at date
      const enriched = [];
      for (const ticket of tickets) {
        const m = metricsMap.get(ticket.id);
        if (!m) continue;

        const solvedAt = ticket.solved_at ? new Date(ticket.solved_at) : null;
        if (!solvedAt) continue;

        enriched.push({ ticket, metrics: m, solvedAt });
      }

      logger.info(`Quality metrics: ${enriched.length} tickets with metrics`);

      // Filter and calculate per window
      for (const days of WINDOWS) {
        const w = `${days}d`;
        const threshold = this.dateThreshold(days);
        const windowData = enriched.filter((e) => e.solvedAt >= threshold);

        if (!windowData.length) continue;

        // Reply times
        const replyTimes = windowData
          .filter((e) => e.metrics.reply_time_in_minutes?.business != null)
          .map((e) => e.metrics.reply_time_in_minutes.business);

        const resolutionTimes = windowData
          .filter((e) => e.metrics.full_resolution_time_in_minutes?.business != null)
          .map((e) => e.metrics.full_resolution_time_in_minutes.business);

        const waitTimes = windowData
          .filter((e) => e.metrics.requester_wait_time_in_minutes?.business != null)
          .map((e) => e.metrics.requester_wait_time_in_minutes.business);

        const withReplies = windowData
          .filter((e) => typeof e.metrics.replies === 'number');

        const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

        // Count reopened tickets (reopens > 0 in ticket_metrics)
        const reopenedCount = windowData.filter(
          (e) => typeof e.metrics.reopens === 'number' && e.metrics.reopens > 0
        ).length;

        results[w] = {
          firstReplyTime: Math.floor(avg(replyTimes) * 60),
          fullResolutionTime: Math.floor(avg(resolutionTimes) * 60),
          requesterWaitTime: Math.floor(avg(waitTimes) * 60),
          oneTouchTotal: withReplies.filter((e) => e.metrics.replies <= 1).length,
          avgReplies: parseFloat(avg(withReplies.map((e) => e.metrics.replies)).toFixed(1)),
          reopenedTotal: reopenedCount,
          sampleSize: windowData.length,
        };
      }
    } catch (error) {
      logger.error('Failed to get quality metrics', error);
    }

    return results;
  }

  /**
   * Fetch ticket metrics in batch. Returns a Map<ticketId, metricObject>.
   * @param {number[]} ticketIds
   * @returns {Promise<Map<number, Object>>}
   */
  async fetchTicketMetricsBatch(ticketIds) {
    const map = new Map();
    for (const id of ticketIds) {
      try {
        const data = await this.makeRequest(`/tickets/${id}/metrics.json`);
        if (data.ticket_metric) map.set(id, data.ticket_metric);
      } catch (error) {
        logger.debug(`Metrics fetch failed for ticket ${id}: ${error.message}`);
      }
    }
    logger.info(`Fetched metrics for ${map.size}/${ticketIds.length} tickets`);
    return map;
  }

  // -----------------------------------------------------------------------
  // Distribution (channels/tags sampled, priority exact)
  // -----------------------------------------------------------------------

  async getChannelMetrics() {
    const results = { ticketsByChannel: {}, ticketsByPriority: {}, ticketsByTag: {} };

    // ONE paginated search for channels + tags
    try {
      const tickets = await this.searchTickets(
        `type:ticket created>${this.formatDate(30)}`
      );
      logger.info(`Channel/tag analysis: ${tickets.length} tickets (30d)`);

      tickets.forEach((t) => {
        const ch = t.via?.channel || 'unknown';
        results.ticketsByChannel[ch] = (results.ticketsByChannel[ch] || 0) + 1;
      });

      const tagCounts = {};
      tickets.forEach((t) => {
        (t.tags || []).forEach((tag) => { if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1; });
      });
      results.ticketsByTag = Object.fromEntries(
        Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
      );
    } catch (error) {
      logger.warn('Failed to get channel/tag distribution', error.message);
    }

    // Priority — exact counts
    for (const p of PRIORITY_LEVELS) {
      results.ticketsByPriority[p] = await this.getSearchCount(`type:ticket priority:${p}`, `priority:${p}`);
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Distribution by group (exact)
  // -----------------------------------------------------------------------

  async getTicketsByGroup() {
    try {
      const { groups } = await this.makeRequest('/groups.json');
      if (!groups) return {};
      const results = {};
      for (const g of groups) {
        results[g.name] = await this.getSearchCount(`type:ticket group:${g.id}`, `group ${g.name}`);
      }
      return results;
    } catch (error) {
      logger.error('Failed to get tickets by group', error);
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // Backlog (exact)
  // -----------------------------------------------------------------------

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
    results.unassignedTotal = await this.getSearchCount('type:ticket status<solved assignee:none', 'unassigned');
    return results;
  }


  async testConnection() {
    try {
      const data = await this.makeRequest('/users/me.json');
      logger.info(`Connection OK — authenticated as user ${data.user?.id || 'unknown'} (${data.user?.role || 'unknown role'})`);
      return true;
    } catch (e) {
      const status = e.response?.status;
      if (status === 401) logger.error('Connection failed — 401 Unauthorized. Check your credentials (email/token or OAuth token).');
      else if (status === 403) logger.error('Connection failed — 403 Forbidden. Your user may lack API access.');
      else logger.error(`Connection failed — ${status || 'no response'}: ${e.message}`);
      return false;
    }
  }
}

module.exports = ZendeskClient;
