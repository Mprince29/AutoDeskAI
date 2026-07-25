from typing import Dict, List, Any
import json
from loguru import logger

class ContextAuditTracker:
    """
    O(1) Hashmap Context Trace mechanism for Audit Trails.
    Maps an execution thread ID (or agent task ID) to the exact Source IDs
    (e.g., Email IDs, Document IDs) retrieved during that execution.
    
    This allows the UI to instantly pinpoint (O(1) lookup) the exact sources
    the LLM used without doing slow fuzzy searches.
    """
    def __init__(self):
        # Structure: { thread_id: { "emails": ["id1", ...], "docs": ["id1", ...] } }
        self._traces: Dict[str, Dict[str, set]] = {}

    def init_thread(self, thread_id: str):
        if thread_id not in self._traces:
            self._traces[thread_id] = {
                "emails": set(),
                "docs": set(),
                "sheets": set(),
                "calendar_events": set()
            }

    def add_email_trace(self, thread_id: str, email_id: str):
        self.init_thread(thread_id)
        if email_id:
            self._traces[thread_id]["emails"].add(email_id)

    def add_doc_trace(self, thread_id: str, doc_id: str):
        self.init_thread(thread_id)
        if doc_id:
            self._traces[thread_id]["docs"].add(doc_id)
            
    def add_sheet_trace(self, thread_id: str, sheet_id: str):
        self.init_thread(thread_id)
        if sheet_id:
            self._traces[thread_id]["sheets"].add(sheet_id)
            
    def add_event_trace(self, thread_id: str, event_id: str):
        self.init_thread(thread_id)
        if event_id:
            self._traces[thread_id]["calendar_events"].add(event_id)

    def get_traces(self, thread_id: str) -> Dict[str, List[str]]:
        """Returns the O(1) hashmap trace for a given execution thread."""
        if thread_id not in self._traces:
            return {"emails": [], "docs": [], "sheets": [], "calendar_events": []}
            
        return {
            "emails": list(self._traces[thread_id]["emails"]),
            "docs": list(self._traces[thread_id]["docs"]),
            "sheets": list(self._traces[thread_id]["sheets"]),
            "calendar_events": list(self._traces[thread_id]["calendar_events"])
        }

# Global singleton
AUDIT_TRACKER = ContextAuditTracker()
