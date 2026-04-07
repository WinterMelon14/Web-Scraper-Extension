# Context Capture

A Chrome extension that captures content from any website and lets you ask AI questions about your browsing history.

## Features

- **Universal capture**: Works on Gmail, ChatGPT, GitHub, Notion, or any webpage
- **Smart recording**: Start/stop recording to capture pages as you browse
- **AI-powered search**: Ask questions about your captured content using Gemini
- **Full-text search**: Search across all captured content
- **Local database**: All data stored locally in SQLite

## Quick Start

### 1. Get Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create an API key
3. Add it to `api-server/.env`:

```
GEMINI_API_KEY=your-api-key-here
```

### 2. Start the Server

**Windows:**
```bash
start-server.bat
```

**Linux/Mac:**
```bash
./start-server.sh
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
4. Add PNG icons (icon16.png, icon48.png, icon128.png) to the extension folder

## Usage

1. Click the extension icon → **Start Recording**
2. Browse websites normally
3. Click **Stop Recording** when done
4. Type a question in the "Ask Claude" box to query your captures

### Example Questions

- "What emails did I read today?"
- "Summarize my ChatGPT conversations"
- "What GitHub issues did I look at?"
- "Find any TODOs in my captures"

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/stats` | GET | Database statistics |
| `/capture` | POST | Save captured content |
| `/captures` | GET | List recent captures |
| `/search` | GET | Full-text search |
| `/ask` | POST | Ask Gemini about captures |
| `/query` | POST | Run SQL SELECT query |

## Project Structure

```
GeodoDemo/
├── api-server/           # Python FastAPI backend
│   ├── server.py         # Main API server
│   ├── requirements.txt  # Python dependencies
│   └── .env              # Configuration
├── chrome-extension/     # Browser extension
│   ├── manifest.json
│   ├── background.js
│   ├── popup.html
│   └── popup.js
├── mcp-server/           # MCP server for Claude Desktop
│   └── mcp_server.py
├── start-server.bat     # Windows startup script
└── start-server.sh      # Unix startup script
```

## Configuration

Edit `api-server/.env`:

```env
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash
FIRECRAWL_API_KEY=         # Optional
PORT=3000
```

## MCP Server (Claude Desktop)

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

## License

MIT