# Installation Guide

## Prerequisites

- Node.js 18+ installed
- Chrome browser
- Anthropic API key (for Claude): https://console.anthropic.com/
- Firecrawl API key (optional): https://firecrawl.dev

## Step 1: Install Dependencies

```bash
cd api-server
npm install
```

## Step 2: Configure Environment

Create `.env` file in `api-server/`:

```bash
ANTHROPIC_API_KEY=your-anthropic-key
FIRECRAWL_API_KEY=your-firecrawl-key  # optional
```

On Windows:
```cmd
cd api-server
echo ANTHROPIC_API_KEY=your-key > .env
echo FIRECRAWL_API_KEY=your-key >> .env
```

## Step 3: Start the Server

```bash
npm start
```

Or use the start scripts:
- Windows: `start-server.bat` (in root folder)
- macOS/Linux: `./start-server.sh`

You should see:
```
Context Capture API server running on http://localhost:3000
✅ Firecrawl: Enabled (or ⚠️ if no key)
✅ Claude: Enabled
```

Test it: http://localhost:3000/health

## Step 4: Load Chrome Extension

1. Open Chrome → `chrome://extensions/`
2. Toggle "Developer mode" ON
3. Click "Load unpacked"
4. Select the `chrome-extension` folder
5. Pin the extension (click puzzle icon → pin)

## Step 5: Test It

### Start Recording
1. Click the extension icon
2. Click **"Start Recording"**
3. Status changes to "Recording" with red pulse

### Browse and Capture
4. Visit any websites - Gmail, ChatGPT, GitHub, docs
5. Each page is automatically captured
6. See stats update: captured count, duration, domains

### Ask Questions
7. In the popup, type a question like:
   - *"What were the last 5 emails about?"*
   - *"Summarize what I read about React"*
   - *"What did I capture from ChatGPT?"*
8. Click **"Ask Claude"**
9. Claude analyzes your captures and answers

## How to Use

**The key insight:** Just browse normally. The extension captures whatever you see. Claude figures out what it is.

| You browse | You ask |
|------------|---------|
| Gmail emails | "What emails mentioned meetings?" |
| ChatGPT chats | "Summarize my conversations today" |
| GitHub issues | "What bugs did I look at?" |
| Notion docs | "Find my TODOs" |
| Any article | "What did I read about AI?" |

## Troubleshooting

### "Cannot connect to server"

1. Is the server running? `npm start` in `api-server/`
2. Check `http://localhost:3000/health`
3. Check firewall isn't blocking port 3000

### "Claude not configured"

Set your API key:
```bash
cd api-server
set ANTHROPIC_API_KEY=your-key  # Windows
export ANTHROPIC_API_KEY=your-key  # macOS/Linux
npm start
```

### Extension won't load

1. Did you select the `chrome-extension` folder (not the parent)?
2. Check `manifest.json` exists
3. Check Chrome console for errors

## Updating

After code changes:
1. Server: stops and restarts automatically (if using `npm run dev`)
2. Extension: click refresh icon at `chrome://extensions/`

## Architecture

```
Browser (any site)
    ↓
Content script (extracts generic text)
    ↓
Background (sends to server)
    ↓
POST /capture (one universal endpoint)
    ↓
SQLite (stores URL, title, content, metadata JSON)
    ↓
POST /ask (Claude analyzes)
```

No custom endpoints. No site-specific code. Just capture and ask.
