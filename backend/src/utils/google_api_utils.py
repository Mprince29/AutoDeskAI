import asyncio
from typing import Any, TypeVar
from googleapiclient.errors import HttpError
from google.auth.exceptions import RefreshError
from fastapi import HTTPException
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception
from loguru import logger

T = TypeVar("T")

def is_retryable_google_error(exception: Exception) -> bool:
    """Predicate to determine if a Google API error should be retried."""
    if isinstance(exception, HttpError):
        # 429: Too Many Requests
        # 500, 502, 503, 504: Server errors
        if exception.resp.status in [429, 500, 502, 503, 504]:
            logger.warning(f"Google API error {exception.resp.status}: {exception.reason}. Retrying...")
            return True
    return False

@retry(
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception(is_retryable_google_error),
    reraise=True
)
def execute_with_retry(request: Any) -> Any:
    """Execute a Google API request with synchronous exponential backoff retries."""
    try:
        return request.execute()
    except RefreshError as e:
        logger.error(f"Google Token Refresh Error: {e}")
        raise HTTPException(
            status_code=401,
            detail="Google access has expired or is invalid. Please reconnect your account."
        )

async def execute_with_retry_async(request: Any) -> Any:
    """
    Execute a Google API request in a background thread with exponential backoff retries.
    Use this for async endpoints to avoid blocking the event loop.
    """
    return await asyncio.to_thread(execute_with_retry, request)
