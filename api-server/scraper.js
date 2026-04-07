// Firecrawl scraper integration for high-quality content extraction

const { default: FirecrawlApp } = require('@mendable/firecrawl-js');

class ScraperService {
  constructor(apiKey) {
    if (apiKey) {
      this.firecrawl = new FirecrawlApp({ apiKey });
      this.useFirecrawl = true;
    } else {
      this.useFirecrawl = false;
    }
  }

  /**
   * Scrape a URL using Firecrawl or fallback to basic extraction
   */
  async scrapeUrl(url, options = {}) {
    if (this.useFirecrawl) {
      try {
        const result = await this.firecrawl.scrapeUrl(url, {
          formats: ['markdown', 'html'],
          onlyMainContent: true,
          ...options,
        });

        if (result.success) {
          return {
            success: true,
            source: 'firecrawl',
            url: result.metadata?.sourceURL || url,
            title: result.metadata?.title || '',
            content: result.markdown || result.text || '',
            html: result.html || '',
            metadata: {
              description: result.metadata?.description || '',
              author: result.metadata?.author || '',
              published: result.metadata?.publishedDate || '',
              site: result.metadata?.sourceURL
                ? new URL(result.metadata.sourceURL).hostname
                : new URL(url).hostname,
              ...result.metadata,
            },
          };
        }
      } catch (err) {
        console.error('Firecrawl error:', err.message);
        // Fall through to fallback
      }
    }

    // Return error if Firecrawl failed
    return {
      success: false,
      source: 'none',
      error: 'Firecrawl not available. Provide FIRECRAWL_API_KEY or use fallback.',
    };
  }

  /**
   * Search and scrape multiple URLs
   */
  async searchAndScrape(query, options = {}) {
    if (!this.useFirecrawl) {
      return {
        success: false,
        error: 'Firecrawl not configured',
      };
    }

    try {
      const result = await this.firecrawl.search(query, {
        limit: options.limit || 5,
        ...options,
      });

      return {
        success: true,
        source: 'firecrawl',
        results: result.data || [],
      };
    } catch (err) {
      console.error('Firecrawl search error:', err.message);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Crawl a website
   */
  async crawlWebsite(url, options = {}) {
    if (!this.useFirecrawl) {
      return {
        success: false,
        error: 'Firecrawl not configured',
      };
    }

    try {
      const result = await this.firecrawl.crawlUrl(url, {
        limit: options.limit || 10,
        scrapeOptions: {
          formats: ['markdown'],
          ...options.scrapeOptions,
        },
        ...options,
      });

      return {
        success: true,
        source: 'firecrawl',
        id: result.id,
        url: result.url,
      };
    } catch (err) {
      console.error('Firecrawl crawl error:', err.message);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Check if Firecrawl is available
   */
  isAvailable() {
    return this.useFirecrawl;
  }
}

module.exports = { ScraperService };
