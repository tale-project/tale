"""Orchestrates the full document transformation pipeline.

Pipeline:
  1. Save uploaded DOCX bytes to a temp directory
  2. pandoc: DOCX → Markdown
  3. Create an empty .pen file for Pencil to work on
  4. Start a Pencil MCP session and run the AI agent loop
  5. pandoc: final Markdown → DOCX (with original as style reference)
  6. Return result DOCX bytes
"""

from pathlib import Path

from loguru import logger

from .agent_service import agent_service
from .pandoc_service import docx_to_markdown, markdown_to_docx
from .pencil_service import get_pencil_session
from ..utils.temp_files import temp_workspace

EMPTY_PEN = '{"id":"root","type":"frame","width":1440,"height":900,"children":[]}'


class TransformService:
    """Orchestrates prompt + docx → new docx."""

    async def transform(self, prompt: str, docx_bytes: bytes) -> bytes:
        """Apply AI-driven transformation to a DOCX document.

        Args:
            prompt: User instruction describing the desired changes.
            docx_bytes: Raw bytes of the input DOCX file.

        Returns:
            Raw bytes of the transformed DOCX file.
        """
        async with temp_workspace() as workspace:
            input_docx = workspace / "input.docx"
            output_docx = workspace / "output.docx"
            pen_file = workspace / "document.pen"

            input_docx.write_bytes(docx_bytes)
            pen_file.write_text(EMPTY_PEN)

            logger.info("Step 1: Converting DOCX → Markdown")
            markdown = await docx_to_markdown(input_docx)

            logger.info("Step 2: Running AI agent loop ({} chars of markdown)", len(markdown))
            final_markdown = await self._run_agent(
                prompt=prompt,
                markdown=markdown,
                pen_file_path=pen_file,
            )

            logger.info("Step 3: Converting Markdown → DOCX")
            await markdown_to_docx(
                markdown=final_markdown,
                output_path=output_docx,
                reference_docx=input_docx,
            )

            return output_docx.read_bytes()

    async def _run_agent(self, prompt: str, markdown: str, pen_file_path: Path) -> str:
        """Run the Pencil-backed AI agent, falling back to direct edit if unavailable."""
        try:
            async for session in get_pencil_session():
                return await agent_service.run(
                    prompt=prompt,
                    markdown=markdown,
                    pen_file_path=pen_file_path,
                    session=session,
                )
        except RuntimeError as exc:
            logger.warning("Pencil MCP unavailable ({}); running agent without design tools", exc)

        # Fallback: run without Pencil MCP tools (content-only edit)
        from openai import AsyncOpenAI
        from ..config import settings

        client = AsyncOpenAI(
            api_key=settings.get_openai_api_key(),
            base_url=settings.get_openai_base_url(),
        )
        response = await client.chat.completions.create(
            model=settings.get_design_model(),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an expert document editor. Apply the requested changes "
                        "to the document content and return the full updated Markdown inside "
                        "a ```markdown code block."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Document:\n\n{markdown}\n\nInstructions: {prompt}",
                },
            ],
        )
        content = response.choices[0].message.content or ""
        from .agent_service import _extract_final_markdown

        return _extract_final_markdown(content) or content


transform_service = TransformService()
