"""Agent LLM client for browser automation decisions using function calling."""

import json
from dataclasses import dataclass
from typing import Any

import httpx
from loguru import logger

from app.config import settings


# MCP tools mapped to OpenAI function calling format
AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "browser_navigate",
            "description": "Navigate to a URL",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to navigate to"}
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_take_screenshot",
            "description": "Take a screenshot of the current page. Use this to extract content from the page.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_click",
            "description": "Click an element on the page",
            "parameters": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "Element reference from snapshot"},
                    "element": {"type": "string", "description": "Human-readable element description"},
                },
                "required": ["ref"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_type",
            "description": "Type text into an input field",
            "parameters": {
                "type": "object",
                "properties": {
                    "ref": {"type": "string", "description": "Element reference from snapshot"},
                    "text": {"type": "string", "description": "Text to type"},
                    "submit": {"type": "boolean", "description": "Whether to press Enter after typing"},
                },
                "required": ["ref", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_wait_for",
            "description": "Wait for text to appear or time to pass",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "Text to wait for"},
                    "time": {"type": "number", "description": "Time to wait in seconds"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "done",
            "description": "Signal that the task is complete or cannot be completed",
            "parameters": {
                "type": "object",
                "properties": {
                    "success": {"type": "boolean", "description": "Whether the task succeeded"},
                    "message": {"type": "string", "description": "Completion message"},
                },
                "required": ["success", "message"],
            },
        },
    },
]


AGENT_SYSTEM_PROMPT = """You are a powerful browser automation agent. Your goal is to help users complete tasks by browsing the web intelligently.

Available tools:
- browser_navigate(url): Navigate to a URL
- browser_take_screenshot(): Take a screenshot (triggers content extraction)
- browser_click(ref, element): Click an element
- browser_type(ref, text, submit): Type text into a field
- browser_wait_for(text, time): Wait for text or time
- done(success, message): Signal task completion

Core strategies:

1. **Web Search**: Start with Google, fallback to Bing/DuckDuckGo if blocked
   - Google: https://www.google.com/search?q={query}
   - Bing: https://www.bing.com/search?q={query}
   - DuckDuckGo: https://duckduckgo.com/?q={query}

2. **Navigate to specific sites**: Go directly to relevant websites
   - For shopping: visit e-commerce sites (taobao, jd, guazi, etc.)
   - For information: visit authoritative sources

3. **Interact with chatbots**: If you see a chat widget or customer service bot:
   - Click to open the chat window
   - Type the user's question
   - Wait for and capture the response
   - This can provide more specific answers than search results

4. **Fill forms**: If relevant, fill out inquiry forms to get quotes or information

5. **Click through results**: Don't just stay on search results - click into promising links to get detailed information

Best practices:
- Take screenshots after each navigation to capture content
- Be proactive - explore multiple sources to gather comprehensive information
- If one approach fails, try alternatives
- Interact with page elements (buttons, links, chat widgets) when useful
- Call done() when you have gathered enough information or exhausted options
"""


@dataclass
class ToolCall:
    """Represents a tool call from the agent."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class AgentResponse:
    """Response from the agent."""

    content: str | None
    tool_calls: list[ToolCall]
    finish_reason: str


class AgentClient:
    """Client for Agent LLM using OpenAI-compatible API."""

    def __init__(self):
        self._client = httpx.AsyncClient(timeout=60.0)

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> AgentResponse:
        """Send a chat request to the agent LLM."""
        url = f"{settings.llm_base_url}/chat/completions" if settings.llm_base_url else "https://api.openai.com/v1/chat/completions"

        payload = {
            "model": settings.llm_model,
            "messages": messages,
        }

        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        logger.debug(f"Agent request to {settings.llm_model}: {len(messages)} messages")

        response = await self._client.post(
            url,
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()

        data = response.json()
        choice = data["choices"][0]
        message = choice["message"]

        tool_calls = []
        if "tool_calls" in message and message["tool_calls"]:
            for tc in message["tool_calls"]:
                tool_calls.append(ToolCall(
                    id=tc["id"],
                    name=tc["function"]["name"],
                    arguments=json.loads(tc["function"]["arguments"]),
                ))

        logger.debug(f"Agent response: {len(tool_calls)} tool calls, finish_reason={choice['finish_reason']}")

        return AgentResponse(
            content=message.get("content"),
            tool_calls=tool_calls,
            finish_reason=choice["finish_reason"],
        )

    async def run_agent_loop(
        self,
        task: str,
        execute_tool: Any,  # Callable[[str, dict], Awaitable[str]]
        max_steps: int | None = None,
    ) -> tuple[bool, str]:
        """
        Run the agent loop until completion or max steps.

        Args:
            task: The task description
            execute_tool: Async function to execute tool calls, returns result string
            max_steps: Maximum number of steps (defaults to settings.max_steps)

        Returns:
            Tuple of (success, message)
        """
        if max_steps is None:
            max_steps = settings.max_steps

        messages = [
            {"role": "system", "content": AGENT_SYSTEM_PROMPT},
            {"role": "user", "content": task},
        ]

        for step in range(max_steps):
            logger.info(f"Agent step {step + 1}/{max_steps}")

            response = await self.chat(messages, tools=AGENT_TOOLS)

            # No tool calls - check if done
            if not response.tool_calls:
                if response.content:
                    return True, response.content
                return False, "Agent stopped without completing task"

            # Process tool calls
            for tool_call in response.tool_calls:
                logger.info(f"Tool call: {tool_call.name}({tool_call.arguments})")

                # Check for done signal
                if tool_call.name == "done":
                    return tool_call.arguments.get("success", False), tool_call.arguments.get("message", "")

                # Execute the tool
                try:
                    result = await execute_tool(tool_call.name, tool_call.arguments)
                except Exception as e:
                    result = f"Error: {e}"
                    logger.error(f"Tool execution error: {e}")

                # Add assistant message with tool call
                messages.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": tool_call.id,
                        "type": "function",
                        "function": {
                            "name": tool_call.name,
                            "arguments": json.dumps(tool_call.arguments),
                        },
                    }],
                })

                # Add tool result
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

        return False, f"Max steps ({max_steps}) reached"

    async def synthesize_answer(
        self,
        question: str,
        page_content: str,
        sources: list[dict[str, str]],
    ) -> str:
        """
        Synthesize an answer from page content and sources.

        Args:
            question: The user's question
            page_content: Text content from the search results page
            sources: List of source URLs with titles

        Returns:
            Synthesized answer string
        """
        sources_text = "\n".join([f"- {s.get('title', 'Unknown')}: {s.get('url', '')}" for s in sources])

        prompt = f"""Based on the search results below, provide a direct, concise answer to the user's question.

Question: {question}

Search Results Page Content:
{page_content[:8000]}

Sources:
{sources_text}

Instructions:
1. Answer the question directly and concisely
2. Use the information from the search results
3. If the search results don't contain enough information to answer, say so
4. Do NOT include URLs or source references in your answer - just provide the answer
5. Keep the answer factual and informative
6. If there are multiple relevant pieces of information, synthesize them into a coherent answer
7. Respond in the same language as the question

Answer:"""

        return await self._call_llm(prompt)

    async def synthesize_task_result(
        self,
        task: str,
        page_contents: list[str],
        urls_visited: list[str],
    ) -> str:
        """
        Synthesize a useful result from task execution.

        Args:
            task: The original task description
            page_contents: List of page contents collected during execution
            urls_visited: List of URLs visited

        Returns:
            Synthesized result string
        """
        combined_content = "\n\n---\n\n".join(page_contents[-3:])  # Last 3 pages

        prompt = f"""You completed a browser automation task. Based on the collected information, provide a helpful summary for the user.

Original Task: {task}

URLs Visited:
{chr(10).join(f"- {url}" for url in urls_visited[-5:])}

Page Contents:
{combined_content[:12000]}

Instructions:
1. Summarize the key information found that's relevant to the user's task
2. If the task was to find something specific, provide that information clearly
3. If there are actionable recommendations, list them
4. Be concise but comprehensive
5. Respond in the same language as the task
6. Focus on what would be most useful to the user

Summary:"""

        return await self._call_llm(prompt, max_tokens=2048)

    async def _call_llm(self, prompt: str, max_tokens: int = 1024) -> str:
        """Call the LLM with a prompt."""
        url = f"{settings.llm_base_url}/chat/completions" if settings.llm_base_url else "https://api.openai.com/v1/chat/completions"

        payload = {
            "model": settings.llm_model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
        }

        logger.info(f"Calling LLM {settings.llm_model}")

        response = await self._client.post(
            url,
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()

        data = response.json()
        return data["choices"][0]["message"]["content"]
