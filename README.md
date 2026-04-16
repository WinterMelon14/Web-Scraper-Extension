# Context Capture

A Chrome extension that captures content from any website, extracts contacts from Gmail and LinkedIn, and lets you ask AI questions about your browsing history.

## Features

- **Universal capture**: Works on Gmail, ChatGPT, GitHub, Notion, or any webpage
- **Smart recording**: Start/stop recording to capture pages as you browse
- **Contact extraction**: Automatically extracts contacts from Gmail emails and LinkedIn profiles
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
2. Browse websites normally — pages are captured automatically
3. Visit Gmail or LinkedIn profiles to capture contacts
4. Click **Stop Recording** when done
5. Type a question in the **Ask Gemini** box to query your captures
6. Switch to the **Contacts** tab to browse extracted contacts

### Example Questions

- "What emails did I read today?"
- "Summarize my ChatGPT conversations"
- "What GitHub issues did I look at?"
- "Find any TODOs in my captures"

## API Endpoints

### Captures

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/stats` | GET | Database statistics |
| `/capture` | POST | Save captured content |
| `/captures` | GET | List recent captures |
| `/search` | GET | Full-text search |
| `/ask` | POST | Ask Gemini about captures |
| `/query` | POST | Run SQL SELECT query |

### Contacts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/contacts` | GET | List contacts (supports `search` and `company` filters) |
| `/contacts` | POST | Create or merge a contact |
| `/contacts/{id}` | GET | Get a single contact |
| `/contacts/{id}` | PUT | Update a contact |
| `/contacts/{id}` | DELETE | Delete a contact |
| `/contacts/{id}/summary` | GET | AI-generated summary of a contact |

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
│   ├── content.js
│   ├── popup.html
│   └── popup.js
├── mcp-server/           # MCP server for Claude Desktop
│   └── mcp_server.py
├── start-server.bat      # Windows startup script
└── start-server.sh       # Unix startup script
```

## Configuration

Edit `api-server/.env`:

```env
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash
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
