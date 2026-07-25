"""
Personal Librarian Tools - Phase 3
Semantic search and Q&A over the agent's indexed knowledge base (ChromaDB RAG).
All tools are self-contained - no external credentials required.
"""

import os
from typing import Any, Dict, List, Optional

from loguru import logger

from mcp_servers.core.mcp_tools import mcp_tool


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp_tool(
    name="semantic_search_knowledge",
    description=(
        "Perform semantic similarity search across all indexed documents in the agent's "
        "knowledge base. Returns the top-k most relevant text chunks with source info."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Natural language search query."},
            "agent_id": {"type": "integer", "description": "ID of the agent whose knowledge base to search."},
            "top_k": {"type": "integer", "description": "Number of results to return (default 5)."},
        },
        "required": ["query", "agent_id"],
    },
    provider="all",
    category="librarian",
    approval_required=False,
    credentials_required=False,
)
async def tool_semantic_search_knowledge(
    user_email: str, db, query: str, agent_id: int, top_k: int = 5
) -> dict:
    try:
        from services.knowledge_base import KnowledgeBase
        chunks = await KnowledgeBase.retrieve(query, agent_id, top_k)
        return {
            "query": query,
            "agent_id": agent_id,
            "chunks": chunks,
            "count": len(chunks),
        }
    except Exception as e:
        return {"error": f"Knowledge base search failed: {e}"}


@mcp_tool(
    name="list_indexed_docs",
    description="List all documents currently indexed in an agent's knowledge base with their status and metadata.",
    parameters={
        "type": "object",
        "properties": {
            "agent_id": {"type": "integer", "description": "ID of the agent."},
        },
        "required": ["agent_id"],
    },
    provider="all",
    category="librarian",
    approval_required=False,
    credentials_required=False,
)
async def tool_list_indexed_docs(user_email: str, db, agent_id: int) -> dict:
    try:
        from auth.models import AgentKnowledgeDoc
        docs = (
            db.query(AgentKnowledgeDoc)
            .filter(AgentKnowledgeDoc.agent_id == agent_id)
            .order_by(AgentKnowledgeDoc.created_at.desc())
            .all()
        )
        return {
            "agent_id": agent_id,
            "documents": [
                {
                    "id": d.id,
                    "filename": d.filename,
                    "size_bytes": d.size_bytes,
                    "status": d.status,
                    "chunk_count": d.chunk_count,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                    "indexed_at": d.indexed_at.isoformat() if d.indexed_at else None,
                }
                for d in docs
            ],
            "total": len(docs),
        }
    except Exception as e:
        return {"error": f"Failed to list indexed docs: {e}"}


@mcp_tool(
    name="get_document_summary",
    description="Return the metadata and chunk count for a specific indexed document by its ID.",
    parameters={
        "type": "object",
        "properties": {
            "doc_id": {"type": "integer", "description": "AgentKnowledgeDoc database ID."},
        },
        "required": ["doc_id"],
    },
    provider="all",
    category="librarian",
    approval_required=False,
    credentials_required=False,
)
async def tool_get_document_summary(user_email: str, db, doc_id: int) -> dict:
    try:
        from auth.models import AgentKnowledgeDoc
        doc = db.query(AgentKnowledgeDoc).filter(AgentKnowledgeDoc.id == doc_id).first()
        if not doc:
            return {"error": f"Document with id={doc_id} not found."}
        return {
            "id": doc.id,
            "filename": doc.filename,
            "size_bytes": doc.size_bytes,
            "status": doc.status,
            "chunk_count": doc.chunk_count,
            "error_message": doc.error_message,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "indexed_at": doc.indexed_at.isoformat() if doc.indexed_at else None,
        }
    except Exception as e:
        return {"error": f"Failed to get document summary: {e}"}


@mcp_tool(
    name="search_by_filename",
    description="Find indexed documents whose filename contains the search term (case-insensitive).",
    parameters={
        "type": "object",
        "properties": {
            "filename_query": {"type": "string", "description": "Partial filename to search for."},
            "agent_id": {"type": "integer", "description": "ID of the agent."},
        },
        "required": ["filename_query", "agent_id"],
    },
    provider="all",
    category="librarian",
    approval_required=False,
    credentials_required=False,
)
async def tool_search_by_filename(
    user_email: str, db, filename_query: str, agent_id: int
) -> dict:
    try:
        from auth.models import AgentKnowledgeDoc
        docs = (
            db.query(AgentKnowledgeDoc)
            .filter(
                AgentKnowledgeDoc.agent_id == agent_id,
                AgentKnowledgeDoc.filename.ilike(f"%{filename_query}%"),
            )
            .all()
        )
        return {
            "query": filename_query,
            "matches": [
                {
                    "id": d.id,
                    "filename": d.filename,
                    "status": d.status,
                    "size_bytes": d.size_bytes,
                }
                for d in docs
            ],
            "total": len(docs),
        }
    except Exception as e:
        return {"error": f"Filename search failed: {e}"}


@mcp_tool(
    name="ask_document",
    description=(
        "Ask a natural language question against the agent's indexed knowledge base. "
        "Returns an LLM-synthesized answer with source document citations. "
        "Always search knowledge base before answering from memory."
    ),
    parameters={
        "type": "object",
        "properties": {
            "question": {"type": "string", "description": "Natural language question to answer."},
            "agent_id": {"type": "integer", "description": "ID of the agent whose knowledge base to query."},
            "top_k": {"type": "integer", "description": "Number of context chunks to retrieve (default 6)."},
        },
        "required": ["question", "agent_id"],
    },
    provider="all",
    category="librarian",
    approval_required=False,
    credentials_required=False,
)
async def tool_ask_document(
    user_email: str, db, question: str, agent_id: int, top_k: int = 6
) -> dict:
    try:
        from services.knowledge_base import KnowledgeBase
        chunks = await KnowledgeBase.retrieve(question, agent_id, top_k)

        if not chunks:
            return {
                "answer": "No indexed documents found for this agent. Please upload and index documents first.",
                "sources": [],
            }

        context = KnowledgeBase.format_context(chunks)
        sources = list({c.get("source", "Unknown") for c in chunks if isinstance(c, dict)})

        from litellm import acompletion
        from utils.llm_router import _resolve_model, _api_key_for, _max_tokens_key, _sanitize_kwargs
        model = _resolve_model("drafter")
        api_key = _api_key_for(model)

        _kwargs = {
            "model": model,
            "api_key": api_key,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a precise research librarian. Answer ONLY from the provided context. "
                        "If the answer is not in the context, say 'Not found in the indexed documents.' "
                        "Cite the source document name when referencing information.\n\n"
                        f"CONTEXT:\n{context}"
                    ),
                },
                {"role": "user", "content": question},
            ],
            _max_tokens_key(model): 1000,
            "temperature": 0.1,
        }
        _kwargs = _sanitize_kwargs(model, _kwargs)
        resp = await acompletion(**_kwargs)
        answer = resp.choices[0].message.content.strip()
        return {"answer": answer, "sources": sources, "chunks_used": len(chunks)}

    except Exception as e:
        return {"error": f"ask_document failed: {e}"}
