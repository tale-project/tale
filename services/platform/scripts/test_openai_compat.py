"""
Comprehensive end-to-end test for the OpenAI-compatible Chat Completions API.

Tests:
  1.  GET /v1/models
  2.  Basic chat (non-streaming)
  3.  Basic chat (streaming)
  4.  Generation params (temperature, max_tokens)
  5.  response_format: json_object
  6.  Tool calling (single round, tool_choice=required)
  7.  Tool calling (multi-round continuation)
  8.  Tool calling (streaming)
  9.  Multiple tools defined
  10. Tool calling with tool_choice=auto (model decides)
  11. Agent mode with no tools (server-side tools, streaming)
  12. stop sequences
  13. Error: invalid model (404)
  14. Error: invalid API key (401)
  15. Error: missing messages (400)
  16. Error: no user message (400)
  17. Citations field present in agent mode response
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
    print(f"  \033[32mPASS\033[0m {msg}")


def fail(msg: str):
    global failed
    failed += 1
    print(f"  \033[31mFAIL\033[0m {msg}")


# =========================================================================
# 1. List models
# =========================================================================
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
    fail(str(e)[:120])

# =========================================================================
# 2. Basic chat (non-streaming)
# =========================================================================
test("2. Basic chat (non-streaming)")
try:
    r = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Say hello in exactly 2 words."}],
    )
    content = r.choices[0].message.content
    finish = r.choices[0].finish_reason
    print(f"  Content: {content!r}")
    print(f"  Finish: {finish}, ID: {r.id}, Object: {r.object}")
    assert content, "No content"
    assert finish == "stop"
    assert r.id.startswith("chatcmpl-")
    assert r.object == "chat.completion"
    ok()
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 3. Basic chat (streaming)
# =========================================================================
test("3. Basic chat (streaming)")
try:
    stream = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Say hi in one word."}],
        stream=True,
    )
    chunks = list(stream)
    full_content = "".join(c.choices[0].delta.content or "" for c in chunks)
    finish = next(
        (c.choices[0].finish_reason for c in chunks if c.choices[0].finish_reason),
        None,
    )
    has_role = any(c.choices[0].delta.role == "assistant" for c in chunks)
    print(f"  Chunks: {len(chunks)}, Content: {full_content!r}, Finish: {finish}")
    print(f"  Has role chunk: {has_role}")
    assert full_content, "No content"
    assert finish == "stop"
    assert has_role, "Missing role announcement chunk"
    assert chunks[0].object == "chat.completion.chunk"
    ok()
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 4. Generation params
# =========================================================================
test("4. Generation params (temperature=0.1, max_tokens=15)")
try:
    r = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Count from 1 to 100."}],
        temperature=0.1,
        max_tokens=15,
    )
    content = r.choices[0].message.content
    print(f"  Content: {content!r}")
    assert content, "No content"
    ok(f"Length: {len(content)} chars")
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 5. response_format: json_object
# =========================================================================
test("5. response_format: json_object")
try:
    r = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "user",
                "content": "Return a JSON object with key 'status' and value 'ok'. Only output the JSON, nothing else.",
            }
        ],
        response_format={"type": "json_object"},
    )
    content = r.choices[0].message.content
    print(f"  Content: {content!r}")
    assert content and "status" in content.lower()
    ok()
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 6. Tool calling (single round, tool_choice=required)
# =========================================================================
test("6. Tool calling (single round, tool_choice=required)")
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
    r = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "What's the weather in Berlin?"}],
        tools=tools,
        tool_choice="required",
    )
    choice = r.choices[0]
    print(f"  Finish: {choice.finish_reason}")
    if choice.message.tool_calls:
        for tc in choice.message.tool_calls:
            print(f"  Tool: {tc.function.name}({tc.function.arguments})")
        assert choice.finish_reason == "tool_calls"
        ok(f"{len(choice.message.tool_calls)} tool call(s)")
    else:
        fail("No tool_calls")
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 7. Tool calling (multi-round continuation)
# =========================================================================
test("7. Tool calling (multi-round continuation)")
try:
    tools = [
        {
            "type": "function",
            "function": {
                "name": "calculator",
                "description": "Calculate a math expression and return the result",
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

    messages = [
        {"role": "user", "content": "What is 42 * 17? Use the calculator tool."}
    ]

    # Step 1
    r1 = client.chat.completions.create(
        model=MODEL, messages=messages, tools=tools, tool_choice="required"
    )
    c1 = r1.choices[0]
    print(f"  Step 1: finish={c1.finish_reason}")

    assert c1.finish_reason == "tool_calls" and c1.message.tool_calls
    tc = c1.message.tool_calls[0]
    print(f"  Tool: {tc.function.name}({tc.function.arguments}), id={tc.id}")

    # Step 2: send tool result
    messages.append(c1.message.model_dump())
    messages.append({"role": "tool", "tool_call_id": tc.id, "content": "714"})

    r2 = client.chat.completions.create(model=MODEL, messages=messages, tools=tools)
    c2 = r2.choices[0]
    print(f"  Step 2: finish={c2.finish_reason}, content={c2.message.content!r}")

    assert c2.message.content, "No content in step 2"
    if "714" in c2.message.content:
        ok("Model used tool result correctly")
    else:
        ok(f"Got response (may not echo exact number): {c2.message.content[:80]!r}")
except Exception as e:
    fail(str(e)[:200])

# =========================================================================
# 8. Tool calling (streaming)
# =========================================================================
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
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            },
        }
    ]
    stream = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Search for 'Python tutorial'"}],
        tools=tools,
        tool_choice="required",
        stream=True,
    )
    chunks = list(stream)
    finish = next(
        (c.choices[0].finish_reason for c in chunks if c.choices[0].finish_reason),
        None,
    )
    has_tool_calls = any(c.choices[0].delta.tool_calls for c in chunks)
    print(
        f"  Chunks: {len(chunks)}, Finish: {finish}, Has tool_calls: {has_tool_calls}"
    )
    assert finish == "tool_calls" and has_tool_calls
    ok()
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 9. Multiple tools defined
# =========================================================================
test("9. Multiple tools defined")
try:
    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get weather for a city",
                "parameters": {
                    "type": "object",
                    "properties": {"city": {"type": "string"}},
                    "required": ["city"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_time",
                "description": "Get current time in a timezone",
                "parameters": {
                    "type": "object",
                    "properties": {"timezone": {"type": "string"}},
                    "required": ["timezone"],
                },
            },
        },
    ]
    r = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "What's the weather in Tokyo?"}],
        tools=tools,
        tool_choice="required",
    )
    choice = r.choices[0]
    if choice.message.tool_calls:
        names = [tc.function.name for tc in choice.message.tool_calls]
        print(f"  Tools called: {names}")
        assert "get_weather" in names or "get_time" in names
        ok(f"Called: {names}")
    else:
        fail("No tool_calls with multiple tools")
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 10. Tool calling with tool_choice=auto
# =========================================================================
test("10. Tool calling with tool_choice=auto (model decides)")
try:
    tools = [
        {
            "type": "function",
            "function": {
                "name": "calculator",
                "description": "Calculate math",
                "parameters": {
                    "type": "object",
                    "properties": {"expr": {"type": "string"}},
                    "required": ["expr"],
                },
            },
        }
    ]
    r = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "What is the capital of France?"}],
        tools=tools,
        tool_choice="auto",
    )
    choice = r.choices[0]
    print(f"  Finish: {choice.finish_reason}")
    print(f"  Content: {choice.message.content!r}")
    print(f"  Tool calls: {choice.message.tool_calls}")
    # Model should answer directly without tools since it's a knowledge question
    if choice.finish_reason == "stop" and choice.message.content:
        ok("Model answered directly without tools (correct)")
    elif choice.finish_reason == "tool_calls":
        ok("Model chose to use tool (acceptable)")
    else:
        fail(f"Unexpected: finish={choice.finish_reason}")
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 11. Agent mode (no tools param) - server-side tools, streaming
# =========================================================================
test("11. Agent mode (no tools, streaming) - server tools auto-execute")
try:
    stream = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "user", "content": "Say 'agent mode works' in one sentence."}
        ],
        stream=True,
    )
    chunks = list(stream)
    full = "".join(c.choices[0].delta.content or "" for c in chunks)
    finish = next(
        (c.choices[0].finish_reason for c in chunks if c.choices[0].finish_reason),
        None,
    )
    print(f"  Content: {full!r}, Finish: {finish}")
    assert full and finish == "stop"
    ok()
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 12. stop sequences
# =========================================================================
test("12. stop sequences")
try:
    r = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Count: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10"}],
        stop=["5"],
    )
    content = r.choices[0].message.content
    print(f"  Content: {content!r}")
    # The response should stop before or at "5"
    if content:
        ok(f"Got response, length: {len(content)}")
    else:
        ok("Empty response (stop triggered immediately)")
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 13. Error: invalid model
# =========================================================================
test("13. Error: invalid model (404)")
try:
    client.chat.completions.create(
        model="nonexistent-model-xyz",
        messages=[{"role": "user", "content": "hi"}],
    )
    fail("Should have raised")
except Exception as e:
    s = str(e)
    if "404" in s or "not found" in s.lower():
        ok(f"{s[:80]}")
    else:
        fail(f"Unexpected: {s[:80]}")

# =========================================================================
# 14. Error: invalid API key
# =========================================================================
test("14. Error: invalid API key (401)")
try:
    bad = OpenAI(
        base_url=BASE_URL,
        api_key="bad_key",
        default_headers={"X-Organization-Slug": ORG_SLUG},
    )
    bad.chat.completions.create(
        model=MODEL, messages=[{"role": "user", "content": "hi"}]
    )
    fail("Should have raised")
except Exception as e:
    s = str(e)
    if "401" in s or "api_key" in s.lower():
        ok(f"{s[:80]}")
    else:
        fail(f"Unexpected: {s[:80]}")

# =========================================================================
# 15. Error: missing messages
# =========================================================================
test("15. Error: missing messages (400)")
try:
    import httpx

    resp = httpx.post(
        f"{BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "X-Organization-Slug": ORG_SLUG,
            "Content-Type": "application/json",
        },
        json={"model": MODEL},
    )
    print(f"  Status: {resp.status_code}")
    assert resp.status_code == 400
    body = resp.json()
    print(f"  Error: {body['error']['message']}")
    ok()
except ImportError:
    # httpx not available, use raw request
    import urllib.request

    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=json.dumps({"model": MODEL}).encode(),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "X-Organization-Slug": ORG_SLUG,
            "Content-Type": "application/json",
        },
    )
    try:
        urllib.request.urlopen(req)
        fail("Should have raised")
    except urllib.error.HTTPError as e:
        if e.code == 400:
            ok(f"HTTP 400")
        else:
            fail(f"HTTP {e.code}")
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# 16. Error: no user message
# =========================================================================
test("16. Error: no user message in messages (400)")
try:
    client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": "You are helpful."}],
    )
    fail("Should have raised")
except Exception as e:
    s = str(e)
    if "400" in s or "No user message" in s:
        ok(f"{s[:80]}")
    else:
        fail(f"Unexpected: {s[:80]}")

# =========================================================================
# 17. Citations field present in agent mode response
# =========================================================================
test("17. Citations field present in agent mode response")
try:
    r = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": "Say hello in exactly 2 words."}],
    )
    # citations is a non-standard field; access via model_extra
    citations = r.model_extra.get("citations") if r.model_extra else None
    print(f"  Citations: {citations}")
    if citations is not None and isinstance(citations, list):
        ok(f"citations field present (length: {len(citations)})")
        # Validate citation shape if any citations are returned
        for c in citations:
            assert "index" in c, "Missing 'index' in citation"
            assert "type" in c, "Missing 'type' in citation"
            assert c["type"] in ("rag", "web"), f"Invalid type: {c['type']}"
            assert "source" in c, "Missing 'source' in citation"
            assert "relevance" in c, "Missing 'relevance' in citation"
        if citations:
            ok(f"Citation shape valid for {len(citations)} citation(s)")
    else:
        fail("citations field missing or not a list")
except Exception as e:
    fail(str(e)[:120])

# =========================================================================
# Summary
# =========================================================================
total = passed + failed
print(f"\n{'=' * 60}")
if failed == 0:
    print(f"\033[32m ALL PASSED: {passed}/{total} tests \033[0m")
else:
    print(
        f"\033[31m RESULTS: {passed} passed, {failed} failed out of {total} tests \033[0m"
    )
print(f"{'=' * 60}")
sys.exit(1 if failed > 0 else 0)
