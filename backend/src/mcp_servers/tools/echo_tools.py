from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class EchoRequest(BaseModel):
    message: str

@router.post("/echo")
async def echo_message(req: EchoRequest):
    """A simple echo tool to verify extensibility."""
    return {"response": f"Echo Agent says: {req.message}"}
