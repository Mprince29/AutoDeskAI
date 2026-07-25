import numpy as np
import re
from typing import List, Dict, Any
from loguru import logger

# Lazy initialization of the model to avoid slow boot times
_embedding_model = None

def get_embedding_model():
    """Returns the local embedding model, loading it if necessary."""
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("Loading fast contextual embedding model (all-MiniLM-L6-v2)...")
            # This is a highly optimized, fast, and small (22MB) model perfect for semantic search 
            _embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            logger.info("Embedding model loaded successfully.")
        except ImportError:
            logger.error("sentence-transformers not installed. Context engine cannot run.")
            raise
    return _embedding_model

def chunk_text(text: str, max_words: int = 100) -> List[str]:
    """
    Splits text into highly coherent chunks (paragraphs/sentences).
    Uses regex to split by double newlines or punctuation if paragraphs are too long.
    """
    if not text:
        return []

    # Initial split by paragraphs
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    
    chunks = []
    current_chunk = []
    current_word_count = 0

    for p in paragraphs:
        words = p.split()
        if len(words) > max_words:
            # Paragraph is too long, split by sentences
            sentences = re.split(r'(?<=[.!?]) +', p)
            for s in sentences:
                s_words = s.split()
                if current_word_count + len(s_words) > max_words and current_chunk:
                    chunks.append(" ".join(current_chunk))
                    current_chunk = s_words
                    current_word_count = len(s_words)
                else:
                    current_chunk.extend(s_words)
                    current_word_count += len(s_words)
        else:
            if current_word_count + len(words) > max_words and current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = words
                current_word_count = len(words)
            else:
                current_chunk.extend(words)
                current_word_count += len(words)

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks

def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> np.ndarray:
    """Computes cosine similarity between a 1D vector and a 2D matrix of vectors."""
    dot_product = np.dot(vec_b, vec_a)
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b, axis=1)
    # Avoid division by zero
    similarity = dot_product / (norm_a * norm_b + 1e-10)
    return similarity

def extract_relevant_context(query: str, text: str, top_k: int = 3) -> List[Dict[str, Any]]:
    """
    Vectorized "DNA" Extraction:
    Parses a large document, embeds chunks, and uses K-Nearest Neighbors (cosine sim)
    to find the most semantically relevant paragraphs to the query.
    O(N * D) speed, skipping remote LLM token bloat entirely.
    """
    if not text.strip() or not query.strip():
        return []

    chunks = chunk_text(text)
    if not chunks:
        return []

    model = get_embedding_model()

    # Create embeddings (vectorization)
    logger.debug(f"Vectorizing {len(chunks)} chunks for semantic search...")
    chunk_embeddings = model.encode(chunks, convert_to_numpy=True)
    query_embedding = model.encode(query, convert_to_numpy=True)

    # Compute similarity efficiently
    similarities = cosine_similarity(query_embedding, chunk_embeddings)

    # Get top K indices
    # Using argpartition is O(N) rather than full sorted O(N log N)
    k = min(top_k, len(chunks))
    top_indices = np.argpartition(similarities, -k)[-k:]
    # Sort the top K by score descending
    top_indices = top_indices[np.argsort(similarities[top_indices])[::-1]]

    results = []
    for idx in top_indices:
        results.append({
            "text": chunks[idx],
            "score": float(similarities[idx])
        })

    return results
