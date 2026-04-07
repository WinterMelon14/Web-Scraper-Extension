#!/usr/bin/env node
// MCP Server for Context Capture Database
// Exposes SQLite database via Model Context Protocol

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'api-server', 'captures.db');

// MCP Protocol implementation (simplified)
class MCPServer {
  constructor() {
    this.db = null;
    this.tools = new Map();
    this.setupTools();
  }

  setupTools() {
    // Tool: query_database
    this.tools.set('query_database', {
      name: 'query_database',
      description: 'Query the captures database with SELECT statements',
      inputSchema: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'SQL query (SELECT only)',
          },
          params: {
            type: 'array',
            description: 'Query parameters',
            items: { type: 'string' },
          },
        },
        required: ['sql'],
      },
      handler: async (args) => {
        const { sql, params = [] } = args;

        // Security: Only allow SELECT
        const normalized = sql.trim().toLowerCase();
        if (!normalized.startsWith('select')) {
          throw new Error('Only SELECT queries allowed');
        }

        // Block destructive keywords
        const blocked = ['insert', 'update', 'delete', 'drop', 'alter', 'create'];
        if (blocked.some(b => normalized.includes(b))) {
          throw new Error('Query contains blocked keywords');
        }

        const stmt = this.db.prepare(sql);
        const results = stmt.all(...params);

        // Parse metadata JSON
        results.forEach(r => {
          if (r.metadata) {
            try {
              r.metadata = JSON.parse(r.metadata);
            } catch {}
          }
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      },
    });

    // Tool: search_captures
    this.tools.set('search_captures', {
      name: 'search_captures',
      description: 'Full-text search through captured content',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          limit: {
            type: 'number',
            description: 'Max results',
            default: 10,
          },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const { query, limit = 10 } = args;

        const stmt = this.db.prepare(`
          SELECT c.*, rank
          FROM captures_fts
          JOIN captures c ON c.id = captures_fts.rowid
          WHERE captures_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `);

        const results = stmt.all(query, limit);

        results.forEach(r => {
          if (r.metadata) {
            try {
              r.metadata = JSON.parse(r.metadata);
            } catch {}
          }
        });

        return {
          content: [
            {
              type: 'text',
              text: `Found ${results.length} results:\n\n` +
                    JSON.stringify(results, null, 2),
            },
          ],
        };
      },
    });

    // Tool: get_recent_captures
    this.tools.set('get_recent_captures', {
      name: 'get_recent_captures',
      description: 'Get recent captured content',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Number of captures to retrieve',
            default: 20,
          },
          domain: {
            type: 'string',
            description: 'Filter by domain (optional)',
          },
        },
      },
      handler: async (args) => {
        const { limit = 20, domain } = args;

        let results;
        if (domain) {
          const stmt = this.db.prepare(`
            SELECT * FROM captures
            WHERE url LIKE ?
            ORDER BY timestamp DESC
            LIMIT ?
          `);
          results = stmt.all(`%${domain}%`, limit);
        } else {
          const stmt = this.db.prepare(`
            SELECT * FROM captures
            ORDER BY timestamp DESC
            LIMIT ?
          `);
          results = stmt.all(limit);
        }

        results.forEach(r => {
          if (r.metadata) {
            try {
              r.metadata = JSON.parse(r.metadata);
            } catch {}
          }
        });

        return {
          content: [
            {
              type: 'text',
              text: `Recent ${results.length} captures:\n\n` +
                    JSON.stringify(results, null, 2),
            },
          ],
        };
      },
    });

    // Tool: get_stats
    this.tools.set('get_stats', {
      name: 'get_stats',
      description: 'Get database statistics',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: async () => {
        const count = this.db.prepare('SELECT COUNT(*) as count FROM captures').get();
        const lastCapture = this.db.prepare(
          'SELECT timestamp FROM captures ORDER BY timestamp DESC LIMIT 1'
        ).get();
        const uniqueSites = this.db.prepare(
          'SELECT COUNT(DISTINCT url) as count FROM captures'
        ).get();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                totalCaptures: count.count,
                lastCapture: lastCapture?.timestamp || null,
                uniqueUrls: uniqueSites.count,
              }, null, 2),
            },
          ],
        };
      },
    });

    // Tool: analyze_content
    this.tools.set('analyze_content', {
      name: 'analyze_content',
      description: 'Analyze captured content by URL pattern or time range',
      inputSchema: {
        type: 'object',
        properties: {
          url_pattern: {
            type: 'string',
            description: 'URL pattern to match (e.g., %gmail%, %chat%)',
          },
          since_hours: {
            type: 'number',
            description: 'Only include captures from last N hours',
          },
        },
      },
      handler: async (args) => {
        const { url_pattern, since_hours } = args;

        let sql = 'SELECT * FROM captures WHERE 1=1';
        const params = [];

        if (url_pattern) {
          sql += ' AND url LIKE ?';
          params.push(url_pattern);
        }

        if (since_hours) {
          const cutoff = Date.now() - (since_hours * 60 * 60 * 1000);
          sql += ' AND timestamp > ?';
          params.push(cutoff);
        }

        sql += ' ORDER BY timestamp DESC LIMIT 50';

        const stmt = this.db.prepare(sql);
        const results = stmt.all(...params);

        results.forEach(r => {
          if (r.metadata) {
            try {
              r.metadata = JSON.parse(r.metadata);
            } catch {}
          }
        });

        return {
          content: [
            {
              type: 'text',
              text: `Analysis: ${results.length} matching captures\n\n` +
                    JSON.stringify(results, null, 2),
            },
          ],
        };
      },
    });
  }

  init() {
    if (!fs.existsSync(dbPath)) {
      console.error('Database not found:', dbPath);
      console.error('Start the API server first to initialize the database');
      process.exit(1);
    }

    this.db = new Database(dbPath, { readonly: true });
    console.error('MCP Server: Connected to database');
  }

  async handleMessage(message) {
    const { method, params, id } = message;

    try {
      switch (method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: 'context-capture-mcp',
                version: '1.0.0',
              },
            },
          };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: Array.from(this.tools.values()).map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            },
          };

        case 'tools/call': {
          const tool = this.tools.get(params.name);
          if (!tool) {
            throw new Error(`Tool not found: ${params.name}`);
          }

          const result = await tool.handler(params.arguments);
          return {
            jsonrpc: '2.0',
            id,
            result,
          };
        }

        default:
          throw new Error(`Unknown method: ${method}`);
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err.message,
        },
      };
    }
  }

  run() {
    this.init();

    process.stdin.setEncoding('utf8');

    let buffer = '';

    process.stdin.on('data', (chunk) => {
      buffer += chunk;

      // Process complete messages (newline-delimited JSON)
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line);
            this.handleMessage(message).then(response => {
              console.log(JSON.stringify(response));
            });
          } catch (err) {
            console.error('Parse error:', err.message);
          }
        }
      }
    });

    process.stdin.on('end', () => {
      this.db.close();
    });

    console.error('MCP Server: Running on stdin/stdout');
    console.error('Available tools:', Array.from(this.tools.keys()).join(', '));
  }
}

const server = new MCPServer();
server.run();
