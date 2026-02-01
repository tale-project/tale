"""Browser automation API endpoints."""

from fastapi import APIRouter
from loguru import logger

from app.models import (
    AnswerRequest,
    AnswerResponse,
    SearchRequest,
    SearchResponse,
    TaskRequest,
    TaskResponse,
)
from app.services import get_browser_service

router = APIRouter(prefix="/api/v1", tags=["browser"])


@router.post("/answer", response_model=AnswerResponse)
async def answer(request: AnswerRequest) -> AnswerResponse:
    """
    Answer a question by searching the web and synthesizing results.

    This endpoint searches the web for information related to the question,
    then uses AI to synthesize a direct, concise answer from the search results.
    """
    try:
        service = get_browser_service()
        answer_text, sources = await service.answer(
            question=request.question,
            language=request.language,
        )

        return AnswerResponse(
            success=bool(answer_text),
            question=request.question,
            answer=answer_text,
            sources=sources,
        )

    except TimeoutError:
        logger.error(f"Answer timeout for: {request.question}")
        return AnswerResponse(
            success=False,
            question=request.question,
            error="Request timed out",
        )

    except Exception as e:
        logger.exception(f"Answer failed: {e}")
        return AnswerResponse(
            success=False,
            question=request.question,
            error=str(e),
        )


@router.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest) -> SearchResponse:
    """
    Perform a web search using AI-powered browser automation.

    This endpoint uses a real browser controlled by AI to search the web,
    bypassing anti-bot detection that blocks traditional scraping.

    Uses dual-model architecture:
    - Agent LLM (OPENAI_MODEL) for browser control decisions
    - Vision LLM (OPENAI_VISION_MODEL) for content extraction from screenshots
    """
    try:
        service = get_browser_service()
        results, rich_data, captcha_detected = await service.search(
            query=request.query,
            engine=request.engine,
            num_results=request.num_results,
            language=request.language,
        )

        return SearchResponse(
            success=len(results) > 0,
            query=request.query,
            engine=request.engine,
            results=results,
            total_results=len(results),
            captcha_detected=captcha_detected,
            rich_data=rich_data,
            error="CAPTCHA detected" if captcha_detected and not results else None,
        )

    except TimeoutError:
        logger.error(f"Search timeout for: {request.query}")
        return SearchResponse(
            success=False,
            query=request.query,
            engine=request.engine,
            results=[],
            total_results=0,
            error="Search timed out",
        )

    except Exception as e:
        logger.exception(f"Search failed: {e}")
        return SearchResponse(
            success=False,
            query=request.query,
            engine=request.engine,
            results=[],
            total_results=0,
            error=str(e),
        )


@router.post("/search-with-fallback", response_model=SearchResponse)
async def search_with_fallback(request: SearchRequest) -> SearchResponse:
    """
    Perform a web search with automatic engine fallback.

    Tries search engines in order: Google -> Bing -> DuckDuckGo
    If CAPTCHA is detected on one engine, automatically tries the next.
    """
    try:
        service = get_browser_service()
        results, rich_data, engine_used, captcha_detected = await service.search_with_fallback(
            query=request.query,
            num_results=request.num_results,
            language=request.language,
        )

        return SearchResponse(
            success=len(results) > 0,
            query=request.query,
            engine=engine_used,
            results=results,
            total_results=len(results),
            captcha_detected=captcha_detected,
            rich_data=rich_data,
            error="All search engines blocked by CAPTCHA" if captcha_detected and not results else None,
        )

    except TimeoutError:
        logger.error(f"Search timeout for: {request.query}")
        return SearchResponse(
            success=False,
            query=request.query,
            engine=request.engine,
            results=[],
            total_results=0,
            error="Search timed out",
        )

    except Exception as e:
        logger.exception(f"Search failed: {e}")
        return SearchResponse(
            success=False,
            query=request.query,
            engine=request.engine,
            results=[],
            total_results=0,
            error=str(e),
        )


@router.post("/task", response_model=TaskResponse)
async def run_task(request: TaskRequest) -> TaskResponse:
    """
    Run a generic browser task using AI automation.

    Provide a natural language description of the task and the AI
    will control the browser to complete it.
    """
    try:
        service = get_browser_service()
        result = await service.run_task(
            task=request.task,
            timeout=request.timeout,
        )

        return TaskResponse(
            success=result.get("success", False) if isinstance(result, dict) else True,
            task=request.task,
            result=result,
        )

    except TimeoutError:
        logger.error(f"Task timeout: {request.task[:50]}...")
        return TaskResponse(
            success=False,
            task=request.task,
            error="Task timed out",
        )

    except Exception as e:
        logger.exception(f"Task failed: {e}")
        return TaskResponse(
            success=False,
            task=request.task,
            error=str(e),
        )
