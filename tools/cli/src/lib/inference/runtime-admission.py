"""Version-specific, in-process admission for the unchanged signed oMLX app.

Only the explicit Tale entrypoint installs this ASGI middleware. Model repository
code, sitecustomize, a second server and global Python changes are not involved.
"""

import asyncio
from collections import deque
import hashlib
import hmac
import json
import os
from pathlib import Path
import stat
import sys
import time


class Admission:
    def __init__(self, app, *, policy, key, observe, settle):
        self.app = app
        self.policy = policy
        self.key = key
        self.observe = observe
        self.settle = settle
        self.queue = deque()
        self.preparing = 0
        self.active = None
        self.worker = None
        self.held = False
        self.completed = 0
        self.rejected = 0
        self.cancelled = 0
        self.maximum_active = 0
        self.maximum_waiting = 0

    async def reply(self, send, status, message):
        body = json.dumps(
            {"error": {"message": message, "type": "inference_admission"}}
        ).encode()
        try:
            await send(
                {
                    "type": "http.response.start",
                    "status": status,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"retry-after", b"10"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
        except (OSError, asyncio.CancelledError):
            pass

    def metadata(self):
        observed = self.observe()
        return {
            "schemaVersion": 1,
            "adapterSha256": self.policy["adapterSha256"],
            "policySha256": self.policy["policySha256"],
            "residency": "evictable-on-demand",
            "maximumConcurrency": 1,
            "queueLimit": self.policy["queuedRequests"],
            "ready": not self.held,
            "phase": "held" if self.held else "busy" if self.active else "idle",
            "activeRole": self.active["model"]["key"] if self.active else None,
            "queued": len(self.queue),
            "preparing": self.preparing,
            "completed": self.completed,
            "rejected": self.rejected,
            "cancelled": self.cancelled,
            "maximumObservedActive": self.maximum_active,
            "maximumObservedWaiting": self.maximum_waiting,
            "models": observed["models"],
        }

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path")
        if path not in {"/v1/chat/completions", "/v1/embeddings", "/_tale/admission"}:
            readable = {
                "/health",
                "/api/status",
                "/v1/models",
                "/v1/models/status",
                "/admin/api/activity",
            }
            sessions = {"/admin/api/login", "/admin/api/logout"}
            if (scope.get("method") == "GET" and path in readable) or (
                scope.get("method") == "POST" and path in sessions
            ):
                return await self.app(scope, receive, send)
            return await self.reply(send, 404, "Unsupported inference route.")
        authorization = [
            value
            for name, value in scope.get("headers", [])
            if name.lower() == b"authorization"
        ]
        if len(authorization) != 1 or not hmac.compare_digest(
            authorization[0], b"Bearer " + self.key.encode()
        ):
            return await self.reply(send, 401, "Inference authentication is required.")
        if path == "/_tale/admission":
            if scope.get("method") != "GET":
                return await self.reply(send, 405, "Unsupported inference method.")
            try:
                data = self.metadata()
                body = json.dumps(data, separators=(",", ":")).encode()
            except Exception:
                self.held = True
                return await self.reply(
                    send,
                    503,
                    "Inference state is uncertain; inspect and restart the exact service.",
                )
            await send(
                {
                    "type": "http.response.start",
                    "status": 200 if data["ready"] else 503,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            return await send({"type": "http.response.body", "body": body})
        if scope.get("method") != "POST":
            return await self.reply(send, 405, "Unsupported inference method.")
        if (
            self.held
            or self.preparing + len(self.queue) + int(self.active is not None)
            >= self.policy["queuedRequests"] + 1
        ):
            self.rejected += 1
            return await self.reply(
                send, 503, "Inference is busy or held; no work was started."
            )
        # Reserve bounded input capacity before the first await. All listeners
        # and roles share this one middleware instance in one native process.
        self.preparing += 1
        try:
            body = bytearray()
            async with asyncio.timeout(self.policy["bodyTimeoutSeconds"]):
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        self.cancelled += 1
                        return
                    if message["type"] != "http.request":
                        raise ValueError("Invalid request message")
                    body.extend(message.get("body", b""))
                    if len(body) > self.policy["maximumBodyBytes"]:
                        return await self.reply(
                            send, 413, "Inference request exceeds its bounded size."
                        )
                    if not message.get("more_body", False):
                        break
            value = json.loads(body)
            if not isinstance(value, dict):
                raise ValueError("Invalid request body")
            model = next(
                (
                    item
                    for item in self.policy["models"]
                    if item["apiModel"] == value.get("model")
                ),
                None,
            )
            if model is None or (
                (path == "/v1/embeddings") != (model["capability"] == "embedding")
            ):
                raise ValueError("Unknown model or route")
            if "max_tokens" in value and (
                type(value["max_tokens"]) is not int
                or not 0 < value["max_tokens"] <= model["maxTokens"]
            ):
                raise ValueError("Invalid output budget")
            if path == "/v1/embeddings":
                items = value.get("input")
                if not (
                    isinstance(items, str)
                    or isinstance(items, list)
                    and 0 < len(items) <= 64
                    and all(isinstance(item, str) for item in items)
                ):
                    raise ValueError("Invalid embedding batch")
        except (ValueError, TypeError, KeyError, TimeoutError):
            self.rejected += 1
            return await self.reply(
                send, 400, "Invalid, oversized or incomplete inference request."
            )
        finally:
            self.preparing -= 1
        loop = asyncio.get_running_loop()
        job = {
            "scope": scope,
            "body": bytes(body),
            "model": model,
            "send": send,
            "future": loop.create_future(),
            "started": False,
            "disconnected": False,
            "headers": False,
            "finished": False,
            "receivedAt": loop.time(),
            "sendLock": asyncio.Lock(),
        }
        self.queue.append(job)
        self.maximum_waiting = max(
            self.maximum_waiting, max(0, len(self.queue) - int(self.active is None))
        )
        if self.worker is None:
            self.worker = asyncio.create_task(self.run())
        disconnect = asyncio.create_task(self.disconnect(receive))
        expiry = asyncio.create_task(asyncio.sleep(self.policy["queueTimeoutSeconds"]))
        try:
            done, _ = await asyncio.wait(
                {job["future"], disconnect, expiry}, return_when=asyncio.FIRST_COMPLETED
            )
            if expiry in done and not job["future"].done():
                if not job["started"]:
                    self.queue.remove(job)
                    self.rejected += 1
                    await self.fail_job(
                        job, "Inference queue expired; no work was started."
                    )
                    job["future"].set_result(None)
                else:
                    done, _ = await asyncio.wait(
                        {job["future"], disconnect}, return_when=asyncio.FIRST_COMPLETED
                    )
            if disconnect in done and not job["future"].done():
                self.cancelled += 1
                job["disconnected"] = True
                if not job["started"]:
                    self.queue.remove(job)
                    job["future"].set_result(None)
        except asyncio.CancelledError:
            job["disconnected"] = True
            self.cancelled += 1
            if not job["started"] and not job["future"].done():
                self.queue.remove(job)
                job["future"].set_result(None)
            raise
        finally:
            disconnect.cancel()
            expiry.cancel()
            await asyncio.gather(disconnect, expiry, return_exceptions=True)

    async def fail_job(self, job, message):
        async with job["sendLock"]:
            writable = not job["headers"] and not job["disconnected"]
            job["disconnected"] = True
            if writable:
                await self.reply(job["send"], 503, message)

    async def disconnect(self, receive):
        while (await receive())["type"] != "http.disconnect":
            await asyncio.sleep(0)

    async def run(self):
        try:
            while self.queue:
                job = self.queue.popleft()
                job["started"] = True
                self.active = job
                try:
                    if (
                        self.held
                        or asyncio.get_running_loop().time() - job["receivedAt"]
                        > self.policy["queueTimeoutSeconds"]
                    ):
                        self.rejected += 1
                        await self.fail_job(
                            job,
                            "Inference queue expired or the node is held; no work was started.",
                        )
                        continue
                    before = self.observe()
                    if not before["idle"]:
                        self.held = True
                        await self.fail_job(
                            job, "Prior native work has not settled; admission is held."
                        )
                        continue
                    job["cold"] = not next(
                        model["loaded"]
                        for model in before["models"]
                        if model["key"] == job["model"]["key"]
                    )
                    job["queueMs"] = (
                        asyncio.get_running_loop().time() - job["receivedAt"]
                    ) * 1000
                    self.maximum_active = max(self.maximum_active, 1)
                    application = asyncio.create_task(self.execute(job))
                    try:
                        # A timeout never cancels accepted native work or frees
                        # its slot. Hold new admissions, then wait for teardown.
                        await asyncio.wait_for(
                            asyncio.shield(application),
                            self.policy["requestTimeoutSeconds"],
                        )
                    except TimeoutError:
                        self.held = True
                        await self.fail_job(
                            job,
                            "Inference exceeded its deadline; the node is held until restart.",
                        )
                        await asyncio.shield(application)
                    if not job["finished"]:
                        self.held = True
                    if not await self.settle():
                        self.held = True
                    self.completed += 1
                except BaseException:
                    self.held = True
                    await self.fail_job(
                        job,
                        "Native inference did not settle; inspect and restart the exact service.",
                    )
                finally:
                    self.active = None
                    if not job["future"].done():
                        job["future"].set_result(None)
        finally:
            self.worker = None

    async def execute(self, job):
        delivered = False
        never_disconnect = asyncio.Event()

        async def receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": job["body"], "more_body": False}
            # Accepted work drains on disconnect instead of cancelling a native
            # executor future whose underlying GPU work may still be running.
            await never_disconnect.wait()
            return {"type": "http.disconnect"}

        async def send(message):
            async with job["sendLock"]:
                if message["type"] == "http.response.start":
                    job["headers"] = True
                    message = dict(message)
                    message["headers"] = list(message.get("headers", [])) + [
                        (
                            b"x-tale-admission-sha256",
                            self.policy["adapterSha256"].encode(),
                        ),
                        (b"x-tale-model-cold", b"true" if job["cold"] else b"false"),
                        (b"x-tale-queue-ms", str(job["queueMs"]).encode()),
                    ]
                if message["type"] == "http.response.body" and not message.get(
                    "more_body", False
                ):
                    job["finished"] = True
                if not job["disconnected"]:
                    try:
                        await job["send"](message)
                    except OSError:
                        job["disconnected"] = True

        await self.app(job["scope"], receive, send)


def private_json(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_mode & 0o077
            or info.st_size > 4194304
        ):
            raise ValueError("Invalid private admission state")
        return json.load(handle)


def main():
    # Fixed explicit asset path; no extension search, runtime file patch, or
    # imported model repository code. Uvicorn must stay in one worker process.
    base = Path(__file__).resolve().parent
    policy = private_json(base / "admission.json")
    expected_hash = policy.pop("policySha256")
    actual_hash = hashlib.sha256(
        json.dumps(
            policy, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode()
    ).hexdigest()
    if (
        actual_hash != expected_hash
        or policy["adapterSha256"]
        != hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    ):
        raise ValueError("Admission asset or policy identity differs")
    policy["policySha256"] = expected_hash
    settings = private_json(base / "settings.json")
    key = settings["auth"]["sub_keys"][0]["key"]
    os.environ["WEB_CONCURRENCY"] = "1"
    from omlx import server
    from omlx.cli import main as native_main
    from omlx.engine_core import get_mlx_executor
    import mlx.core as mx

    def observe():
        pool = server.get_engine_pool()
        values = pool.get_status()["models"]
        if {item["id"] for item in values} != {
            item["identity"] for item in policy["models"]
        } or len(values) != len(policy["models"]):
            raise ValueError("Native inventory differs")
        idle = True
        result = []
        for model in policy["models"]:
            entry = pool.get_entry(model["identity"])
            if (
                entry is None
                or entry.model_path != model["modelPath"]
                or entry.is_pinned
                or type(entry.is_loading) is not bool
                or type(entry.in_use) is not int
                or entry.in_use < 0
            ):
                raise ValueError("Native model state differs")
            if entry.is_loading or entry.in_use:
                idle = False
            if entry.engine is not None:
                active = entry.engine.has_active_requests()
                if type(active) is not bool:
                    raise ValueError("Native activity is uncertain")
                idle = idle and not active
            result.append(
                {
                    "key": model["key"],
                    "identity": model["identity"],
                    "loaded": entry.engine is not None,
                    "loading": entry.is_loading,
                }
            )
        return {"idle": idle, "models": result}

    async def settle():
        # Run the native public synchronization barrier on the same executor
        # used by embedding/model loads. A deadline holds; it never frees work.
        barrier = asyncio.get_running_loop().run_in_executor(
            get_mlx_executor(), mx.synchronize
        )
        done, _ = await asyncio.wait({barrier}, timeout=5)
        if not done:
            await asyncio.shield(barrier)
            return False
        barrier.result()
        deadline = time.monotonic() + 5
        while not observe()["idle"]:
            if time.monotonic() >= deadline:
                return False
            await asyncio.sleep(0.05)
        return True

    server.app.add_middleware(
        Admission, policy=policy, key=key, observe=observe, settle=settle
    )
    sys.argv = [sys.argv[0], "serve", "--base-path", str(base)]
    native_main()


if __name__ == "__main__":
    main()
