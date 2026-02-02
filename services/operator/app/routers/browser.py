"""Browser automation API endpoints."""

from fastapi import APIRouter
from loguru import logger

from app.models import ChatRequest, ChatResponse, TokenUsage
from app.services import get_browser_service

router = APIRouter(prefix="/api/v1", tags=["browser"])


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """
    Send a message to OpenCode with Playwright MCP for browser automation.

    OpenCode will use Playwright MCP tools to browse the web, search for
    information, interact with websites, and complete tasks autonomously.
    """
    try:
        service = get_browser_service()
        result = await service.chat(
            message=request.message,
            max_turns=request.max_turns,
        )

        token_usage = None
        if result.get("token_usage"):
            token_usage = TokenUsage(**result["token_usage"])

        return ChatResponse(
            success=result["success"],
            message=request.message,
            response=result.get("response"),
            duration_seconds=result.get("duration_seconds"),
            token_usage=token_usage,
            cost_usd=result.get("cost_usd"),
            turns=result.get("turns"),
            sources=result.get("sources", []),
        )

    except TimeoutError:
        logger.error(f"Chat timeout: {request.message[:50]}...")
        return ChatResponse(
            success=False,
            message=request.message,
            error="Request timed out",
        )

    except Exception as e:
        logger.exception(f"Chat failed: {e}")
        return ChatResponse(
            success=False,
            message=request.message,
            error=str(e),
        )
