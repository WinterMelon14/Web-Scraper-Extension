#!/usr/bin/env python3
"""
MCP Server for Context Capture Database
Exposes SQLite database via Model Context Protocol
"""

import os
import sys
import json
import sqlite3
from typing import Any

# Database path - relative to this file
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "api-server", "captures.db")


def get_db():
    """Get database connection"""
    if not os.path.exists(DB_PATH):
        print(f"Database not found: {DB_PATH}", file=sys.stderr)
        print("Start the API server first to initialize the database", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row: sqlite3.Row) -> dict:
    """Convert sqlite3.Row to dict, parsing metadata JSON"""
    d = dict(row)
    if "metadata" in d and d["metadata"]:
        try:
            d["metadata"] = json.loads(d["metadata"])
        except json.JSONDecodeError:
            pass
    return d


# Tool handlers
def query_database(args: dict) -> dict:
    """Query the captures database with SELECT statements"""
    sql = args.get("sql", "")
    params = args.get("params", [])

    # Security: Only allow SELECT
    normalized = sql.strip().lower()
    if not normalized.startswith("select"):
        raise ValueError("Only SELECT queries allowed")

    # Block destructive keywords
    blocked = ["insert", "update", "delete", "drop", "alter", "create"]
    if any(b in normalized for b in blocked):
        raise ValueError("Query contains blocked keywords")

    conn = get_db()
    try:
        cursor = conn.execute(sql, params)
        rows = cursor.fetchall()
        results = [row_to_dict(r) for r in rows]
        return {"content": [{"type": "text", "text": json.dumps(results, indent=2)}]}
    finally:
        conn.close()


def search_captures(args: dict) -> dict:
    """Full-text search through captured content"""
    query = args.get("query", "")
    limit = args.get("limit", 10)

    conn = get_db()
    try:
        cursor = conn.execute(
            """
            SELECT c.*, rank
            FROM captures_fts
            JOIN captures c ON c.id = captures_fts.rowid
            WHERE captures_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (query, limit),
        )
        rows = cursor.fetchall()
        results = [row_to_dict(r) for r in rows]
        return {
            "content": [
                {"type": "text", "text": f"Found {len(results)} results:\n\n" + json.dumps(results, indent=2)}
            ]
        }
    except sqlite3.OperationalError as e:
        return {"content": [{"type": "text", "text": f"Search error: {str(e)}"}]}
    finally:
        conn.close()


def get_recent_captures(args: dict) -> dict:
    """Get recent captured content"""
    limit = args.get("limit", 20)
    domain = args.get("domain")

    conn = get_db()
    try:
        if domain:
            cursor = conn.execute(
                """
                SELECT * FROM captures
                WHERE url LIKE ?
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (f"%{domain}%", limit),
            )
        else:
            cursor = conn.execute(
                """
                SELECT * FROM captures
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (limit,),
            )
        rows = cursor.fetchall()
        results = [row_to_dict(r) for r in rows]
        return {
            "content": [
                {"type": "text", "text": f"Recent {len(results)} captures:\n\n" + json.dumps(results, indent=2)}
            ]
        }
    finally:
        conn.close()


def get_stats(args: dict) -> dict:
    """Get database statistics"""
    conn = get_db()
    try:
        count = conn.execute("SELECT COUNT(*) as count FROM captures").fetchone()
        last_capture = conn.execute(
            "SELECT timestamp FROM captures ORDER BY timestamp DESC LIMIT 1"
        ).fetchone()
        unique_sites = conn.execute(
            "SELECT COUNT(DISTINCT url) as count FROM captures"
        ).fetchone()

        stats = {
            "totalCaptures": count["count"] if count else 0,
            "lastCapture": last_capture["timestamp"] if last_capture else None,
            "uniqueUrls": unique_sites["count"] if unique_sites else 0,
        }
        return {"content": [{"type": "text", "text": json.dumps(stats, indent=2)}]}
    finally:
        conn.close()


def analyze_content(args: dict) -> dict:
    """Analyze captured content by URL pattern or time range"""
    url_pattern = args.get("url_pattern")
    since_hours = args.get("since_hours")

    conn = get_db()
    try:
        sql = "SELECT * FROM captures WHERE 1=1"
        params = []

        if url_pattern:
            sql += " AND url LIKE ?"
            params.append(url_pattern)

        if since_hours:
            import time
            cutoff = (time.time() - (since_hours * 3600)) * 1000
            sql += " AND timestamp > ?"
            params.append(int(cutoff))

        sql += " ORDER BY timestamp DESC LIMIT 50"

        cursor = conn.execute(sql, params)
        rows = cursor.fetchall()
        results = [row_to_dict(r) for r in rows]
        return {
            "content": [
                {"type": "text", "text": f"Analysis: {len(results)} matching captures\n\n" + json.dumps(results, indent=2)}
            ]
        }
    finally:
        conn.close()


# Tool definitions
TOOLS = {
    "query_database": {
        "name": "query_database",
        "description": "Query the captures database with SELECT statements",
        "inputSchema": {
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "SQL query (SELECT only)"},
                "params": {"type": "array", "description": "Query parameters", "items": {"type": "string"}},
            },
            "required": ["sql"],
        },
        "handler": query_database,
    },
    "search_captures": {
        "name": "search_captures",
        "description": "Full-text search through captured content",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "number", "description": "Max results", "default": 10},
            },
            "required": ["query"],
        },
        "handler": search_captures,
    },
    "get_recent_captures": {
        "name": "get_recent_captures",
        "description": "Get recent captured content",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "number", "description": "Number of captures to retrieve", "default": 20},
                "domain": {"type": "string", "description": "Filter by domain (optional)"},
            },
        },
        "handler": get_recent_captures,
    },
    "get_stats": {
        "name": "get_stats",
        "description": "Get database statistics",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": get_stats,
    },
    "analyze_content": {
        "name": "analyze_content",
        "description": "Analyze captured content by URL pattern or time range",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url_pattern": {"type": "string", "description": "URL pattern to match (e.g., %gmail%, %chat%)"},
                "since_hours": {"type": "number", "description": "Only include captures from last N hours"},
            },
        },
        "handler": analyze_content,
    },
}


def handle_message(message: dict) -> dict:
    """Handle an MCP message"""
    method = message.get("method")
    msg_id = message.get("id")
    params = message.get("params", {})

    try:
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "context-capture-mcp", "version": "1.0.0"},
                },
            }

        elif method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "tools": [
                        {
                            "name": t["name"],
                            "description": t["description"],
                            "inputSchema": t["inputSchema"],
                        }
                        for t in TOOLS.values()
                    ]
                },
            }

        elif method == "tools/call":
            tool_name = params.get("name")
            tool_args = params.get("arguments", {})

            tool = TOOLS.get(tool_name)
            if not tool:
                raise ValueError(f"Tool not found: {tool_name}")

            result = tool["handler"](tool_args)
            return {"jsonrpc": "2.0", "id": msg_id, "result": result}

        else:
            raise ValueError(f"Unknown method: {method}")

    except Exception as e:
        return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32603, "message": str(e)}}


def main():
    """Run the MCP server on stdin/stdout"""
    print("MCP Server: Running on stdin/stdout", file=sys.stderr)
    print("Available tools:", ", ".join(TOOLS.keys()), file=sys.stderr)

    buffer = ""
    for line in sys.stdin:
        buffer += line
        # Process complete lines
        if buffer.strip():
            try:
                message = json.loads(buffer.strip())
                response = handle_message(message)
                print(json.dumps(response), flush=True)
            except json.JSONDecodeError as e:
                print(f"Parse error: {e}", file=sys.stderr)
            buffer = ""


if __name__ == "__main__":
    main()