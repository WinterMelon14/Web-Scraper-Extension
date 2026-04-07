// Generic content script - captures whatever is on the page
// The AI will figure out what it is (email, article, chat, etc.)

(function() {
  'use strict';

  function extractContent() {
    // Get the best main content
    const findMainContent = () => {
      const selectors = [
        'article',
        'main',
        '[role="main"]',
        '.content',
        '#content',
        '.post',
        '.article',
        '[data-testid]',
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.innerText.length > 200) {
          return { element: el, selector };
        }
      }

      // Fallback: largest text block
      let bestEl = document.body;
      let maxText = 0;

      const divs = document.querySelectorAll('div, section');
      for (const div of divs) {
        const text = div.innerText || '';
        if (text.length > maxText && text.length < 50000) {
          maxText = text.length;
          bestEl = div;
        }
      }

      return { element: bestEl, selector: 'auto-detected' };
    };

    // Clean the content
    const getCleanText = (element) => {
      const clone = element.cloneNode(true);

      // Remove clutter
      const junk = clone.querySelectorAll(
        'script, style, nav, header, footer, aside, .advertisement, .ads, iframe, noscript'
      );
      junk.forEach(el => el.remove());

      return clone.innerText.trim();
    };

    // Extract all metadata we can find
    const getMetadata = () => {
      const meta = {
        url: window.location.href,
        title: document.title,
        domain: window.location.hostname,
        description: '',
        author: '',
        published: '',
        keywords: [],
      };

      // Standard meta tags
      const getMetaTag = (name) => {
        const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"], meta[property="og:${name}"]`);
        return el?.getAttribute('content') || '';
      };

      meta.description = getMetaTag('description') || getMetaTag('og:description');
      meta.author = getMetaTag('author') || getMetaTag('article:author');
      meta.published = getMetaTag('article:published_time') || getMetaTag('publish_date');

      // Keywords
      const keywordsTag = document.querySelector('meta[name="keywords"]');
      if (keywordsTag) {
        meta.keywords = keywordsTag.getAttribute('content').split(',').map(k => k.trim());
      }

      return meta;
    };

    // Try to detect content type from URL/structure
    const detectContentType = () => {
      const url = window.location.href.toLowerCase();
      const path = window.location.pathname.toLowerCase();

      // Common patterns (just for metadata, AI will do real analysis)
      if (url.includes('mail.google.com')) return { type: 'webmail', platform: 'gmail' };
      if (url.includes('outlook.live.com')) return { type: 'webmail', platform: 'outlook' };
      if (url.includes('chat.openai.com')) return { type: 'chat', platform: 'chatgpt' };
      if (url.includes('claude.ai')) return { type: 'chat', platform: 'claude' };
      if (url.includes('github.com')) return { type: 'code', platform: 'github' };
      if (url.includes('docs.google.com')) return { type: 'document', platform: 'google_docs' };
      if (url.includes('notion.so')) return { type: 'document', platform: 'notion' };
      if (url.includes('stackoverflow.com')) return { type: 'qa', platform: 'stackoverflow' };
      if (path.includes('/issues/')) return { type: 'issue', platform: 'generic' };
      if (path.includes('/pull/')) return { type: 'pr', platform: 'generic' };

      return { type: 'webpage', platform: 'generic' };
    };

    const main = findMainContent();
    const metadata = getMetadata();
    const contentType = detectContentType();

    return {
      content: getCleanText(main.element).slice(0, 100000),
      html: document.documentElement.outerHTML.slice(0, 50000),
      metadata: {
        ...metadata,
        ...contentType,
        extractedAt: new Date().toISOString(),
        extractionMethod: main.selector,
        wordCount: main.element.innerText.split(/\s+/).length,
      },
    };
  }

  // Listen for extraction requests
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extract') {
      const data = extractContent();
      sendResponse({ success: true, data });
      return true;
    }
  });

  // Store for popup access
  window.__pageContent = extractContent();

  console.log('Context Capture: Generic extractor loaded');
})();
