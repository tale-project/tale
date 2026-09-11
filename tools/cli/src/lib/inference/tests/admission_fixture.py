"""Model-free tests of the exact packaged ASGI admission source."""

import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import unittest

module_spec = importlib.util.spec_from_file_location("tale_admission", sys.argv[1])
admission = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(admission)
KEY = "s" * 32


def policy():
    return {
        "adapterSha256": "a" * 64,
        "policySha256": "b" * 64,
        "queuedRequests": 4,
        "bodyTimeoutSeconds": 1,
        "queueTimeoutSeconds": 1,
        "requestTimeoutSeconds": 1,
        "maximumBodyBytes": 4096,
        "models": [
            {
                "key": role,
                "apiModel": role,
                "identity": str(index) * 64,
                "capability": capability,
                "maxTokens": 1024,
            }
            for index, (role, capability) in enumerate(
                [
                    ("reasoning", "text"),
                    ("vision", "vision"),
                    ("embedding", "embedding"),
                ],
                1,
            )
        ],
    }


class Harness:
    def __init__(self, **limits):
        self.policy = policy()
        self.policy.update(limits)
        self.active = 0
        self.peak = 0
        self.entered = []
        self.loaded = set()
        self.wait = asyncio.Event()
        self.release = asyncio.Event()
        self.cleanup = True
        self.gate = admission.Admission(
            self.app,
            policy=self.policy,
            key=KEY,
            observe=self.observe,
            settle=self.settle,
        )

    def observe(self):
        return {
            "idle": self.active == 0,
            "models": [
                {
                    "key": model["key"],
                    "identity": model["identity"],
                    "loaded": model["key"] in self.loaded,
                    "loading": False,
                }
                for model in self.policy["models"]
            ],
        }

    async def settle(self):
        return self.cleanup and self.active == 0

    async def app(self, scope, receive, send):
        if scope["path"] == "/api/status":
            return await self.response(
                send,
                {"entered": self.entered, "peak": self.peak, "active": self.active},
            )
        body = json.loads((await receive())["body"])
        model = body["model"]
        self.entered.append(model)
        self.active += 1
        self.peak = max(self.peak, self.active)
        self.loaded = {model}
        self.wait.set()
        try:
            if body.get("hold"):
                await self.release.wait()
            await asyncio.sleep(body.get("delay", 0.01))
            if body.get("raise"):
                raise RuntimeError("Synthetic internal detail must not escape")
            if model == "embedding":
                inputs = (
                    body["input"]
                    if isinstance(body["input"], list)
                    else [body["input"]]
                )
                return await self.response(
                    send,
                    {
                        "data": [
                            {"index": index, "embedding": [float(index + 1)]}
                            for index in range(len(inputs))
                        ]
                    },
                )
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"text/event-stream")],
                }
            )
            await send(
                {
                    "type": "http.response.body",
                    "body": b"data: accepted\n\n",
                    "more_body": True,
                }
            )
            if body.get("holdAfterHeaders"):
                await self.release.wait()
            await asyncio.sleep(body.get("afterHeaders", 0.01))
            await send(
                {
                    "type": "http.response.body",
                    "body": b"data: [DONE]\n\n",
                    "more_body": False,
                }
            )
        finally:
            self.active -= 1

    async def response(self, send, value):
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send({"type": "http.response.body", "body": json.dumps(value).encode()})

    def request(
        self,
        model="reasoning",
        *,
        path=None,
        token=KEY,
        method="POST",
        raw=None,
        **body,
    ):
        request = {
            "model": model,
            **({"input": ["synthetic"]} if model == "embedding" else {}),
            **body,
        }
        queue = asyncio.Queue()
        queue.put_nowait(
            {
                "type": "http.request",
                "body": raw if raw is not None else json.dumps(request).encode(),
            }
        )
        messages = []
        headers = asyncio.Event()

        async def send(value):
            messages.append(value)
            if value["type"] == "http.response.start":
                headers.set()

        scope = {
            "type": "http",
            "method": method,
            "path": path
            or ("/v1/embeddings" if model == "embedding" else "/v1/chat/completions"),
            "headers": [(b"authorization", ("Bearer " + token).encode())],
        }
        task = asyncio.create_task(self.gate(scope, queue.get, send))
        return task, queue, messages, headers


class Tests(unittest.IsolatedAsyncioTestCase):
    async def test_fifo_across_all_roles(self):
        h = Harness()
        first = h.request(hold=True)
        await h.wait.wait()
        second = h.request("vision")
        third = h.request("embedding")
        await asyncio.sleep(0.01)
        self.assertEqual(h.entered, ["reasoning"])
        h.release.set()
        await asyncio.gather(first[0], second[0], third[0])
        self.assertEqual(h.entered, ["reasoning", "vision", "embedding"])
        self.assertEqual(h.peak, 1)

    async def test_capacity_includes_active_and_waiting(self):
        h = Harness(queuedRequests=1)
        a = h.request(hold=True)
        await h.wait.wait()
        b = h.request("vision")
        await asyncio.sleep(0)
        c = h.request("embedding")
        await c[0]
        self.assertEqual(c[2][0]["status"], 503)
        self.assertEqual(h.entered, ["reasoning"])
        h.release.set()
        await asyncio.gather(a[0], b[0])
        self.assertEqual(h.gate.maximum_waiting, 1)

    async def test_cancelled_queued_request_never_enters(self):
        h = Harness()
        a = h.request(hold=True)
        await h.wait.wait()
        b = h.request("embedding")
        await asyncio.sleep(0)
        b[1].put_nowait({"type": "http.disconnect"})
        await b[0]
        h.release.set()
        await a[0]
        self.assertEqual(h.entered, ["reasoning"])

    async def test_disconnected_active_work_keeps_slot_until_actual_finish(self):
        h = Harness()
        a = h.request(afterHeaders=0.08)
        await a[3].wait()
        a[1].put_nowait({"type": "http.disconnect"})
        await a[0]
        self.assertEqual(h.active, 1)
        b = h.request("vision")
        await asyncio.sleep(0.02)
        self.assertEqual(h.entered, ["reasoning"])
        await b[0]
        self.assertEqual(h.peak, 1)
        self.assertEqual(h.entered, ["reasoning", "vision"])

    async def test_cancelled_handler_does_not_cancel_native_task(self):
        h = Harness()
        a = h.request(afterHeaders=0.06)
        await a[3].wait()
        a[0].cancel()
        await asyncio.gather(a[0], return_exceptions=True)
        self.assertEqual(h.active, 1)
        b = h.request("embedding")
        await b[0]
        self.assertEqual(h.peak, 1)

    async def test_expired_queue_is_removed_while_active_work_continues(self):
        h = Harness(queueTimeoutSeconds=0.025)
        a = h.request(hold=True)
        await h.wait.wait()
        b = h.request("vision")
        await b[0]
        self.assertEqual(b[2][0]["status"], 503)
        self.assertEqual(len(h.gate.queue), 0)
        h.release.set()
        await a[0]
        self.assertEqual(h.entered, ["reasoning"])

    async def test_accepted_deadline_holds_and_does_not_release_running_work(self):
        h = Harness(requestTimeoutSeconds=0.025)
        a = h.request(hold=True)
        await h.wait.wait()
        await asyncio.sleep(0.04)
        self.assertTrue(h.gate.held)
        self.assertEqual(h.active, 1)
        b = h.request("vision")
        await b[0]
        self.assertEqual(b[2][0]["status"], 503)
        h.release.set()
        await a[0]
        self.assertEqual(h.entered, ["reasoning"])
        self.assertTrue(h.gate.held)

    async def test_uncertain_native_cleanup_holds_future_roles(self):
        h = Harness()
        h.cleanup = False
        await h.request()[0]
        b = h.request("embedding")
        await b[0]
        self.assertEqual(b[2][0]["status"], 503)
        self.assertEqual(h.entered, ["reasoning"])

    async def test_native_busy_preimage_holds_before_application(self):
        h = Harness()
        h.active = 1
        request = h.request()
        await request[0]
        self.assertEqual(request[2][0]["status"], 503)
        self.assertEqual(h.entered, [])

    async def test_invalid_requests_never_enter(self):
        cases = [
            dict(token="wrong"),
            dict(model="unknown"),
            dict(raw=b"[]"),
            dict(raw=b"{"),
            dict(max_tokens=0),
            dict(max_tokens=True),
            dict(max_tokens=1025),
            dict(path="/v1/completions"),
            dict(path="/v1/models/reasoning/load"),
            dict(method="PUT"),
            dict(model="embedding", input=["x"] * 65),
        ]
        for case in cases:
            h = Harness()
            request = h.request(**case)
            await request[0]
            self.assertGreaterEqual(request[2][0]["status"], 400)
            self.assertEqual(h.entered, [])

    async def test_native_64_item_embedding_batch_preserves_order(self):
        h = Harness()
        request = h.request("embedding", input=[str(index) for index in range(64)])
        await request[0]
        value = json.loads(request[2][1]["body"])
        self.assertEqual(len(value["data"]), 64)
        self.assertEqual([item["index"] for item in value["data"]], list(range(64)))
        self.assertEqual(
            [item["embedding"] for item in value["data"]],
            [[float(index + 1)] for index in range(64)],
        )

    async def test_cold_model_inventory_is_distinct_from_gate_readiness(self):
        h = Harness()
        status = h.gate.metadata()
        self.assertTrue(status["ready"])
        self.assertTrue(all(not model["loaded"] for model in status["models"]))
        self.assertEqual(status["phase"], "idle")


async def serve(policy_file, listen_file):
    """Small HTTP/1 ASGI test driver; no framework/runtime/model execution."""
    harness = Harness()
    harness.policy = json.loads(Path(policy_file).read_text())
    harness.gate = admission.Admission(
        harness.app,
        policy=harness.policy,
        key=KEY,
        observe=harness.observe,
        settle=harness.settle,
    )

    async def connection(reader, writer):
        disconnected = None
        try:
            first = await reader.readline()
            method, target, _ = first.decode().strip().split(" ")
            headers = []
            while True:
                line = await reader.readline()
                if line == b"\r\n":
                    break
                name, value = line.rstrip(b"\r\n").split(b":", 1)
                headers.append((name.lower(), value.strip()))
            length = int(
                next(
                    (value for name, value in headers if name == b"content-length"),
                    b"0",
                )
            )
            body = await reader.readexactly(length)
            # Synthetic driver coordination, never an application/model route.
            if method == "POST" and target == "/__fixture/release":
                harness.release.set()
                writer.write(
                    b"HTTP/1.1 204 Test\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                )
                await writer.drain()
                return
            messages = asyncio.Queue()
            messages.put_nowait({"type": "http.request", "body": body})

            async def watch():
                await reader.read()
                messages.put_nowait({"type": "http.disconnect"})

            disconnected = asyncio.create_task(watch())

            async def send(message):
                if message["type"] == "http.response.start":
                    output = f"HTTP/1.1 {message['status']} Test\r\n".encode()
                    for name, value in message.get("headers", []):
                        output += name + b": " + value + b"\r\n"
                    writer.write(
                        output
                        + b"transfer-encoding: chunked\r\nconnection: close\r\n\r\n"
                    )
                else:
                    chunk = message.get("body", b"")
                    if chunk:
                        writer.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                    if not message.get("more_body", False):
                        writer.write(b"0\r\n\r\n")
                await writer.drain()

            await harness.gate(
                {
                    "type": "http",
                    "method": method,
                    "path": target.split("?")[0],
                    "headers": headers,
                },
                messages.get,
                send,
            )
        except (OSError, ValueError, asyncio.IncompleteReadError):
            pass
        finally:
            if disconnected:
                disconnected.cancel()
                await asyncio.gather(disconnected, return_exceptions=True)
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass

    server = await asyncio.start_server(connection, "127.0.0.1", 0)
    Path(listen_file).write_text(
        json.dumps({"port": server.sockets[0].getsockname()[1]})
    )
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[2] == "--serve":
        asyncio.run(serve(sys.argv[3], sys.argv[4]))
    else:
        unittest.main(argv=[sys.argv[0]], verbosity=2)
