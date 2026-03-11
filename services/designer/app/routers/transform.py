"""Document transformation endpoint for Tale Designer service."""

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import Response
from loguru import logger

from ..services.transform_service import transform_service

router = APIRouter(prefix="/api/v1", tags=["Transform"])

DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@router.post("/transform")
async def transform(
    prompt: str = Form(..., description="Instruction describing how to transform the document"),
    docx: UploadFile = File(..., description="The DOCX file to transform"),
) -> Response:
    """Transform a DOCX document using an AI agent with Pencil design tools.

    Accepts a prompt and a DOCX file, applies AI-driven content and design
    transformations, and returns the modified DOCX.
    """
    if not docx.filename or not docx.filename.lower().endswith(".docx"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file must be a .docx document",
        )

    docx_bytes = await docx.read()
    if not docx_bytes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Uploaded file is empty",
        )

    logger.info("Transform request: prompt={!r}, file={!r}, size={}B", prompt, docx.filename, len(docx_bytes))

    result_bytes = await transform_service.transform(prompt=prompt, docx_bytes=docx_bytes)

    return Response(
        content=result_bytes,
        media_type=DOCX_CONTENT_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{docx.filename}"'},
    )
