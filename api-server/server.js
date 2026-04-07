// Context Capture API Server
// Generic capture system - works with any website, AI extracts meaning

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const { ScraperService } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize clients
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const scraper = new ScraperService(process.env.FIRECRAWL_API_KEY);

// Ollama config
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const USE_OLLAMA = process.env.USE_OLLAMA === 'true' || !process.env.ANTHROPIC_API_KEY;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const dbPath = path.join(__dirname, 'captures.db');
const db = new Database(dbPath);

// Generic schema - just captures, no site-specific tables
function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      title TEXT,
      content TEXT,
      metadata TEXT, -- JSON blob for flexible metadata
      source_type TEXT, -- 'webpage', 'firecrawl', 'api', etc
      timestamp INTEGER NOT NULL,
      session_id TEXT -- optional session grouping
    );

    CREATE INDEX IF NOT EXISTS idx_captures_timestamp ON captures(timestamp);
    CREATE INDEX IF NOT EXISTS idx_captures_url ON captures(url);
    CREATE INDEX IF NOT EXISTS idx_captures_session ON captures(session_id);

    -- Full-text search across everything
    CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
      title, content,
      content='captures',
      content_rowid='id'
    );
  `);

  console.log('Database initialized - generic schema');
}

initDB();

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    services: {
      firecrawl: scraper.isAvailable(),
      claude: !!process.env.ANTHROPIC_API_KEY,
      ollama: USE_OLLAMA,
    },
    config: {
      llm_provider: USE_OLLAMA ? 'ollama' : 'claude',
      ollama_url: OLLAMA_URL,
      ollama_model: OLLAMA_MODEL,
    },
  });
});

// Stats endpoint
app.get('/stats', (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) as count FROM captures').get();
    const lastCapture = db.prepare(
      'SELECT timestamp FROM captures ORDER BY timestamp DESC LIMIT 1'
    ).get();
    const uniqueSites = db.prepare(
      'SELECT COUNT(DISTINCT url) as count FROM captures'
    ).get();

    res.json({
      totalCaptures: count.count,
      lastCapture: lastCapture?.timestamp || null,
      uniqueUrls: uniqueSites.count,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generic capture endpoint - works for any content
app.post('/capture', (req, res) => {
  try {
    const {
      url,
      title,
      content,
      metadata = {},
      source_type = 'extension',
      timestamp,
      session_id,
    } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    const stmt = db.prepare(`
      INSERT INTO captures (url, title, content, metadata, source_type, timestamp, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      url,
      title || '',
      content || '',
      JSON.stringify(metadata),
      source_type,
      timestamp || Date.now(),
      session_id || null
    );

    // Update FTS
    db.prepare(`
      INSERT INTO captures_fts (rowid, title, content)
      VALUES (?, ?, ?)
    `).run(result.lastInsertRowid, title || '', content || '');

    res.json({
      success: true,
      id: result.lastInsertRowid,
    });
  } catch (err) {
    console.error('Capture error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get recent captures
app.get('/captures', (req, res) => {
  try {
    const { limit = 20, session_id } = req.query;

    let stmt;
    if (session_id) {
      stmt = db.prepare(`
        SELECT * FROM captures
        WHERE session_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);
      const results = stmt.all(session_id, parseInt(limit));
      res.json({ results });
    } else {
      stmt = db.prepare(`
        SELECT * FROM captures
        ORDER BY timestamp DESC
        LIMIT ?
      `);
      const results = stmt.all(parseInt(limit));
      res.json({ results });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full-text search
app.get('/search', (req, res) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q) {
      return res.json({ results: [] });
    }

    const stmt = db.prepare(`
      SELECT c.*, rank
      FROM captures_fts
      JOIN captures c ON c.id = captures_fts.rowid
      WHERE captures_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const results = stmt.all(q, parseInt(limit));

    // Parse metadata JSON
    results.forEach(r => {
      try {
        r.metadata = JSON.parse(r.metadata || '{}');
      } catch {
        r.metadata = {};
      }
    });

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Query endpoint (for the AI to use)
app.post('/query', (req, res) => {
  try {
    const { sql, params = [] } = req.body;

    // Security: only allow SELECT statements
    const normalized = sql.trim().toLowerCase();
    if (!normalized.startsWith('select')) {
      return res.status(403).json({ error: 'Only SELECT queries allowed' });
    }

    // Security: block destructive keywords
    const blocked = ['insert', 'update', 'delete', 'drop', 'alter', 'create', 'attach'];
    if (blocked.some(b => normalized.includes(b))) {
      return res.status(403).json({ error: 'Query contains blocked keywords' });
    }

    const stmt = db.prepare(sql);
    const results = stmt.all(...params);

    // Parse metadata JSON in results
    results.forEach(r => {
      try {
        r.metadata = JSON.parse(r.metadata || '{}');
      } catch {
        r.metadata = {};
      }
    });

    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ollama client
async function askOllama(question, context) {
  const prompt = `You are an AI assistant analyzing a user's captured web browsing data.

The user has captured content from various websites. Your job is to:
1. Analyze the question and the provided context
2. Answer based on what you see in the captures
3. Let the user know if the answer isn't in their captured data

Content could be from any source - emails, articles, chats, docs, code, etc.
Look at the URLs and content to understand what each capture represents.

Current time: ${new Date().toISOString()}

--- CAPTURED CONTENT ---

${context}

---

Question: ${question}

Answer based on the captured content above.`;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  return result.response;
}

// Ask AI about your captured data (Claude or Ollama)
app.post('/ask', async (req, res) => {
  try {
    const { question, limit = 50 } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question required' });
    }

    // Get recent captures - completely generic, no assumptions about content type
    const captures = db.prepare(`
      SELECT url, title, content, metadata, timestamp, source_type
      FROM captures
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(parseInt(limit));

    // Parse metadata
    captures.forEach(c => {
      try {
        c.metadata = JSON.parse(c.metadata || '{}');
      } catch {
        c.metadata = {};
      }
    });

    // Build context for Claude
    const contextParts = [];
    contextParts.push(`You have access to ${captures.length} captured content items.`);
    contextParts.push('Each capture includes URL, title, content, and metadata.');
    contextParts.push('\n--- CAPTURED CONTENT ---\n');

    captures.forEach((c, i) => {
      const domain = new URL(c.url).hostname;
      contextParts.push(`[${i + 1}] ${c.title || 'Untitled'}`);
      contextParts.push(`    URL: ${c.url}`);
      contextParts.push(`    Domain: ${domain}`);
      contextParts.push(`    Time: ${new Date(c.timestamp).toLocaleString()}`);
      if (c.metadata && Object.keys(c.metadata).length > 0) {
        contextParts.push(`    Metadata: ${JSON.stringify(c.metadata)}`);
      }
      // Include content snippet
      const contentPreview = (c.content || '').slice(0, 800);
      if (contentPreview) {
        contextParts.push(`    Content: ${contentPreview}${c.content.length > 800 ? '...' : ''}`);
      }
      contextParts.push('');
    });

    const context = contextParts.join('\n');

    let answer;
    let provider;

    if (USE_OLLAMA) {
      // Use Ollama for local LLM
      provider = 'ollama';
      console.log(`Using Ollama (${OLLAMA_MODEL}) for query...`);
      answer = await askOllama(question, context);
    } else {
      // Use Claude
      provider = 'claude';
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        system: `You are an AI assistant analyzing a user's captured web browsing data.

The user has captured content from various websites. Your job is to:
1. Analyze the question and the provided context
2. Answer based on what you see in the captures
3. Let the user know if the answer isn't in their captured data

Content could be from any source - emails, articles, chats, docs, code, etc.
Look at the URLs and content to understand what each capture represents.

Current time: ${new Date().toISOString()}

Be helpful, accurate, and cite specific captures when relevant.`,
        messages: [
          {
            role: 'user',
            content: `${context}\n\n---\n\nQuestion: ${question}\n\nAnswer based on the captured content above.`,
          },
        ],
      });
      answer = response.content[0].text;
    }

    res.json({
      answer,
      contextCount: captures.length,
      provider,
      model: USE_OLLAMA ? OLLAMA_MODEL : 'claude-3-5-sonnet-20241022',
    });
  } catch (err) {
    console.error('Claude error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Firecrawl: Scrape a URL (optional enhancement)
app.post('/scrape', async (req, res) => {
  try {
    const { url, options = {}, session_id } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    const result = await scraper.scrapeUrl(url, options);

    if (result.success) {
      // Save to database as a capture
      const stmt = db.prepare(`
        INSERT INTO captures (url, title, content, metadata, source_type, timestamp, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const insertResult = stmt.run(
        result.url,
        result.title,
        result.content,
        JSON.stringify(result.metadata),
        'firecrawl',
        Date.now(),
        session_id || null
      );

      // Update FTS
      db.prepare(`
        INSERT INTO captures_fts (rowid, title, content)
        VALUES (?, ?, ?)
      `).run(insertResult.lastInsertRowid, result.title, result.content);

      res.json({
        ...result,
        savedId: insertResult.lastInsertRowid,
      });
    } else {
      res.status(503).json(result);
    }
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Firecrawl: Search the web
app.post('/web-search', async (req, res) => {
  try {
    const { query, limit = 5, save_results = false } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }

    const result = await scraper.searchAndScrape(query, { limit });

    if (save_results && result.success && result.results) {
      // Save search results to database
      const stmt = db.prepare(`
        INSERT INTO captures (url, title, content, metadata, source_type, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const item of result.results) {
        try {
          stmt.run(
            item.url || item.metadata?.sourceURL || '',
            item.title || item.metadata?.title || '',
            item.markdown || item.content || '',
            JSON.stringify(item.metadata || {}),
            'web_search',
            Date.now()
          );
        } catch (e) {
          console.error('Failed to save search result:', e);
        }
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Context Capture API server running on http://localhost:${PORT}`);
  console.log('Database:', dbPath);

  console.log('\n📡 Services:');
  console.log(`  ${scraper.isAvailable() ? '✅' : '⚠️ '} Firecrawl: ${scraper.isAvailable() ? 'Enabled' : 'Not configured'}`);
  console.log(`  ${USE_OLLAMA ? '✅' : '⚠️ '} Ollama: ${USE_OLLAMA ? `Enabled (${OLLAMA_MODEL})` : 'Not configured'}`);
  console.log(`  ${process.env.ANTHROPIC_API_KEY ? '✅' : '⚠️ '} Claude: ${process.env.ANTHROPIC_API_KEY ? 'Enabled' : 'Not configured'}`);

  console.log('\n🤖 LLM Provider:', USE_OLLAMA ? `Ollama (${OLLAMA_MODEL})` : 'Claude');

  console.log('\n🔌 Endpoints:');
  console.log('  GET  /health          - Health check');
  console.log('  GET  /stats           - Database stats');
  console.log('  POST /capture         - Save any content');
  console.log('  POST /scrape          - Firecrawl scrape URL');
  console.log('  POST /web-search      - Firecrawl web search');
  console.log('  POST /ask             - Ask AI about captures (Claude or Ollama)');
  console.log('  POST /query           - Query database (SELECT only)');
  console.log('  GET  /captures        - List captures');
  console.log('  GET  /search          - Full-text search');
  console.log('\n💡 The AI figures out content type - no custom endpoints needed!');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  db.close();
  process.exit(0);
});
