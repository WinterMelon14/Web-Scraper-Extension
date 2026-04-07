# Context Capture - Generic Web Content Capture

A Chrome extension that captures content from **any website** and lets you ask AI about it. Works on Gmail, ChatGPT, Notion, GitHub, or any webpage - no custom endpoints needed.

## How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│  API Server  │────▶│   SQLite     │
│  (any page)  │     │  (FastAPI)    │     │  (captures)  │
└──────────────┘     └──────────────┘     └──────────────┘
                              │
                              ▼
                        ┌──────────────┐
                        │    Ollama    │
                        │  (local AI) │
                        └──────────────┘
```

**The magic:** The AI reads your captures and figures out what they are. Email, chat, article, issue - doesn't matter. Just ask.

## Quick Start

### 1. Get Gemini API Key

- Go to https://aistudio.google.com/apikey
- Create an API key
- Add it to `api-server/.env`

### 2. Start the Server

**Windows:**
```bash
start-server.bat
```

**Or manually:**
```bash
cd api-server
pip install -r requirements.txt
python server.py
```

### 3. Load Extension

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `chrome-extension` folder
4. Add your own PNG icons (icon16.png, icon48.png, icon128.png)

## Usage

### Record Your Browsing

1. Click extension icon → **Start Recording**
2. Browse normally - Gmail, ChatGPT, docs, whatever
3. Click **Stop Recording**

### Ask Questions

Click the extension and type:

- *"What were the last 5 emails about?"*
- *"Summarize the ChatGPT conversations from today"*
- *"What docs did I read about React?"*
- *"Find any TODOs from my captures"*

The AI figures out the content type automatically.

## Why Generic?

Instead of:
```
/emails     - Gmail specific
/chats      - ChatGPT specific
/issues     - GitHub specific
/docs       - Notion specific
...repeat for every site
```

We use:
```
POST /capture  - Works for EVERYTHING
```

The AI sees your content and understands what it is. Ask questions in plain English.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /capture` | Save any content (universal endpoint) |
| `POST /ask` | Ask Ollama about your captures |
| `POST /query` | Query database with SELECT |
| `GET /captures` | List recent captures |
| `GET /search` | Full-text search |
| `GET /health` | Health check with Ollama status |
| `POST /scrape` | Firecrawl scrape (optional) |
| `POST /web-search` | Search web via Firecrawl (optional) |

### Capture Anything

```bash
curl -X POST http://127.0.0.1:3000/capture \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://mail.google.com/mail/u/0/#inbox/...",
    "title": "Important meeting",
    "content": "Hey, can we reschedule...",
    "metadata": {"sender": "boss@company.com"}
  }'
```

### Ask Anything

```bash
curl -X POST http://127.0.0.1:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What emails mentioned meetings?"}'
```

Response:
```json
{
  "answer": "Based on your captures, I found 3 emails mentioning meetings...",
  "contextCount": 50,
  "provider": "ollama",
  "model": "qwen3.5"
}
```

## Database Schema

Single table, generic structure:

```sql
CREATE TABLE captures (
  id INTEGER PRIMARY KEY,
  url TEXT,           -- Where it came from
  title TEXT,         -- Page title
  content TEXT,       -- The actual content
  metadata TEXT,      -- JSON blob (flexible)
  source_type TEXT,   -- 'extension', 'firecrawl', etc
  timestamp INTEGER,
  session_id TEXT     -- Optional grouping
);
```

**No site-specific tables.** The `metadata` JSON field holds whatever is relevant:
- Gmail: `{"sender": "...", "thread_id": "..."}`
- ChatGPT: `{"conversation_id": "...", "model": "gpt-4"}`
- GitHub: `{"repo": "...", "issue_number": 123}`

Let the AI figure it out.

## Architecture

### Extension
- **background.js** - Captures pages during recording sessions
- **popup.js** - UI for recording control and asking questions

### Server (Python/FastAPI)
- Single `/capture` endpoint accepts any content
- `/ask` endpoint sends captures to Ollama with the user's question
- Ollama analyzes and responds based on what it sees

### Database
- One flexible `captures` table
- Full-text search (FTS5) across all content
- JSON metadata for extensibility

## MCP Server (Claude Desktop Integration)

To use with Claude Desktop, add to your config:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
```json
{
  "mcpServers": {
    "context-capture": {
      "command": "python",
      "args": ["C:\\path\\to\\GeodoDemo\\mcp-server\\mcp_server.py"]
    }
  }
}
```

**Available MCP Tools:**
- `query_database` - Run SELECT queries
- `search_captures` - Full-text search
- `get_recent_captures` - List recent items
- `get_stats` - Database statistics
- `analyze_content` - Filter by URL or time

## Configuration

Edit `api-server/.env`:

```env
# Ollama (required)
USE_OLLAMA=true
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5

# Firecrawl (optional)
FIRECRAWL_API_KEY=

# Server
PORT=3000
```

## Files

```
chrome-extension/
  ├── manifest.json      # Extension config
  ├── popup.html/js      # UI
  └── background.js      # Recording logic

api-server/
  ├── server.py           # FastAPI server
  ├── requirements.txt    # Python deps
  └── .env               # Configuration

mcp-server/
  ├── mcp_server.py       # MCP server for Claude Desktop
  └── requirements.txt
```

## Example Questions

The AI understands context from URLs and content:

| Question | Works because |
|----------|---------------|
| *"What did my boss email me?"* | AI sees `mail.google.com` URLs and sender metadata |
| *"Summarize my ChatGPT chats"* | AI sees `chat.openai.com` URLs and conversation content |
| *"What React issues did I look at?"* | AI sees `github.com` URLs and issue content |
| *"Find TODOs from Notion"* | AI sees `notion.so` URLs and finds "TODO" in content |
| *"What did I read about AI today?"* | AI searches content for "AI" and filters by timestamp |

## License

MIT