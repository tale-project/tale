"""Vision LLM client for extracting content from screenshots."""

import base64
import json
from dataclasses import dataclass
from typing import Any

import httpx
from loguru import logger

from app.config import settings


VISION_EXTRACTION_PROMPT = """You are a search results extractor. Analyze this screenshot of a search engine results page.

Extract ALL visible organic search results in this exact JSON format:
{
  "captcha_detected": false,
  "results": [
    {
      "position": 1,
      "title": "Result title",
      "url": "https://example.com/path",
      "snippet": "Description text shown under the result"
    }
  ],
  "rich_data": null
}

IMPORTANT RULES:
1. If you see a CAPTCHA, verification challenge, "unusual traffic" message, or any bot detection page:
   - Set "captcha_detected": true
   - Set "results": []
   - Return immediately

2. ONLY extract organic search results. SKIP:
   - Ads and sponsored results
   - "People also ask" sections
   - Related searches
   - Knowledge panels (but extract their data to rich_data if relevant)

3. For each result:
   - "position" starts at 1 for the first organic result
   - "title" is the clickable headline
   - "url" is the actual URL (may be truncated in display, extract what you can see)
   - "snippet" is the description text below the title

4. If you see special data like exchange rates, weather, or featured snippets:
   - Set "rich_data": {"type": "exchange_rate|weather|...", "data": {...}}
   - Example: {"type": "exchange_rate", "data": {"from": "USD", "to": "CNY", "rate": "7.25"}}

5. Return ONLY valid JSON. No markdown, no explanation, no code blocks.

Analyze the screenshot now:"""


@dataclass
class ExtractionResult:
    """Result of vision extraction."""

    captcha_detected: bool
    results: list[dict[str, Any]]
    rich_data: dict[str, Any] | None


class VisionClient:
    """Client for Vision LLM to extract content from screenshots."""

    def __init__(self):
        self._client = httpx.AsyncClient(timeout=120.0)

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()

    async def extract_from_screenshot(
        self,
        screenshot_bytes: bytes,
        custom_prompt: str | None = None,
    ) -> ExtractionResult:
        """
        Extract search results from a screenshot using vision model.

        Args:
            screenshot_bytes: PNG screenshot data
            custom_prompt: Optional custom extraction prompt

        Returns:
            ExtractionResult with captcha detection and extracted results
        """
        # Determine which model to use
        vision_model = settings.llm_vision_model
        if not vision_model:
            # Fall back to main model if no vision model configured
            vision_model = settings.llm_model
            logger.warning(f"No vision model configured, using {vision_model}")

        # Encode screenshot as base64
        image_base64 = base64.b64encode(screenshot_bytes).decode("utf-8")

        url = f"{settings.llm_base_url}/chat/completions" if settings.llm_base_url else "https://api.openai.com/v1/chat/completions"

        payload = {
            "model": vision_model,
            "max_tokens": 4096,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": custom_prompt or VISION_EXTRACTION_PROMPT,
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{image_base64}",
                                "detail": "high",
                            },
                        },
                    ],
                }
            ],
        }

        # Try to use JSON response format if supported
        # Note: Not all providers support this
        # payload["response_format"] = {"type": "json_object"}

        logger.info(f"Extracting content using vision model: {vision_model}")

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
        content = data["choices"][0]["message"]["content"]

        # Parse JSON response
        try:
            # Try to extract JSON from the response (in case it's wrapped in markdown)
            json_content = content
            if "```json" in content:
                json_content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                json_content = content.split("```")[1].split("```")[0]

            result = json.loads(json_content.strip())

            return ExtractionResult(
                captcha_detected=result.get("captcha_detected", False),
                results=result.get("results", []),
                rich_data=result.get("rich_data"),
            )

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse vision response as JSON: {e}")
            logger.debug(f"Raw response: {content}")

            # Check if the response mentions CAPTCHA
            captcha_keywords = ["captcha", "verify", "robot", "unusual traffic", "blocked"]
            if any(keyword in content.lower() for keyword in captcha_keywords):
                return ExtractionResult(
                    captcha_detected=True,
                    results=[],
                    rich_data=None,
                )

            # Return empty results on parse failure
            return ExtractionResult(
                captcha_detected=False,
                results=[],
                rich_data=None,
            )

    async def detect_captcha(self, screenshot_bytes: bytes) -> bool:
        """
        Quick check if a screenshot shows a CAPTCHA.

        Args:
            screenshot_bytes: PNG screenshot data

        Returns:
            True if CAPTCHA is detected
        """
        result = await self.extract_from_screenshot(
            screenshot_bytes,
            custom_prompt="""Look at this screenshot. Does it show a CAPTCHA, verification challenge,
            "unusual traffic" message, or any kind of bot detection page?

            Respond with ONLY one word: "yes" or "no".""",
        )

        # For quick detection, we just check the captcha_detected flag
        return result.captcha_detected
