// src/main.ts
import { timingSafeEqual } from "node:crypto";
import {
  createServer
} from "node:http";

// src/browser-control.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { get as httpGet } from "node:http";
var CDP_HOST = "127.0.0.1";
var CDP_PORT = 9222;
function cdpHost() {
  return process.env.TALE_CDP_HOST ?? CDP_HOST;
}
function cdpPort() {
  return Number(process.env.TALE_CDP_PORT ?? "") || CDP_PORT;
}
function ctrlDir() {
  return process.env.TALE_BROWSER_CTRL_DIR ?? "/tmp/tale-browser";
}
function pidFile() {
  return `${ctrlDir()}/pid`;
}
function resetFlag() {
  return `${ctrlDir()}/reset`;
}
var PROBE_TIMEOUT_MS = 3000;
var RECYCLE_WAIT_MS = 15000;
var RECYCLE_POLL_MS = 500;
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function httpGetText(path, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = httpGet({ host: cdpHost(), port: cdpPort(), path }, (res) => {
      const status = res.statusCode ?? 0;
      const chunks = [];
      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (status < 200 || status >= 300) {
          finish(() => reject(new Error(`GET ${path} -> ${status}`)));
          return;
        }
        finish(() => resolve(body));
      });
      res.on("error", (err) => finish(() => reject(err)));
    });
    const timer = setTimeout(() => finish(() => {
      req.destroy();
      reject(new Error(`GET ${path} timed out`));
    }), timeoutMs);
    req.on("error", (err) => finish(() => reject(err)));
  });
}
async function httpGetJson(path, timeoutMs) {
  return JSON.parse(await httpGetText(path, timeoutMs));
}
function closeQuietly(ws) {
  try {
    ws?.close();
  } catch (err) {
    console.warn("[runnerd] cdp ws close failed:", err);
  }
}
function cdpRoundTrip(wsUrl, method, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws;
    const finish = (fn) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      closeQuietly(ws);
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`cdp ${method} timed out`))), timeoutMs);
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      return;
    }
    ws.addEventListener("open", () => {
      try {
        ws?.send(JSON.stringify({ id: 1, method }));
      } catch (err) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    });
    ws.addEventListener("message", (ev) => {
      if (settled)
        return;
      try {
        const data = typeof ev.data === "string" ? ev.data : "";
        const msg = JSON.parse(data);
        if (msg.id === 1) {
          const result = msg.result && typeof msg.result === "object" ? msg.result : {};
          finish(() => resolve(result));
        }
      } catch (err) {
        console.warn("[runnerd] cdp frame parse failed:", err);
      }
    });
    ws.addEventListener("error", () => finish(() => reject(new Error(`cdp ${method} ws error`))));
    ws.addEventListener("close", () => finish(() => reject(new Error(`cdp ${method} ws closed early`))));
  });
}
async function probeCdp(timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    const version = await httpGetJson("/json/version", timeoutMs);
    const wsUrl = version.webSocketDebuggerUrl;
    if (!wsUrl)
      return { healthy: false, tabs: 0 };
    const result = await cdpRoundTrip(wsUrl, "Target.getTargets", timeoutMs);
    const infos = Array.isArray(result.targetInfos) ? result.targetInfos : [];
    const tabs = infos.filter((t) => t.type === "page").length;
    return { healthy: true, tabs };
  } catch {
    return { healthy: false, tabs: 0 };
  }
}
function readPid() {
  try {
    const n = Number(readFileSync(pidFile(), "utf8").trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function killBrowser(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    const gone = err !== null && typeof err === "object" && "code" in err && err.code === "ESRCH";
    if (!gone)
      console.warn("[runnerd] browser SIGKILL failed:", err);
  }
}
async function waitHealthy(deadlineMs) {
  const start = Date.now();
  for (;; ) {
    const health = await probeCdp(Math.min(PROBE_TIMEOUT_MS, deadlineMs));
    if (health.healthy)
      return health;
    if (Date.now() - start > deadlineMs)
      return health;
    await delay(RECYCLE_POLL_MS);
  }
}
async function restartBrowser(waitMs = RECYCLE_WAIT_MS) {
  const pid = readPid();
  if (pid !== null)
    killBrowser(pid);
  const health = await waitHealthy(waitMs);
  return { signalled: pid !== null, ready: health.healthy, tabs: health.tabs };
}
async function resetBrowser(waitMs = RECYCLE_WAIT_MS) {
  try {
    mkdirSync(ctrlDir(), { recursive: true });
    writeFileSync(resetFlag(), "1");
  } catch (err) {
    console.warn("[runnerd] could not write browser reset flag:", err);
  }
  const pid = readPid();
  if (pid !== null)
    killBrowser(pid);
  const health = await waitHealthy(waitMs);
  return { signalled: pid !== null, ready: health.healthy, tabs: health.tabs };
}
async function closePages() {
  let list;
  try {
    list = await httpGetJson("/json/list", PROBE_TIMEOUT_MS);
  } catch (err) {
    console.warn("[runnerd] browser closePages: /json/list failed:", err);
    return { closed: 0 };
  }
  const pages = (Array.isArray(list) ? list : []).filter((t) => t.type === "page" && typeof t.id === "string");
  let closed = 0;
  for (const p of pages) {
    try {
      await httpGetText(`/json/close/${encodeURIComponent(p.id)}`, PROBE_TIMEOUT_MS);
      closed += 1;
    } catch (err) {
      console.warn("[runnerd] browser closePages: close target failed:", err);
    }
  }
  return { closed };
}

// src/protocol.ts
var RUNNERD_PORT = 8200;
var RUNNERD_TOKEN_HEADER = "x-tale-runnerd-token";
var RUNNERD_MAX_LIVE_EXECS = 4;
var RUNNERD_RING_BUFFER_BYTES = 256 * 1024;
var RUNNERD_CONSUMER_BUFFER_MAX_BYTES = 8 * 1024 * 1024;
var RUNNERD_ENV_MAX_ENTRIES = 128;
var RUNNERD_ENV_MAX_VALUE_BYTES = 32 * 1024;
var RUNNERD_ENV_DENYLIST = ["HOME", "PATH", "TMPDIR"];
var RUNNERD_ENV_DENY_PREFIXES = ["TALE_RUNNERD_"];
var RUNNERD_ENV_DENY_PROXY_RE = /^(https?|no)_proxy$/i;
function isDeniedEnvName(name) {
  const upper = name.toUpperCase();
  if (RUNNERD_ENV_DENYLIST.some((v) => v === upper))
    return true;
  if (RUNNERD_ENV_DENY_PROXY_RE.test(name))
    return true;
  return RUNNERD_ENV_DENY_PREFIXES.some((p) => upper.startsWith(p));
}
var RUNNERD_STDIN_MAX_BYTES = 64 * 1024;
var WORKSPACE_ROOT = "/agent";
var ID_ALPHABET_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// src/env-store.ts
class EnvStore {
  store = new Map;
  constructor(seed) {
    if (seed) {
      for (const [k, v] of Object.entries(seed)) {
        if (isDeniedEnvName(k) || !this.acceptable(k, v))
          continue;
        this.store.set(k, v);
      }
    }
  }
  patch(set, unset) {
    const denied = [];
    if (set) {
      for (const [k, v] of Object.entries(set)) {
        if (isDeniedEnvName(k) || !this.acceptable(k, v)) {
          denied.push(k);
          continue;
        }
        this.store.set(k, v);
      }
    }
    if (unset) {
      for (const k of unset) {
        if (isDeniedEnvName(k)) {
          denied.push(k);
          continue;
        }
        this.store.delete(k);
      }
    }
    return denied;
  }
  acceptable(name, value) {
    if (this.store.size >= RUNNERD_ENV_MAX_ENTRIES && !this.store.has(name)) {
      return false;
    }
    return Buffer.byteLength(value, "utf8") <= RUNNERD_ENV_MAX_VALUE_BYTES;
  }
  resolve(overlay) {
    const out = {};
    for (const [k, v] of this.store)
      out[k] = v;
    if (overlay) {
      for (const [k, v] of Object.entries(overlay)) {
        if (!isDeniedEnvName(k))
          out[k] = v;
      }
    }
    return out;
  }
}

// src/exec-manager.ts
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
var SIGKILL_GRACE_MS = 5000;
var EXIT_DRAIN_GRACE_MS = 2000;
var RECENT_EXEC_LIMIT = 16;

class ExecManager {
  envStore;
  onActivity;
  live = new Map;
  recent = new Map;
  constructor(envStore, onActivity) {
    this.envStore = envStore;
    this.onActivity = onActivity;
  }
  liveCount() {
    return this.live.size;
  }
  has(execId) {
    return this.live.has(execId);
  }
  canAttach(execId) {
    return this.live.has(execId) || this.recent.has(execId);
  }
  attach(execId, emit, sinceSeq = 0) {
    const liveRec = this.live.get(execId);
    if (liveRec) {
      this.armDeadline(liveRec);
      for (const line of liveRec.ring)
        emitRingLine(line, emit, sinceSeq);
      liveRec.subscribers.add(emit);
      return liveRec.done.finally(() => liveRec.subscribers.delete(emit));
    }
    const recentRec = this.recent.get(execId);
    if (recentRec) {
      for (const line of recentRec.ring)
        emitRingLine(line, emit, sinceSeq);
      return Promise.resolve();
    }
    return null;
  }
  armDeadline(rec) {
    if (rec.timer)
      clearTimeout(rec.timer);
    rec.timer = setTimeout(() => {
      rec.timedOut = true;
      rec.kill("SIGTERM");
      setTimeout(() => rec.kill("SIGKILL"), SIGKILL_GRACE_MS);
    }, rec.timeoutMs);
  }
  extendDeadline(execId) {
    const rec = this.live.get(execId);
    if (!rec)
      return false;
    this.armDeadline(rec);
    return true;
  }
  retainRecent(execId, ring, exitCode) {
    this.recent.set(execId, { ring, exitCode });
    while (this.recent.size > RECENT_EXEC_LIMIT) {
      const oldest = this.recent.keys().next().value;
      if (oldest === undefined)
        break;
      this.recent.delete(oldest);
    }
  }
  resolveCwd(cwd) {
    const root = process.env.TALE_WORKSPACE_ROOT ?? WORKSPACE_ROOT;
    const requested = cwd ?? root;
    const abs = requested.startsWith("/") ? requested : `${root}/${requested}`;
    let real;
    try {
      real = realpathSync(abs);
    } catch {
      return null;
    }
    if (real !== root && !real.startsWith(`${root}/`)) {
      return null;
    }
    return real;
  }
  async run(req, emit) {
    if (!ID_ALPHABET_RE.test(req.execId)) {
      emit({ t: "fail", code: "BAD_REQUEST", message: "invalid execId" });
      return;
    }
    if (this.live.has(req.execId)) {
      emit({ t: "fail", code: "DUPLICATE_EXEC", message: req.execId });
      return;
    }
    const command = Array.isArray(req.command) ? req.command : undefined;
    const shell = typeof req.shell === "string" ? req.shell : undefined;
    const hasCommand = command !== undefined && command.length > 0;
    const hasShell = shell !== undefined && shell.length > 0;
    if (hasCommand === hasShell) {
      emit({
        t: "fail",
        code: "BAD_REQUEST",
        message: "exactly one of command[] or shell required"
      });
      return;
    }
    const cwd = this.resolveCwd(req.cwd);
    if (cwd === null) {
      emit({
        t: "fail",
        code: "INVALID_CWD",
        message: `cwd must resolve under ${WORKSPACE_ROOT} and exist`
      });
      return;
    }
    const env = {
      ...process.env,
      ...this.envStore.resolve(req.env)
    };
    const cmd = hasShell ? "bash" : command?.[0] ?? "";
    const args = hasShell ? ["-lc", shell ?? ""] : command?.slice(1) ?? [];
    this.onActivity();
    const startedAtMs = Date.now();
    const child = spawn(cmd, args, {
      cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTrunc = false;
    let stderrTrunc = false;
    let stdoutTruncLogged = false;
    let stderrTruncLogged = false;
    let settled = false;
    let resolveDone = () => {};
    const done = new Promise((r) => {
      resolveDone = r;
    });
    const record = {
      startedAtMs,
      exitCode: null,
      ring: [],
      ringBytes: 0,
      cancelRequested: false,
      subscribers: new Set,
      done,
      seq: 0,
      timeoutMs: req.timeoutMs,
      timer: null,
      timedOut: false,
      stdin: null,
      kill: (signal) => {
        try {
          if (child.pid !== undefined)
            process.kill(-child.pid, signal);
        } catch (err) {
          console.warn(`[runnerd] kill(${signal}) of pgroup ${child.pid} failed:`, err instanceof Error ? err.message : err);
        }
      }
    };
    this.live.set(req.execId, record);
    const ringEmit = (event) => {
      record.seq += 1;
      const stamped = { ...event, seq: record.seq };
      emit(stamped);
      for (const sub of record.subscribers) {
        try {
          sub(stamped);
        } catch (err) {
          console.warn("[runnerd] attach subscriber threw:", err);
        }
      }
      const line = `${JSON.stringify(stamped)}
`;
      record.ring.push(line);
      record.ringBytes += Buffer.byteLength(line, "utf8");
      while (record.ringBytes > RUNNERD_RING_BUFFER_BYTES && record.ring.length > 1) {
        const dropped = record.ring.shift();
        if (dropped === undefined)
          break;
        record.ringBytes -= Buffer.byteLength(dropped, "utf8");
      }
    };
    ringEmit({ t: "start", execId: req.execId, startedAtMs });
    if (req.stdinMode === "hold") {
      child.stdin.on("error", (err) => {
        console.warn("[runnerd] held stdin pipe error:", err.message);
        record.stdin = null;
      });
      record.stdin = child.stdin;
      if (req.stdinBase64) {
        try {
          child.stdin.write(Buffer.from(req.stdinBase64, "base64"));
        } catch (err) {
          console.warn("[runnerd] initial stdin write failed:", err);
        }
      }
    } else {
      child.stdin.on("error", (err) => {
        console.warn("[runnerd] close-mode stdin pipe error:", err.message);
      });
      if (req.stdinBase64) {
        try {
          child.stdin.end(Buffer.from(req.stdinBase64, "base64"));
        } catch (err) {
          console.warn("[runnerd] initial stdin end failed:", err);
        }
      } else {
        child.stdin.end();
      }
    }
    child.stdout.on("data", (chunk) => {
      if (settled)
        return;
      if (req.stdoutMaxBytes > 0) {
        const remaining = req.stdoutMaxBytes - stdoutBytes;
        if (remaining <= 0) {
          if (!stdoutTruncLogged) {
            stdoutTruncLogged = true;
            console.warn(`[runnerd] exec ${req.execId} stdout hit cap ${req.stdoutMaxBytes}B — further stdout dropped (truncated)`);
          }
          stdoutTrunc = true;
          return;
        }
        if (chunk.byteLength > remaining) {
          stdoutBytes += remaining;
          stdoutTrunc = true;
          ringEmit({
            t: "stdout",
            b64: chunk.subarray(0, remaining).toString("base64")
          });
          return;
        }
      }
      stdoutBytes += chunk.byteLength;
      ringEmit({ t: "stdout", b64: chunk.toString("base64") });
    });
    child.stderr.on("data", (chunk) => {
      if (settled)
        return;
      if (req.stderrMaxBytes > 0) {
        const remaining = req.stderrMaxBytes - stderrBytes;
        if (remaining <= 0) {
          if (!stderrTruncLogged) {
            stderrTruncLogged = true;
            console.warn(`[runnerd] exec ${req.execId} stderr hit cap ${req.stderrMaxBytes}B — further stderr dropped (truncated)`);
          }
          stderrTrunc = true;
          return;
        }
        if (chunk.byteLength > remaining) {
          stderrBytes += remaining;
          stderrTrunc = true;
          ringEmit({
            t: "stderr",
            b64: chunk.subarray(0, remaining).toString("base64")
          });
          return;
        }
      }
      stderrBytes += chunk.byteLength;
      ringEmit({ t: "stderr", b64: chunk.toString("base64") });
    });
    child.stdout.on("error", (err) => {
      console.warn("[runnerd] stdout pipe error:", err.message);
    });
    child.stderr.on("error", (err) => {
      console.warn("[runnerd] stderr pipe error:", err.message);
    });
    this.armDeadline(record);
    await new Promise((resolve) => {
      let exited = false;
      let closed = false;
      let exitCode = -1;
      let drainTimer = null;
      const finish = (code) => {
        if (settled)
          return;
        settled = true;
        if (record.timer)
          clearTimeout(record.timer);
        if (drainTimer)
          clearTimeout(drainTimer);
        record.exitCode = code;
        this.onActivity();
        ringEmit({
          t: "exit",
          exitCode: code,
          durationMs: Date.now() - startedAtMs,
          truncated: { stdout: stdoutTrunc, stderr: stderrTrunc },
          timedOut: record.timedOut,
          cancelled: record.cancelRequested
        });
        this.live.delete(req.execId);
        this.retainRecent(req.execId, record.ring, code);
        resolveDone();
        resolve();
      };
      child.on("error", (err) => {
        if (settled)
          return;
        settled = true;
        if (record.timer)
          clearTimeout(record.timer);
        if (drainTimer)
          clearTimeout(drainTimer);
        ringEmit({
          t: "fail",
          code: "BAD_REQUEST",
          message: `spawn failed: ${err.message}`
        });
        this.live.delete(req.execId);
        this.retainRecent(req.execId, record.ring, null);
        resolveDone();
        resolve();
      });
      child.on("exit", (code, signal) => {
        exitCode = code ?? (signal ? 128 + (SIGNAL_NUMBERS[signal] ?? 15) : -1);
        exited = true;
        if (closed)
          finish(exitCode);
        else
          drainTimer = setTimeout(() => finish(exitCode), EXIT_DRAIN_GRACE_MS);
      });
      child.on("close", () => {
        closed = true;
        if (exited)
          finish(exitCode);
      });
    });
  }
  cancel(execId) {
    const rec = this.live.get(execId);
    if (!rec)
      return false;
    if (rec.timer)
      clearTimeout(rec.timer);
    rec.cancelRequested = true;
    rec.kill("SIGTERM");
    setTimeout(() => rec.kill("SIGKILL"), SIGKILL_GRACE_MS);
    return true;
  }
  status(execId) {
    const rec = this.live.get(execId);
    if (rec)
      return { state: "running", startedAtMs: rec.startedAtMs };
    const retained = this.recent.get(execId);
    if (retained)
      return { state: "exited", exitCode: retained.exitCode };
    return null;
  }
  writeStdin(execId, req) {
    const rec = this.live.get(execId);
    if (!rec)
      return { ok: false, reason: "NOT_FOUND" };
    if (!rec.stdin)
      return { ok: false, reason: "STDIN_CLOSED" };
    if (!isStdinWritable(rec.stdin)) {
      return { ok: false, reason: "STDIN_CLOSED" };
    }
    let buf = null;
    if (req.b64 !== undefined && req.b64 !== "") {
      buf = Buffer.from(req.b64, "base64");
      if (!isSingleNdjsonLine(buf))
        return { ok: false, reason: "BAD_LINE" };
    }
    try {
      if (buf)
        rec.stdin.write(buf);
      if (req.eof) {
        rec.stdin.end();
        rec.stdin = null;
      }
    } catch (err) {
      console.warn("[runnerd] stdin write failed:", err);
      return { ok: false, reason: "WRITE_FAILED" };
    }
    this.onActivity();
    return { ok: true };
  }
}
function isStdinWritable(stdin) {
  return !stdin.writableEnded && !stdin.destroyed && !stdin.errored;
}
function isSingleNdjsonLine(buf) {
  if (buf.byteLength === 0 || buf.byteLength > RUNNERD_STDIN_MAX_BYTES) {
    return false;
  }
  const text = buf.toString("utf8");
  if (!text.endsWith(`
`))
    return false;
  const line = text.slice(0, -1);
  if (line.includes(`
`))
    return false;
  try {
    JSON.parse(line);
  } catch {
    return false;
  }
  return true;
}
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isRunnerdExecEvent(v) {
  if (!isObject(v))
    return false;
  if (v.seq !== undefined && typeof v.seq !== "number")
    return false;
  switch (v.t) {
    case "start":
      return typeof v.execId === "string" && typeof v.startedAtMs === "number";
    case "stdout":
    case "stderr":
      return typeof v.b64 === "string";
    case "exit":
      return typeof v.exitCode === "number" && typeof v.durationMs === "number" && typeof v.timedOut === "boolean" && typeof v.cancelled === "boolean" && isObject(v.truncated);
    case "fail":
      return typeof v.code === "string" && typeof v.message === "string";
    default:
      return false;
  }
}
function emitRingLine(line, emit, sinceSeq = 0) {
  const trimmed = line.trim();
  if (!trimmed)
    return;
  try {
    const parsed = JSON.parse(trimmed);
    if (!isRunnerdExecEvent(parsed)) {
      console.warn("[runnerd] ring line is not a RunnerdExecEvent:", trimmed);
      return;
    }
    if ((parsed.seq ?? 0) <= sinceSeq)
      return;
    emit(parsed);
  } catch (err) {
    console.warn("[runnerd] bad ring line during attach replay:", err);
  }
}
var SIGNAL_NUMBERS = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGKILL: 9,
  SIGTERM: 15
};

// src/file-ops.ts
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
function workspaceRoot() {
  return process.env.TALE_WORKSPACE_ROOT ?? WORKSPACE_ROOT;
}
function resolveUnderWorkspace(rel) {
  const root = workspaceRoot();
  if (rel.includes("\x00"))
    return null;
  const abs = normalize(rel.startsWith("/") ? rel : join(root, rel));
  if (abs !== root && !abs.startsWith(`${root}/`))
    return null;
  return abs;
}
async function realpathUnderRoot(abs) {
  try {
    const real = await realpath(abs);
    const root = await realpath(workspaceRoot());
    return real === root || real.startsWith(`${root}/`) ? real : null;
  } catch {
    return null;
  }
}
var FETCH_MAX_BYTES = 100 * 1024 * 1024;
var INLINE_MAX_BYTES = 1 * 1024 * 1024;
async function stageFiles(items) {
  const staged = [];
  const skipped = [];
  for (const item of items) {
    const abs = resolveUnderWorkspace(item.path);
    if (abs === null) {
      skipped.push({ path: item.path, reason: "unsafe_path" });
      continue;
    }
    try {
      let buf;
      if (item.contentBase64 !== undefined) {
        buf = Buffer.from(item.contentBase64, "base64");
        if (buf.byteLength > INLINE_MAX_BYTES) {
          skipped.push({ path: item.path, reason: "too_large" });
          continue;
        }
      } else if (item.url !== undefined) {
        const res = await fetch(item.url);
        if (!res.ok) {
          skipped.push({ path: item.path, reason: `http_${res.status}` });
          continue;
        }
        const declared = Number(res.headers.get("content-length") ?? "");
        if (Number.isFinite(declared) && declared > FETCH_MAX_BYTES) {
          skipped.push({ path: item.path, reason: "too_large" });
          continue;
        }
        if (res.body === null) {
          skipped.push({ path: item.path, reason: "no_body" });
          continue;
        }
        const reader = res.body.getReader();
        const parts = [];
        let total = 0;
        let overLimit = false;
        for (;; ) {
          const { done, value } = await reader.read();
          if (done)
            break;
          if (value === undefined)
            continue;
          const part = Buffer.from(value);
          total += part.byteLength;
          if (total > FETCH_MAX_BYTES) {
            overLimit = true;
            await reader.cancel();
            break;
          }
          parts.push(part);
        }
        if (overLimit) {
          skipped.push({ path: item.path, reason: "too_large" });
          continue;
        }
        buf = Buffer.concat(parts);
      } else {
        skipped.push({ path: item.path, reason: "no_source" });
        continue;
      }
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, buf);
      staged.push({ path: item.path, bytes: buf.byteLength });
    } catch (err) {
      skipped.push({
        path: item.path,
        reason: err instanceof Error ? err.message : "fetch_failed"
      });
    }
  }
  return { staged, skipped };
}
async function deletePaths(paths) {
  const deleted = [];
  const skipped = [];
  for (const rel of paths) {
    const abs = resolveUnderWorkspace(rel);
    if (abs === null || abs === workspaceRoot()) {
      skipped.push({ path: rel, reason: "unsafe_path" });
      continue;
    }
    try {
      await rm(abs, { recursive: true, force: true });
      deleted.push(rel);
    } catch (err) {
      skipped.push({
        path: rel,
        reason: err instanceof Error ? err.message : "delete_failed"
      });
    }
  }
  return { deleted, skipped };
}
async function listDir(rel) {
  const abs = resolveUnderWorkspace(rel);
  if (abs === null)
    return null;
  if (await realpathUnderRoot(abs) === null)
    return null;
  const out = [];
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      let size = 0;
      let mtimeMs = 0;
      try {
        const st = await stat(join(abs, e.name));
        size = st.size;
        mtimeMs = st.mtimeMs;
      } catch {}
      out.push({
        name: e.name,
        type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
        size,
        mtimeMs
      });
    }
  } catch {
    return null;
  }
  return out;
}
async function readWorkspaceFile(rel, maxBytes) {
  const abs = resolveUnderWorkspace(rel);
  if (abs === null)
    return null;
  if (await realpathUnderRoot(abs) === null)
    return null;
  try {
    const st = await stat(abs);
    if (!st.isFile() || st.size > maxBytes)
      return null;
    return await readFile(abs);
  } catch {
    return null;
  }
}

// src/screencast-tunnel.ts
import { connect } from "node:net";
var VNC_HOST = "127.0.0.1";
var VNC_PORT = 5900;
var VNC_CONTROL_PORT = 5901;
function targetHost() {
  return process.env.TALE_SCREENCAST_TARGET_HOST ?? VNC_HOST;
}
function targetPort(control) {
  const override = Number(process.env.TALE_SCREENCAST_TARGET_PORT ?? "");
  if (override)
    return override;
  return control ? VNC_CONTROL_PORT : VNC_PORT;
}
function wantsControl(req) {
  try {
    const u = new URL(req.url ?? "", "http://runnerd.local");
    return u.searchParams.get("control") === "1";
  } catch {
    return false;
  }
}
var SCREENCAST_TOUCH_INTERVAL_MS = 20000;
var UPGRADE_PROTOCOL = "tale-vnc";
var activeScreencasts = 0;
function getActiveScreencasts() {
  return activeScreencasts;
}
function writeRaw(socket, text) {
  try {
    socket.write(text);
  } catch (err) {
    console.warn("[runnerd] screencast handshake write failed:", err);
  }
}
function handleScreencastUpgrade(req, socket, head, deps) {
  if (!deps.tokenOk(req)) {
    writeRaw(socket, `HTTP/1.1 401 Unauthorized\r
Connection: close\r
\r
`);
    socket.destroy();
    return;
  }
  const control = wantsControl(req);
  const vnc = connect(targetPort(control), targetHost());
  let piping = false;
  let closed = false;
  let touchTimer = null;
  const teardown = () => {
    if (closed)
      return;
    closed = true;
    if (touchTimer !== null) {
      clearInterval(touchTimer);
      touchTimer = null;
    }
    if (piping) {
      activeScreencasts -= 1;
    }
    vnc.destroy();
    socket.destroy();
  };
  vnc.once("connect", () => {
    writeRaw(socket, `HTTP/1.1 101 Switching Protocols\r
Upgrade: ${UPGRADE_PROTOCOL}\r
Connection: Upgrade\r
\r
`);
    if (head.length > 0) {
      vnc.write(head);
    }
    piping = true;
    activeScreencasts += 1;
    deps.touch();
    touchTimer = setInterval(deps.touch, SCREENCAST_TOUCH_INTERVAL_MS);
    touchTimer.unref?.();
    socket.pipe(vnc);
    vnc.pipe(socket);
  });
  vnc.on("error", (err) => {
    if (piping) {
      teardown();
      return;
    }
    console.warn("[runnerd] screencast x11vnc connect failed:", err.message);
    writeRaw(socket, `HTTP/1.1 502 Bad Gateway\r
Connection: close\r
\r
`);
    socket.destroy();
    teardown();
  });
  for (const ev of ["close", "end", "error"]) {
    socket.on(ev, teardown);
    vnc.on(ev, teardown);
  }
}

// src/main.ts
var FILE_READ_MAX_BYTES = 20 * 1024 * 1024;
var BROWSER_VIEW = process.env.TALE_BROWSER_CDP === "1";
var HEALTHZ_PROBE_TIMEOUT_MS = 1500;
var PREFLIGHT_WAIT_MS = 1e4;
var preflightInFlight = null;
async function preflightBrowser() {
  if (preflightInFlight) {
    await preflightInFlight;
    return;
  }
  const run = (async () => {
    try {
      const health = await probeCdp();
      if (health.healthy)
        return;
      console.warn("[runnerd] pre-flight: managed browser CDP unhealthy — recycling before exec");
      const r = await restartBrowser(PREFLIGHT_WAIT_MS);
      if (!r.ready) {
        console.warn("[runnerd] pre-flight: browser still not ready after recycle — proceeding");
      }
    } catch (err) {
      console.warn("[runnerd] pre-flight browser check failed (continuing):", err);
    }
  })();
  preflightInFlight = run;
  try {
    await run;
  } finally {
    preflightInFlight = null;
  }
}
var TOKEN = process.env.TALE_RUNNERD_TOKEN ?? "";
var bootedAtMs = Date.now();
var lastActivityAtMs = bootedAtMs;
var touch = () => {
  lastActivityAtMs = Date.now();
};
var seedEnv;
if (process.env.TALE_SESSION_ENV) {
  try {
    const parsed = JSON.parse(process.env.TALE_SESSION_ENV);
    if (parsed !== null && typeof parsed === "object") {
      const seed = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string")
          seed[k] = v;
      }
      seedEnv = seed;
    }
  } catch (err) {
    console.error("[runnerd] TALE_SESSION_ENV is not valid JSON:", err);
  }
}
var envStore = new EnvStore(seedEnv);
var execManager = new ExecManager(envStore, touch);
function tokenOk(req) {
  if (TOKEN === "")
    return true;
  const got = req.headers[RUNNERD_TOKEN_HEADER];
  const value = Array.isArray(got) ? got[0] ?? "" : got ?? "";
  const a = Buffer.from(value, "utf8");
  const b = Buffer.from(TOKEN, "utf8");
  if (a.length !== b.length)
    return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}
async function readBody(req, maxBytes = 4 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    total += buf.byteLength;
    if (total > maxBytes)
      throw new Error("payload_too_large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function isObject2(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function parseEnvPatch(v) {
  if (!isObject2(v))
    return null;
  let set;
  if (v.set !== undefined) {
    if (!isObject2(v.set))
      return null;
    const out = {};
    for (const [k, val] of Object.entries(v.set)) {
      if (typeof val !== "string")
        return null;
      out[k] = val;
    }
    set = out;
  }
  let unset;
  if (v.unset !== undefined) {
    if (!Array.isArray(v.unset))
      return null;
    const strings = v.unset.filter((e) => typeof e === "string");
    if (strings.length !== v.unset.length)
      return null;
    unset = strings;
  }
  return { set, unset };
}
async function handleExec(req, res) {
  let parsed;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "bad_request" });
    return;
  }
  if (execManager.liveCount() >= RUNNERD_MAX_LIVE_EXECS) {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    const fail = {
      t: "fail",
      code: "EXEC_LIMIT",
      message: `live exec cap ${RUNNERD_MAX_LIVE_EXECS} reached`
    };
    res.end(`${JSON.stringify(fail)}
`);
    return;
  }
  if (BROWSER_VIEW)
    await preflightBrowser();
  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no"
  });
  let primaryClosed = false;
  const emit = (event) => {
    if (primaryClosed)
      return;
    if (res.writableLength > RUNNERD_CONSUMER_BUFFER_MAX_BYTES) {
      primaryClosed = true;
      console.warn(`[runnerd] exec stream consumer backpressured past ${RUNNERD_CONSUMER_BUFFER_MAX_BYTES}B — dropping it (reconnect via /attach)`);
      return;
    }
    try {
      res.write(`${JSON.stringify(event)}
`);
    } catch (err) {
      console.warn("[runnerd] NDJSON write after close:", err);
    }
  };
  req.on("close", () => {
    primaryClosed = true;
  });
  try {
    await execManager.run(parsed, emit);
  } catch (err) {
    emit({
      t: "fail",
      code: "BAD_REQUEST",
      message: err instanceof Error ? err.message : String(err)
    });
  } finally {
    res.end();
  }
}
var EXEC_CANCEL_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/cancel$/;
var EXEC_ATTACH_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/attach$/;
var EXEC_STDIN_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})\/stdin$/;
var EXEC_STATUS_RE = /^\/execs\/([a-zA-Z0-9_-]{1,64})$/;
async function handleAttach(req, res, execId, sinceSeq) {
  if (!execManager.canAttach(execId)) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no"
  });
  let attachClosed = false;
  const emit = (event) => {
    if (attachClosed)
      return;
    if (res.writableLength > RUNNERD_CONSUMER_BUFFER_MAX_BYTES) {
      attachClosed = true;
      console.warn(`[runnerd] attach consumer backpressured past ${RUNNERD_CONSUMER_BUFFER_MAX_BYTES}B — dropping it (reconnect via /attach)`);
      return;
    }
    try {
      res.write(`${JSON.stringify(event)}
`);
    } catch (err) {
      console.warn("[runnerd] attach write after close:", err);
    }
  };
  req.on("close", () => {
    attachClosed = true;
  });
  const stream = execManager.attach(execId, emit, sinceSeq);
  if (stream)
    await stream;
  res.end();
}
async function router(req, res) {
  const url = new URL(req.url ?? "/", "http://runnerd");
  const path = url.pathname;
  if (req.method === "GET" && path === "/readyz") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (!tokenOk(req)) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (req.method === "GET" && path === "/healthz") {
    const body = {
      ok: true,
      bootedAtMs,
      lastActivityAtMs,
      liveExecs: execManager.liveCount(),
      activeScreencasts: getActiveScreencasts()
    };
    if (BROWSER_VIEW) {
      const health = await probeCdp(HEALTHZ_PROBE_TIMEOUT_MS);
      body.browser = { cdpHealthy: health.healthy, tabs: health.tabs };
    }
    sendJson(res, 200, body);
    return;
  }
  if (req.method === "POST" && path.startsWith("/browser/")) {
    if (!BROWSER_VIEW) {
      sendJson(res, 200, {
        signalled: false,
        ready: false,
        tabs: 0,
        closed: 0
      });
      return;
    }
    touch();
    if (path === "/browser/restart") {
      sendJson(res, 200, await restartBrowser());
      return;
    }
    if (path === "/browser/reset") {
      sendJson(res, 200, await resetBrowser());
      return;
    }
    if (path === "/browser/close-pages") {
      sendJson(res, 200, await closePages());
      return;
    }
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  if (req.method === "POST" && path === "/execs") {
    await handleExec(req, res);
    return;
  }
  const cancelMatch = path.match(EXEC_CANCEL_RE);
  if (req.method === "POST" && cancelMatch) {
    touch();
    sendJson(res, 200, { killed: execManager.cancel(cancelMatch[1] ?? "") });
    return;
  }
  const attachMatch = path.match(EXEC_ATTACH_RE);
  if (req.method === "GET" && attachMatch) {
    const sinceSeq = Number(url.searchParams.get("sinceSeq") ?? "0") || 0;
    await handleAttach(req, res, attachMatch[1] ?? "", sinceSeq);
    return;
  }
  const stdinMatch = path.match(EXEC_STDIN_RE);
  if (req.method === "POST" && stdinMatch) {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "bad_request" });
      return;
    }
    sendJson(res, 200, execManager.writeStdin(stdinMatch[1] ?? "", body));
    return;
  }
  const statusMatch = path.match(EXEC_STATUS_RE);
  if (req.method === "GET" && statusMatch) {
    const id = statusMatch[1] ?? "";
    const st = execManager.status(id);
    if (st === null) {
      sendJson(res, 404, { execId: id, state: "gone" });
      return;
    }
    sendJson(res, 200, {
      execId: id,
      state: st.state,
      ...st.state === "running" ? { startedAtMs: st.startedAtMs } : { exitCode: st.exitCode }
    });
    return;
  }
  if (req.method === "POST" && path === "/env") {
    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "bad_request" });
      return;
    }
    const patch = parseEnvPatch(parsed);
    if (patch === null) {
      sendJson(res, 400, { error: "bad_request" });
      return;
    }
    touch();
    const denied = envStore.patch(patch.set, patch.unset);
    sendJson(res, 200, { ok: true, denied });
    return;
  }
  if (req.method === "POST" && path === "/files/stage") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "bad_request" });
      return;
    }
    touch();
    const result = await stageFiles(body.files ?? []);
    sendJson(res, 200, result);
    return;
  }
  if (req.method === "POST" && path === "/files/delete") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: "bad_request" });
      return;
    }
    touch();
    const result = await deletePaths(body.paths ?? []);
    sendJson(res, 200, result);
    return;
  }
  if (req.method === "GET" && path === "/fs/list") {
    const entries = await listDir(url.searchParams.get("path") ?? ".");
    if (entries === null) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    sendJson(res, 200, { entries });
    return;
  }
  if (req.method === "GET" && path === "/fs/read") {
    const bytes = await readWorkspaceFile(url.searchParams.get("path") ?? "", FILE_READ_MAX_BYTES);
    if (bytes === null) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(bytes);
    return;
  }
  sendJson(res, 404, { error: "not_found" });
}
var server = createServer((req, res) => {
  router(req, res).catch((err) => {
    console.error("[runnerd] handler error:", err);
    try {
      sendJson(res, 500, { error: "internal" });
    } catch {}
  });
});
server.on("upgrade", (req, socket, head) => {
  const path = new URL(req.url ?? "/", "http://runnerd").pathname;
  if (path !== "/screencast") {
    socket.destroy();
    return;
  }
  handleScreencastUpgrade(req, socket, head, { tokenOk, touch });
});
server.requestTimeout = 30000;
server.headersTimeout = 1e4;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  });
}
server.listen(RUNNERD_PORT, "0.0.0.0", () => {
  console.log(`[runnerd] listening on :${RUNNERD_PORT}; tokenAuth=${TOKEN === "" ? "OFF (dev)" : "on"}`);
});
