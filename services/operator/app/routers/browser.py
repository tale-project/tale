"""Browser automation API endpoints."""

from fastapi import APIRouter
from loguru import logger

from app.models import (
    AnswerRequest,
    AnswerResponse,
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
        answer_text, sources = await service.answer(question=request.question)

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
