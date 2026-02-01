"""
Vision analysis MCP server for Claude Code.

Provides an analyze_image tool that calls a vision-capable LLM to analyze images.
This allows Claude Code to analyze screenshots without requiring the main LLM to support vision.

Usage:
    python -m app.mcp.vision_server

Configure via environment variables:
    OPENAI_VISION_BASE_URL: Base URL for vision API (defaults to OPENAI_BASE_URL)
    OPENAI_VISION_API_KEY: API key for vision API (defaults to OPENAI_API_KEY)
    OPENAI_VISION_MODEL: Vision model to use (defaults to gpt-4o)
"""

import base64
import os
from pathlib import Path

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Vision Analyzer")

VISION_API_BASE = os.environ.get(
    "OPENAI_VISION_BASE_URL", os.environ.get("OPENAI_BASE_URL", "")
)
VISION_API_KEY = os.environ.get(
    "OPENAI_VISION_API_KEY", os.environ.get("OPENAI_API_KEY", "")
)
VISION_MODEL = os.environ.get("OPENAI_VISION_MODEL", "gpt-4o")


@mcp.tool()
async def analyze_image(
    image_path: str, prompt: str = "Describe this image in detail."
) -> str:
    """
    Analyze an image using a vision-capable LLM.

    Use this tool when you need to understand the content of an image or screenshot.
    The tool sends the image to a vision model and returns a text description.

    Args:
        image_path: Absolute path to the image file to analyze
        prompt: Question or instruction about the image (e.g., "What text is visible?", "Describe the UI layout")

    Returns:
        Text description/analysis of the image
    """
    path = Path(image_path)
    if not path.exists():
        return f"Error: Image file not found: {image_path}"

    with open(path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    suffix = path.suffix.lower()
    mime_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    mime_type = mime_types.get(suffix, "image/png")

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{VISION_API_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {VISION_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": VISION_MODEL,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:{mime_type};base64,{image_data}"
                                    },
                                },
                            ],
                        }
                    ],
                    "max_tokens": 2048,
                },
                timeout=120.0,
            )

            if response.status_code != 200:
                return f"Error calling vision model: {response.status_code} - {response.text}"

            result = response.json()
            return result["choices"][0]["message"]["content"]

    except httpx.TimeoutException:
        return "Error: Vision model request timed out"
    except Exception as e:
        return f"Error analyzing image: {e}"


if __name__ == "__main__":
    mcp.run()
