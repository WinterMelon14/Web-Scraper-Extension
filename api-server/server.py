"""
Context Capture API Server - Python/FastAPI
Generic capture system - works with any website, AI extracts meaning
"""

import os
import json
import sqlite3
import time
from datetime import datetime
from typing import Optional, Any
from contextlib import contextmanager

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environment
load_dotenv()

# Config
PORT = int(os.getenv("PORT", 3000))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY", "")

# Database path
DB_PATH = os.path.join(os.path.dirname(__file__), "captures.db")

# Gemini client
import google.generativeai as genai
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    gemini_model = genai.GenerativeModel(GEMINI_MODEL)
else:
    gemini_model = None

# Firecrawl client
try:
    from firecrawl import FirecrawlApp
    firecrawl_client = FirecrawlApp(api_key=FIRECRAWL_API_KEY) if FIRECRAWL_API_KEY else None
except ImportError:
    firecrawl_client = None

# FastAPI app
app = FastAPI(title="Context Capture API", version="1.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Database ---

def init_db():
    """Initialize SQLite database with generic schema"""
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS captures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            title TEXT,
            content TEXT,
            metadata TEXT,
            source_type TEXT,
            timestamp INTEGER NOT NULL,
            session_id TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_captures_timestamp ON captures(timestamp);
        CREATE INDEX IF NOT EXISTS idx_captures_url ON captures(url);
        CREATE INDEX IF NOT EXISTS idx_captures_session ON captures(session_id);

        -- Full-text search
        CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
            title, content,
            content='captures',
            content_rowid='id'
        );
    """)
    conn.commit()
    conn.close()
    print("Database initialized")


@contextmanager
def get_db():
    """Get database connection with context manager"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row) -> dict:
    """Convert sqlite3.Row to dict, parsing metadata JSON"""
    d = dict(row)
    if "metadata" in d and d["metadata"]:
        try:
            d["metadata"] = json.loads(d["metadata"])
        except json.JSONDecodeError:
            pass
    return d


# --- Pydantic Models ---

class CaptureRequest(BaseModel):
    url: str
    title: Optional[str] = ""
    content: Optional[str] = ""
    metadata: Optional[Any] = {}
    source_type: Optional[str] = "extension"
    timestamp: Optional[int] = None
    session_id: Optional[str] = None


class QueryRequest(BaseModel):
    sql: str
    params: Optional[list] = []


class AskRequest(BaseModel):
    question: str
    limit: Optional[int] = 50


class ScrapeRequest(BaseModel):
    url: str
    options: Optional[dict] = {}
    session_id: Optional[str] = None


class WebSearchRequest(BaseModel):
    query: str
    limit: Optional[int] = 5
    save_results: Optional[bool] = False


# --- Endpoints ---

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "ok",
        "timestamp": int(time.time() * 1000),
        "services": {
            "gemini": gemini_model is not None,
            "firecrawl": firecrawl_client is not None,
        },
        "config": {
            "llm_provider": "gemini",
            "gemini_model": GEMINI_MODEL,
        },
    }


@app.get("/stats")
async def stats():
    """Get database statistics"""
    with get_db() as db:
        count = db.execute("SELECT COUNT(*) as count FROM captures").fetchone()
        last_capture = db.execute(
            "SELECT timestamp FROM captures ORDER BY timestamp DESC LIMIT 1"
        ).fetchone()
        unique_sites = db.execute(
            "SELECT COUNT(DISTINCT url) as count FROM captures"
        ).fetchone()

    return {
        "totalCaptures": count["count"] if count else 0,
        "lastCapture": last_capture["timestamp"] if last_capture else None,
        "uniqueUrls": unique_sites["count"] if unique_sites else 0,
    }


@app.post("/capture")
async def capture(req: CaptureRequest):
    """Save captured content"""
    timestamp = req.timestamp or int(time.time() * 1000)

    # Handle metadata - can be dict or string
    metadata = req.metadata
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            metadata = {}
    elif metadata is None:
        metadata = {}

    with get_db() as db:
        cursor = db.execute(
            """
            INSERT INTO captures (url, title, content, metadata, source_type, timestamp, session_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                req.url,
                req.title or "",
                req.content or "",
                json.dumps(metadata),
                req.source_type,
                timestamp,
                req.session_id,
            ),
        )
        last_id = cursor.lastrowid
        db.commit()

        # Update FTS
        db.execute(
            "INSERT INTO captures_fts (rowid, title, content) VALUES (?, ?, ?)",
            (last_id, req.title or "", req.content or ""),
        )
        db.commit()

    return {"success": True, "id": last_id}


@app.get("/captures")
async def list_captures(limit: int = Query(20), session_id: Optional[str] = None):
    """List recent captures"""
    with get_db() as db:
        if session_id:
            rows = db.execute(
                """
                SELECT * FROM captures
                WHERE session_id = ?
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()
        else:
            rows = db.execute(
                """
                SELECT * FROM captures
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    return {"results": [row_to_dict(r) for r in rows]}


@app.get("/search")
async def search(q: Optional[str] = None, limit: int = Query(20)):
    """Full-text search"""
    if not q:
        return {"results": []}

    with get_db() as db:
        try:
            rows = db.execute(
                """
                SELECT c.*, rank
                FROM captures_fts
                JOIN captures c ON c.id = captures_fts.rowid
                WHERE captures_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (q, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            # FTS query syntax error
            return {"results": []}

    return {"results": [row_to_dict(r) for r in rows]}


@app.post("/query")
async def query(req: QueryRequest):
    """Run SELECT query on database"""
    normalized = req.sql.trim().lower()

    # Security checks
    if not normalized.startswith("select"):
        raise HTTPException(status_code=403, detail="Only SELECT queries allowed")

    blocked = ["insert", "update", "delete", "drop", "alter", "create", "attach"]
    if any(b in normalized for b in blocked):
        raise HTTPException(status_code=403, detail="Query contains blocked keywords")

    with get_db() as db:
        try:
            rows = db.execute(req.sql, req.params).fetchall()
        except sqlite3.Error as e:
            raise HTTPException(status_code=500, detail=str(e))

    return {"results": [row_to_dict(r) for r in rows], "count": len(rows)}


async def ask_gemini(question: str, context: str) -> str:
    """Call Gemini API"""
    if not gemini_model:
        raise HTTPException(
            status_code=503,
            detail="Gemini API not configured. Set GEMINI_API_KEY in .env"
        )

    system_prompt = """You are an AI assistant analyzing a user's captured web browsing data.

The user has captured content from various websites. Your job is to:
1. Analyze the question and the provided context
2. Answer based on what you see in the captures
3. Let the user know if the answer isn't in their captured data

Content could be from any source - emails, articles, chats, docs, code, etc.
Look at the URLs and content to understand what each capture represents.
Be concise and helpful."""

    full_prompt = f"""{system_prompt}

Current time: {datetime.now().isoformat()}

--- CAPTURED CONTENT ---

{context}

---

Question: {question}

Answer based on the captured content above. Be concise."""

    try:
        response = gemini_model.generate_content(
            full_prompt,
            generation_config={
                "temperature": 0.7            }
        )
        print(response.text)
        return response.text
    except Exception as e:
        print(e)
        raise HTTPException(
            status_code=500,
            detail=f"Gemini API error: {str(e)}"
        )




@app.post("/ask")
async def ask(req: AskRequest):
    """Ask Gemini about captured data"""
    with get_db() as db:
        rows = db.execute(
            """
            SELECT url, title, content, metadata, timestamp, source_type
            FROM captures
            ORDER BY timestamp DESC
            LIMIT ?
            """,
            (req.limit,),
        ).fetchall()

    captures = [row_to_dict(r) for r in rows]

    if len(captures) == 0:
        return {
            "answer": "No captures found in the database. Start recording and browse some pages first.",
            "contextCount": 0,
            "provider": "gemini",
            "model": GEMINI_MODEL,
        }

    # Build context
    context_parts = [f"You have access to {len(captures)} captured content items."]
    context_parts.append("Each capture includes URL, title, content, and metadata.")
    context_parts.append("\n--- CAPTURED CONTENT ---\n")

    for i, c in enumerate(captures, 1):
        try:
            from urllib.parse import urlparse
            domain = urlparse(c["url"]).hostname
        except:
            domain = "unknown"

        context_parts.append(f"[{i}] {c.get('title') or 'Untitled'}")
        context_parts.append(f"    URL: {c['url']}")
        context_parts.append(f"    Domain: {domain}")
        context_parts.append(f"    Time: {datetime.fromtimestamp(c['timestamp']/1000).isoformat()}")

        metadata = c.get("metadata", {})
        if metadata and isinstance(metadata, dict) and metadata:
            context_parts.append(f"    Metadata: {json.dumps(metadata)}")

        content = c.get("content") or ""
        content_preview = content[:800]
        if content_preview:
            suffix = "..." if len(content) > 800 else ""
            context_parts.append(f"    Content: {content_preview}{suffix}")
        context_parts.append("")

    context = "\n".join(context_parts)

    print(f"Using Gemini ({GEMINI_MODEL}) for query...")
    answer = await ask_gemini(req.question, context)

    return {
        "answer": answer,
        "contextCount": len(captures),
        "provider": "gemini",
        "model": GEMINI_MODEL,
    }


@app.post("/scrape")
async def scrape(req: ScrapeRequest):
    """Scrape URL using Firecrawl"""
    if not firecrawl_client:
        return {"success": False, "error": "Firecrawl not configured"}

    try:
        result = firecrawl_client.scrape_url(
            req.url,
            formats=["markdown", "html"],
        )

        if result:
            # Save to database
            url = result.get("metadata", {}).get("sourceURL", req.url)
            title = result.get("metadata", {}).get("title", "")
            content = result.get("markdown", result.get("text", ""))

            with get_db() as db:
                cursor = db.execute(
                    """
                    INSERT INTO captures (url, title, content, metadata, source_type, timestamp, session_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        url,
                        title,
                        content,
                        json.dumps(result.get("metadata", {})),
                        "firecrawl",
                        int(time.time() * 1000),
                        req.session_id,
                    ),
                )
                last_id = cursor.lastrowid
                db.commit()

                # Update FTS
                db.execute(
                    "INSERT INTO captures_fts (rowid, title, content) VALUES (?, ?, ?)",
                    (last_id, title, content),
                )
                db.commit()

            return {
                "success": True,
                "source": "firecrawl",
                "url": url,
                "title": title,
                "content": content,
                "savedId": last_id,
            }
    except Exception as e:
        print(f"Firecrawl error: {e}")

    return {"success": False, "error": "Scraping failed"}


@app.post("/web-search")
async def web_search(req: WebSearchRequest):
    """Search web using Firecrawl"""
    if not firecrawl_client:
        return {"success": False, "error": "Firecrawl not configured"}

    try:
        result = firecrawl_client.search(req.query, limit=req.limit)

        if result and result.get("data"):
            results = result["data"]

            if req.save_results:
                with get_db() as db:
                    for item in results:
                        try:
                            db.execute(
                                """
                                INSERT INTO captures (url, title, content, metadata, source_type, timestamp)
                                VALUES (?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    item.get("url", item.get("metadata", {}).get("sourceURL", "")),
                                    item.get("title", item.get("metadata", {}).get("title", "")),
                                    item.get("markdown", item.get("content", "")),
                                    json.dumps(item.get("metadata", {})),
                                    "web_search",
                                    int(time.time() * 1000),
                                ),
                            )
                            db.commit()
                        except Exception as e:
                            print(f"Failed to save result: {e}")

            return {"success": True, "source": "firecrawl", "results": results}
    except Exception as e:
        print(f"Search error: {e}")

    return {"success": False, "error": "Search failed"}


# --- Startup ---

@app.on_event("startup")
async def startup():
    init_db()
    print(f"\n🚀 Context Capture API running on http://127.0.0.1:{PORT}")
    print(f"Database: {DB_PATH}")
    print("\n📡 Services:")
    print(f"  {'✅' if gemini_model else '⚠️'} Gemini: {f'Enabled ({GEMINI_MODEL})' if gemini_model else 'Not configured'}")
    print(f"  {'✅' if firecrawl_client else '⚠️'} Firecrawl: {'Enabled' if firecrawl_client else 'Not configured'}")
    print("\n🔌 Endpoints:")
    print("  GET  /health          - Health check")
    print("  GET  /stats           - Database stats")
    print("  POST /capture         - Save any content")
    print("  POST /scrape          - Firecrawl scrape URL")
    print("  POST /web-search      - Firecrawl web search")
    print("  POST /ask             - Ask Gemini about captures")
    print("  POST /query           - Query database (SELECT only)")
    print("  GET  /captures        - List captures")
    print("  GET  /search          - Full-text search")
    print("\n💡 The AI figures out content type - no custom endpoints needed!\n")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT)