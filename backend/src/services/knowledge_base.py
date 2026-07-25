import os
import asyncio
from typing import List, Dict, Any, Optional
from pathlib import Path
from datetime import datetime
from loguru import logger
from dataclasses import dataclass
import uuid
import chromadb

@dataclass(frozen=True)
class IngestJob:
    agent_id: int
    doc_id: int
    file_path: Path
    filename: str
    user_id: int

class KnowledgeBase:
    """
    Auto-Ingest RAG Pipeline (v2 - Industry Grade).
    Extracts, chunks, embeds, and indexes document content for agent-specific RAG.
    """
    
    _instance: Optional['KnowledgeBase'] = None
    _queue: asyncio.Queue = asyncio.Queue()
    _worker_task: Optional[asyncio.Task] = None
    _chroma_client = None

    @classmethod
    def get_chroma_client(cls):
        if cls._chroma_client is None:
            host = os.environ.get("CHROMA_HOST")
            if host:
                port = os.environ.get("CHROMA_PORT", "8000")
                cls._chroma_client = chromadb.HttpClient(host=host, port=port)
            else:
                db_path = os.environ.get("CHROMADB_PATH", "./chroma_db")
                cls._chroma_client = chromadb.PersistentClient(path=db_path)
        return cls._chroma_client

    @classmethod
    def init_worker(cls, session_factory):
        """Initialize the single instance with a DB session factory."""
        if not cls._instance:
            cls._instance = cls(session_factory())

    @classmethod
    async def start_worker(cls):
        """Starts the background ingest worker as a singleton task."""
        if cls._instance and cls._worker_task is None:
            cls._worker_task = asyncio.create_task(cls._instance._ingest_worker())

    @classmethod
    def enqueue_ingest(cls, job: IngestJob):
        """Static entry point for routes to queue a job."""
        cls._queue.put_nowait(job)
        logger.info(f"Enqueued RAG ingest for doc {job.doc_id}")

    @classmethod
    async def retrieve(cls, query: str, agent_id: int, top_k: int = 5) -> List[Dict[str, Any]]:
        """Static entry point for AgentExecutor to perform similarity search."""
        logger.debug(f"Retrieving knowledge for agent {agent_id} | query: {query[:50]}...")
        
        try:
            client = cls.get_chroma_client()
            # Wrap synchronous Chroma query in a thread
            def _query_chroma():
                collection = client.get_collection(f"agent_{agent_id}")
                return collection.query(query_texts=[query], n_results=top_k)
                
            results = await asyncio.to_thread(_query_chroma)
            
            if not results["documents"] or not results["documents"][0]:
                return []
                
            chunks = []
            for i in range(len(results["documents"][0])):
                # Chroma may return distances instead of similarity scores. Lower is closer.
                distance = results["distances"][0][i] if "distances" in results and results["distances"] and results["distances"][0] else 0.0
                score = max(0.0, 1.0 - distance)
                
                meta = results["metadatas"][0][i] if "metadatas" in results and results["metadatas"] and results["metadatas"][0] else {"agent_id": agent_id}
                
                chunks.append({
                    "content": results["documents"][0][i],
                    "score": score,
                    "metadata": meta,
                    "source": meta.get("source", "Unknown")
                })
            return chunks
        except Exception as e:
            logger.debug(f"Chroma retrieval returned no results (collection might not exist): {e}")
            return []

    @staticmethod
    def format_context(chunks: List[Dict[str, Any]]) -> str:
        """Formats retrieved chunks into a system prompt block for LLM guidance."""
        if not chunks:
            return ""
        
        header = "═══════════════════════════════════════════════════════════\n"
        header += "REFERENCE CONTEXT FROM UPLOADED KNOWLEDGE DOCUMENTS\n"
        header += "═══════════════════════════════════════════════════════════\n"
        
        body = "\n\n".join([f"CONTEXT CHUNK:\n{c['content']}" for c in chunks])
        footer = "\n\n(End of reference context. Use this for style and factual guidance.)"
        
        return f"{header}{body}{footer}"

    def __init__(self, db_session):
        self.db = db_session

    async def _ingest_worker(self):
        """Background worker that processes documents sequentially."""
        while True:
            job = await self._queue.get()
            try:
                await self._process_document(job.agent_id, job.doc_id, str(job.file_path))
            except Exception as e:
                logger.error(f"Failed to process document {job.doc_id}: {e}")
                self._update_doc_status(job.doc_id, "failed", error_message=str(e))
            finally:
                self._queue.task_done()

    async def _process_document(self, agent_id: int, doc_id: int, file_path: str):
        """Extracts text, chunks it, and 'indexes' it (simulated)."""
        from routes.document_routes import _parse_file # Reuse existing extractor
        
        self._update_doc_status(doc_id, "processing")
        
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        # Yield to event loop to allow API requests to process
        await asyncio.sleep(0.05)
        text = await asyncio.to_thread(_parse_file, path)
        if not text:
            raise ValueError("No text extracted from document")
            
        chunks = self._chunk_text(text)
        
        def _index_chroma():
            client = self.get_chroma_client()
            collection = client.get_or_create_collection(f"agent_{agent_id}")
            metadatas = [{"agent_id": agent_id, "doc_id": doc_id, "source": path.name} for _ in range(len(chunks))]
            ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
            collection.add(documents=chunks, metadatas=metadatas, ids=ids)
            
        await asyncio.to_thread(_index_chroma)
        
        logger.info(f"Successfully indexed {len(chunks)} chunks for agent {agent_id} from {path.name}")
        self._update_doc_status(doc_id, "indexed", chunk_count=len(chunks))

        # Check if agent was already marked has_rag; if not, update it
        from models import AIAgent
        agent = self.db.query(AIAgent).filter(AIAgent.id == agent_id).first()
        if agent and not agent.has_rag:
            agent.has_rag = True
            self.db.commit()

    def _chunk_text(self, text: str, size: int = 1000, overlap: int = 200) -> List[str]:
        """Simple recursive-style chunking."""
        chunks = []
        if not text: return chunks
        
        start = 0
        while start < len(text):
            end = start + size
            chunks.append(text[start:end])
            if end >= len(text): break
            start += (size - overlap)
        return chunks

    def _update_doc_status(self, doc_id: int, status: str, chunk_count: int = 0, error_message: Optional[str] = None):
        """Updates the status in the main sqlite database."""
        from models import AgentKnowledgeDoc
        doc = self.db.query(AgentKnowledgeDoc).filter(AgentKnowledgeDoc.id == doc_id).first()
        if doc:
            doc.status = status
            doc.chunk_count = chunk_count
            if hasattr(doc, 'error_message'):
                doc.error_message = error_message
            self.db.commit()

    @classmethod
    def delete_agent_knowledge(cls, agent_id: int):
        """Cleans up all files and vector store data for an agent."""
        try:
            client = cls.get_chroma_client()
            client.delete_collection(f"agent_{agent_id}")
            logger.info(f"Cleaned up knowledge base collection for agent {agent_id}")
        except Exception as e:
            logger.debug(f"Knowledge base cleanup ignored: {e}")
