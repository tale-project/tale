"""DOCX ↔ Markdown conversion via pandoc subprocess."""

import asyncio
from pathlib import Path

from loguru import logger


async def _run_pandoc(*args: str) -> str:
    """Run pandoc with the given arguments and return stdout."""
    proc = await asyncio.create_subprocess_exec(
        "pandoc",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"pandoc failed (exit {proc.returncode}): {stderr.decode()}")
    return stdout.decode()


async def docx_to_markdown(docx_path: Path) -> str:
    """Convert a DOCX file to Markdown string."""
    logger.debug("Converting DOCX → Markdown: {}", docx_path)
    return await _run_pandoc(
        "-f",
        "docx",
        "-t",
        "markdown",
        "--wrap=none",
        str(docx_path),
    )


async def markdown_to_docx(markdown: str, output_path: Path, reference_docx: Path | None = None) -> None:
    """Convert a Markdown string to DOCX, optionally preserving styles from reference_docx."""
    logger.debug("Converting Markdown → DOCX: {}", output_path)

    args = [
        "-f",
        "markdown",
        "-t",
        "docx",
        "-o",
        str(output_path),
    ]
    if reference_docx and reference_docx.exists():
        args += ["--reference-doc", str(reference_docx)]

    proc = await asyncio.create_subprocess_exec(
        "pandoc",
        *args,
        stdin=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate(input=markdown.encode())
    if proc.returncode != 0:
        raise RuntimeError(f"pandoc failed (exit {proc.returncode}): {stderr.decode()}")
