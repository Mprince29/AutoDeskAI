import asyncio
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from loguru import logger

from mcp_servers.core.google_auth import GoogleAuthManager
from services.context_engine import extract_relevant_context

router = APIRouter()

class SemanticSearchRequest(BaseModel):
    user_email: str
    document_id: str
    query: str = Field(..., description="The concept or requirement to search for within the document")
    top_k: int = Field(3, description="Number of most relevant paragraphs to return")

@router.post("/extract_template_structure")
async def extract_template_structure(req: SemanticSearchRequest):
    """
    Vectorized Semantic Search Tool:
    Downloads an entire Google Doc/Slide and uses fast local embeddings (KNN/Cosine Similarity)
    to instantly return the most relevant "DNA" chunks matching the query, saving LLM tokens.
    """
    try:
        # 1. Fetch document text
        service, _ = await GoogleAuthManager.get_service_async("docs", "v1", req.user_email)
        
        # O(1) Cached or Network Fetch 
        # Note: We rely on the caching at the service layer or just fetch it raw for now
        doc = await asyncio.to_thread(service.documents().get(documentId=req.document_id).execute)
        
        # Extract plain text from Google Doc
        text_content = ""
        for structuralElement in doc.get('body', {}).get('content', []):
            if 'paragraph' in structuralElement:
                for element in structuralElement['paragraph'].get('elements', []):
                    if 'textRun' in element:
                        text_content += element['textRun'].get('content', '')

        if not text_content.strip():
            return {"success": False, "error": "Document is empty or could not be parsed."}

        # 2. Semantic KNN Extraction
        logger.info(f"Extracting DNA from doc {req.document_id} for query: '{req.query}'")
        relevant_chunks = extract_relevant_context(
            query=req.query, 
            text=text_content, 
            top_k=req.top_k
        )

        return {
            "success": True,
            "query": req.query,
            "chunks_extracted": len(relevant_chunks),
            "results": relevant_chunks
        }
        
    except Exception as e:
        logger.error(f"Semantic Extraction Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
