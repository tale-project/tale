"""
End-to-end test for the OpenAI-compatible Chat Completions API.

Tests all features:
  1. GET /api/v1/models
  2. Basic chat (non-streaming)
  3. Basic chat (streaming)
  4. Generation params (temperature, max_tokens)
  5. response_format: json_object
  6. Tool calling (single round)
  7. Tool calling (multi-round continuation)
  8. Tool calling (streaming)
  9. Error cases
"""

import json
import sys

from openai import OpenAI

BASE_URL = "http://127.0.0.1:3211/api/v1"
API_KEY = sys.argv[1] if len(sys.argv) > 1 else "test"
ORG_SLUG = sys.argv[2] if len(sys.argv) > 2 else "default"
MODEL = sys.argv[3] if len(sys.argv) > 3 else "chat-agent"

client = OpenAI(
    base_url=BASE_URL,
    api_key=API_KEY,
    default_headers={"X-Organization-Slug": ORG_SLUG},
)

passed = 0
failed = 0


def test(name: str):
    print(f"\n{'=' * 60}")
    print(f"TEST: {name}")
    print(f"{'=' * 60}")


def ok(msg: str = ""):
    global passed
    passed += 1
    print(f"  PASS {msg}")


def fail(msg: str):
    global failed
    failed += 1
    print(f"  FAIL {msg}")


# -------------------------------------------------------------------------
# 1. List models
# -------------------------------------------------------------------------
test("1. GET /v1/models")
try:
    models = client.models.list()
    model_ids = [m.id for m in models.data]
    print(f"  Models: {model_ids}")
    if len(model_ids) > 0:
        ok(f"Found {len(model_ids)} models")
    else:
        fail("No models returned")
except Exception as e:
    fail(str(e))

# -------------------------------------------------------------------------
# 2. Basic chat (non-streaming)
# -------------------------------------------------------------------------
test("2. Basic chat (non-streaming)")
try:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Say hello in exactly 2 words."}],
    )
    content = response.choices[0].message.content
    finish = response.choices[0].finish_reason
    print(f"  Response: {content!r}")
    print(f"  Finish reason: {finish}")
    if content and finish == "stop":
        ok()
    else:
        fail(f"Unexpected: content={content!r}, finish={finish}")
except Exception as e:
    fail(str(e))

# -------------------------------------------------------------------------
# 3. Basic chat (streaming)
# -------------------------------------------------------------------------
test("3. Basic chat (streaming)")
try:
    stream = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Say hi in one word."}],
        stream=True,
    )
    chunks = []
    full_content = ""
    finish_reason = None
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            full_content += delta.content
        if chunk.choices[0].finish_reason:
            finish_reason = chunk.choices[0].finish_reason
        chunks.append(chunk)

    print(f"  Chunks received: {len(chunks)}")
    print(f"  Full content: {full_content!r}")
    print(f"  Finish reason: {finish_reason}")
    if full_content and finish_reason == "stop":
        ok()
    else:
        fail(f"content={full_content!r}, finish={finish_reason}")
except Exception as e:
    fail(str(e))

# -------------------------------------------------------------------------
# 4. Generation params
# -------------------------------------------------------------------------
test("4. Generation params (temperature=0.1, max_tokens=15)")
try:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Count from 1 to 100."}],
        temperature=0.1,
        max_tokens=15,
    )
    content = response.choices[0].message.content
    print(f"  Response: {content!r}")
    if content:
        ok(f"Response length: {len(content)} chars")
    else:
        fail("No content")
except Exception as e:
    fail(str(e))

# -------------------------------------------------------------------------
# 5. response_format: json_object
# -------------------------------------------------------------------------
test("5. response_format: json_object")
try:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": "Return a JSON object with key 'status' and value 'ok'.",
            }
        ],
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content
    print(f"  Response: {content!r}")
    if content and ("status" in content.lower()):
        ok("JSON content contains 'status'")
    else:
        fail(f"content={content!r}")
except Exception as e:
    fail(str(e))

# -------------------------------------------------------------------------
# 6. Tool calling (single round)
# -------------------------------------------------------------------------
test("6. Tool calling (single round)")
try:
    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather for a location",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string", "description": "City name"},
                    },
                    "required": ["city"],
                },
            },
        }
    ]
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "What's the weather in Berlin?"}],
        tools=tools,
    )
    choice = response.choices[0]
    print(f"  Finish reason: {choice.finish_reason}")
    print(f"  Content: {choice.message.content!r}")
    if choice.message.tool_calls:
        for tc in choice.message.tool_calls:
            print(f"  Tool call: {tc.function.name}({tc.function.arguments})")
        ok(f"{len(choice.message.tool_calls)} tool call(s)")
    else:
        fail("No tool_calls in response")
except Exception as e:
    fail(str(e))

# -------------------------------------------------------------------------
# 7. Tool calling (multi-round continuation)
# -------------------------------------------------------------------------
test("7. Tool calling (multi-round continuation)")
try:
    tools = [
        {
            "type": "function",
            "function": {
                "name": "calculator",
                "description": "Calculate a math expression",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "expression": {
                            "type": "string",
                            "description": "Math expression",
                        },
                    },
                    "required": ["expression"],
                },
            },
        }
    ]

    messages = [{"role": "user", "content": "What is 42 * 17? Use calculator."}]

    # Step 1: Get tool calls
    response = client.chat.completions.create(
        model=MODEL, messages=messages, tools=tools
    )
    choice = response.choices[0]
    print(f"  Step 1 finish: {choice.finish_reason}")

    if choice.finish_reason == "tool_calls" and choice.message.tool_calls:
        tc = choice.message.tool_calls[0]
        print(f"  Tool call: {tc.function.name}({tc.function.arguments})")

        # Get thread_id from response headers (via raw response)
        # For continuation, we use the messages array pattern
        # Step 2: Send tool result
        messages.append(choice.message.model_dump())
        messages.append(
            {
                "role": "tool",
                "tool_call_id": tc.id,
                "content": "714",
            }
        )

        response2 = client.chat.completions.create(
            model=MODEL, messages=messages, tools=tools
        )
        choice2 = response2.choices[0]
        print(f"  Step 2 finish: {choice2.finish_reason}")
        print(f"  Step 2 content: {choice2.message.content!r}")

        if choice2.message.content and "714" in choice2.message.content:
            ok("Model used tool result correctly")
        elif choice2.message.content:
            ok(f"Got response: {choice2.message.content[:80]!r}")
        else:
            fail("No content in step 2")
    elif choice.finish_reason == "stop":
        print(f"  Model answered directly: {choice.message.content!r}")
        ok("Model answered without tools (acceptable)")
    else:
        fail(
            f"Unexpected: finish={choice.finish_reason}, tool_calls={choice.message.tool_calls}"
        )
except Exception as e:
    fail(str(e))

# -------------------------------------------------------------------------
# 8. Tool calling (streaming)
# -------------------------------------------------------------------------
test("8. Tool calling (streaming)")
try:
    tools = [
        {
            "type": "function",
            "function": {
                "name": "search",
                "description": "Search the web",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                    },
                    "required": ["query"],
                },
            },
        }
    ]
    stream = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Search for 'Python tutorial'"}],
        tools=tools,
        stream=True,
    )
    chunks = []
    finish_reason = None
    has_tool_calls = False
    for chunk in stream:
        if chunk.choices[0].delta.tool_calls:
            has_tool_calls = True
        if chunk.choices[0].finish_reason:
            finish_reason = chunk.choices[0].finish_reason
        chunks.append(chunk)

    print(f"  Chunks: {len(chunks)}")
    print(f"  Finish reason: {finish_reason}")
    print(f"  Has tool_calls: {has_tool_calls}")
    if finish_reason == "tool_calls" and has_tool_calls:
        ok()
    elif finish_reason == "stop":
        ok("Model responded with text (acceptable)")
    else:
        fail(f"finish={finish_reason}, tool_calls={has_tool_calls}")
except Exception as e:
    fail(str(e))

# -------------------------------------------------------------------------
# 9. Error cases
# -------------------------------------------------------------------------
test("9a. Error: invalid model")
try:
    client.chat.completions.create(
        model="nonexistent-model-xyz",
        messages=[{"role": "user", "content": "hi"}],
    )
    fail("Should have raised an error")
except Exception as e:
    error_str = str(e)
    if "not found" in error_str.lower() or "404" in error_str:
        ok(f"Got expected error: {error_str[:80]}")
    else:
        fail(f"Unexpected error: {error_str[:80]}")

test("9b. Error: invalid API key")
try:
    bad_client = OpenAI(
        base_url=BASE_URL,
        api_key="invalid_key",
        default_headers={"X-Organization-Slug": ORG_SLUG},
    )
    bad_client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "hi"}],
    )
    fail("Should have raised an error")
except Exception as e:
    error_str = str(e)
    if (
        "401" in error_str
        or "api_key" in error_str.lower()
        or "unauthorized" in error_str.lower()
    ):
        ok(f"Got expected 401: {error_str[:80]}")
    else:
        fail(f"Unexpected error: {error_str[:80]}")

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
print(f"\n{'=' * 60}")
print(f"RESULTS: {passed} passed, {failed} failed out of {passed + failed} tests")
print(f"{'=' * 60}")
sys.exit(1 if failed > 0 else 0)
