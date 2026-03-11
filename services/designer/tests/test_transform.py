"""Tests for the Designer service transformation pipeline."""

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# pandoc_service
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_docx_to_markdown_calls_pandoc(tmp_path: Path) -> None:
    docx_path = tmp_path / "test.docx"
    docx_path.write_bytes(b"fake docx content")

    with patch("asyncio.create_subprocess_exec") as mock_exec:
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"# Hello\n\nWorld", b""))
        mock_exec.return_value = mock_proc

        from app.services.pandoc_service import docx_to_markdown

        result = await docx_to_markdown(docx_path)

    assert result == "# Hello\n\nWorld"
    mock_exec.assert_called_once()
    call_args = mock_exec.call_args[0]
    assert "pandoc" in call_args
    assert "-f" in call_args
    assert "docx" in call_args


@pytest.mark.asyncio
async def test_docx_to_markdown_raises_on_pandoc_error(tmp_path: Path) -> None:
    docx_path = tmp_path / "test.docx"
    docx_path.write_bytes(b"fake docx content")

    with patch("asyncio.create_subprocess_exec") as mock_exec:
        mock_proc = AsyncMock()
        mock_proc.returncode = 1
        mock_proc.communicate = AsyncMock(return_value=(b"", b"pandoc: error reading file"))
        mock_exec.return_value = mock_proc

        from app.services.pandoc_service import docx_to_markdown

        with pytest.raises(RuntimeError, match="pandoc failed"):
            await docx_to_markdown(docx_path)


@pytest.mark.asyncio
async def test_markdown_to_docx_writes_output(tmp_path: Path) -> None:
    output_path = tmp_path / "output.docx"

    with patch("asyncio.create_subprocess_exec") as mock_exec:
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"", b""))
        mock_exec.return_value = mock_proc

        from app.services.pandoc_service import markdown_to_docx

        await markdown_to_docx("# Hello", output_path)

    mock_exec.assert_called_once()
    call_args = mock_exec.call_args[0]
    assert "pandoc" in call_args
    assert "-t" in call_args
    assert "docx" in call_args
    assert str(output_path) in call_args


@pytest.mark.asyncio
async def test_markdown_to_docx_uses_reference_doc_when_provided(tmp_path: Path) -> None:
    output_path = tmp_path / "output.docx"
    reference_path = tmp_path / "reference.docx"
    reference_path.write_bytes(b"ref")

    with patch("asyncio.create_subprocess_exec") as mock_exec:
        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"", b""))
        mock_exec.return_value = mock_proc

        from app.services.pandoc_service import markdown_to_docx

        await markdown_to_docx("# Hello", output_path, reference_docx=reference_path)

    call_args = mock_exec.call_args[0]
    assert "--reference-doc" in call_args


# ---------------------------------------------------------------------------
# agent_service helpers
# ---------------------------------------------------------------------------


def test_extract_final_markdown_finds_block() -> None:
    from app.services.agent_service import _extract_final_markdown

    content = "Here is the result:\n\n```markdown\n# Title\n\nBody\n```\n\nDone."
    assert _extract_final_markdown(content) == "# Title\n\nBody"


def test_extract_final_markdown_returns_none_when_absent() -> None:
    from app.services.agent_service import _extract_final_markdown

    assert _extract_final_markdown("No markdown block here.") is None


def test_mcp_tools_to_openai_format() -> None:
    from app.services.agent_service import _mcp_tools_to_openai

    mock_tool = MagicMock()
    mock_tool.name = "batch_design"
    mock_tool.description = "Design tool"
    mock_tool.inputSchema = {"type": "object", "properties": {"ops": {"type": "string"}}}

    result = _mcp_tools_to_openai([mock_tool])

    assert len(result) == 1
    assert result[0]["type"] == "function"
    assert result[0]["function"]["name"] == "batch_design"
    assert result[0]["function"]["description"] == "Design tool"


# ---------------------------------------------------------------------------
# agent_service loop
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_agent_returns_final_markdown_on_first_non_tool_response() -> None:
    from app.services.agent_service import AgentService

    mock_session = AsyncMock()
    mock_session.list_tools.return_value = MagicMock(tools=[])

    mock_message = MagicMock()
    mock_message.tool_calls = None
    mock_message.content = "Here:\n```markdown\n# Edited\n```"

    mock_choice = MagicMock()
    mock_choice.message = mock_message

    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    with (
        patch("app.services.agent_service.AsyncOpenAI") as mock_client_cls,
        patch("app.services.agent_service.settings") as mock_settings,
    ):
        mock_settings.get_design_model.return_value = "gpt-4o"
        mock_settings.get_openai_api_key.return_value = "test-key"
        mock_settings.get_openai_base_url.return_value = None
        mock_settings.max_agent_iterations = 5

        mock_client = AsyncMock()
        mock_client.chat.completions.create.return_value = mock_response
        mock_client_cls.return_value = mock_client

        service = AgentService()
        result = await service.run(
            prompt="Make it formal",
            markdown="# Hello",
            pen_file_path=Path("/tmp/test.pen"),
            session=mock_session,
        )

    assert result == "# Edited"


@pytest.mark.asyncio
async def test_agent_falls_back_to_original_after_max_iterations() -> None:
    from app.services.agent_service import AgentService

    mock_session = AsyncMock()
    mock_session.list_tools.return_value = MagicMock(tools=[])
    mock_session.call_tool.return_value = MagicMock(content=[])

    mock_tool_call = MagicMock()
    mock_tool_call.id = "call_1"
    mock_tool_call.function.name = "batch_design"
    mock_tool_call.function.arguments = "{}"

    mock_message = MagicMock()
    mock_message.tool_calls = [mock_tool_call]
    mock_message.content = None

    mock_choice = MagicMock()
    mock_choice.message = mock_message

    mock_response = MagicMock()
    mock_response.choices = [mock_choice]

    with (
        patch("app.services.agent_service.AsyncOpenAI") as mock_client_cls,
        patch("app.services.agent_service.settings") as mock_settings,
    ):
        mock_settings.get_design_model.return_value = "gpt-4o"
        mock_settings.get_openai_api_key.return_value = "test-key"
        mock_settings.get_openai_base_url.return_value = None
        mock_settings.max_agent_iterations = 2

        mock_client = AsyncMock()
        mock_client.chat.completions.create.return_value = mock_response
        mock_client_cls.return_value = mock_client

        service = AgentService()
        original = "# Original"
        result = await service.run(
            prompt="Do something",
            markdown=original,
            pen_file_path=Path("/tmp/test.pen"),
            session=mock_session,
        )

    assert result == original


# ---------------------------------------------------------------------------
# temp_files
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_temp_workspace_creates_and_cleans_up() -> None:
    from app.utils.temp_files import temp_workspace

    captured_path = None
    async with temp_workspace() as path:
        captured_path = path
        assert path.exists()
        assert path.is_dir()
        (path / "test.txt").write_text("hello")

    assert not captured_path.exists()
