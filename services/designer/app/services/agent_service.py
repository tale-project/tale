"""AI agent feedback loop using OpenAI-compatible API and Pencil MCP tools.

The agent receives a document (as Markdown) and a user prompt, then
iteratively calls Pencil MCP tools to apply design and content changes.
The loop continues until the agent signals completion or max_iterations
is reached.
"""

import json
from pathlib import Path

from loguru import logger
from mcp import ClientSession
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from ..config import settings

SYSTEM_PROMPT = """\
You are an expert document designer and editor. You have access to Pencil design tools \
that let you read and modify .pen design files.

Your task is to transform a Word document according to the user's instructions. \
You will be given the document content in Markdown format and a .pen file path to work with.

Workflow:
1. Use `open_document` to open the .pen file.
2. Use `batch_get` to read the current document structure.
3. Apply the requested changes using `batch_design`.
4. Use `get_screenshot` to visually verify the result.
5. Iterate until the document looks correct.
6. When satisfied, output ONLY the updated document content in Markdown format \
   inside a ```markdown code block. This is the final output.

Focus on both content accuracy and visual design quality.\
"""


def _mcp_tools_to_openai(tools) -> list[dict]:
    """Convert MCP tool definitions to OpenAI tool-use format."""
    result = []
    for tool in tools:
        result.append(
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": tool.inputSchema if tool.inputSchema else {"type": "object", "properties": {}},
                },
            }
        )
    return result


def _extract_final_markdown(content: str) -> str | None:
    """Extract final Markdown from agent response if present."""
    import re

    match = re.search(r"```markdown\s*(.*?)\s*```", content, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None


class AgentService:
    """Runs the AI feedback loop with Pencil MCP tools."""

    async def run(
        self,
        prompt: str,
        markdown: str,
        pen_file_path: Path,
        session: ClientSession,
    ) -> str:
        """Run the agent loop and return the final Markdown content.

        Args:
            prompt: User instruction (what to change).
            markdown: Current document content as Markdown.
            pen_file_path: Path to the .pen file for Pencil to work on.
            session: Active Pencil MCP ClientSession.

        Returns:
            Transformed document content as Markdown.
        """
        model = settings.get_design_model()
        api_key = settings.get_openai_api_key()
        base_url = settings.get_openai_base_url()

        client = AsyncOpenAI(api_key=api_key, base_url=base_url)

        mcp_tools = (await session.list_tools()).tools
        openai_tools = _mcp_tools_to_openai(mcp_tools)

        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Pen file: {pen_file_path}\n\nDocument content (Markdown):\n\n{markdown}\n\nInstructions: {prompt}"
                ),
            },
        ]

        for iteration in range(settings.max_agent_iterations):
            logger.debug("Agent iteration {}/{}", iteration + 1, settings.max_agent_iterations)

            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                tools=openai_tools if openai_tools else None,
                tool_choice="auto" if openai_tools else None,
            )

            message = response.choices[0].message
            messages.append(message)  # type: ignore[arg-type]

            # Check if agent wants to use tools
            if message.tool_calls:
                for tool_call in message.tool_calls:
                    tool_name = tool_call.function.name
                    tool_args = json.loads(tool_call.function.arguments)
                    logger.debug("Calling Pencil tool: {}({})", tool_name, tool_args)

                    try:
                        result = await session.call_tool(tool_name, tool_args)
                        tool_result_content = json.dumps(
                            [block.model_dump() for block in result.content] if result.content else []
                        )
                    except Exception as exc:
                        logger.warning("Pencil tool {} failed: {}", tool_name, exc)
                        tool_result_content = f"Error: {exc}"

                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": tool_result_content,
                        }
                    )
                continue

            # No tool calls — agent is done; extract final Markdown
            if message.content:
                final = _extract_final_markdown(message.content)
                if final:
                    logger.info("Agent completed in {} iteration(s)", iteration + 1)
                    return final
                # Agent responded without the expected format — use content as-is
                logger.warning("Agent did not return a markdown block; using raw content")
                return message.content

        logger.warning("Agent reached max iterations ({}); returning original markdown", settings.max_agent_iterations)
        return markdown


agent_service = AgentService()
