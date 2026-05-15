---
title: Build an integration
description: Author a Tale connector — config.json, connector.ts, sandbox APIs, and packaging.
---

A connector is a `config.json` plus a `connector.ts` (or `.js`) plus an icon. The manifest declares the integration's identity, authentication, allowed hosts, and the named operations it exposes; the connector code runs each operation inside a sandbox. SQL integrations are a special case — they don't ship code, only parameterised queries in the manifest.

This page is the authoring reference. It assumes you've already read [Integrations overview](/platform/integrations/overview) for the user-facing concepts. For the editor-side workflow with AI assistants, see [AI-assisted development](/develop/ai-assisted-development).

## File layout

A connector lives in a single directory. The directory name is the **slug** — the stable identifier used by the platform; it is not a field inside `config.json`.

```text
integrations/<slug>/
├── config.json     ← manifest (required)
├── connector.ts    ← sandboxed code (REST connectors only)
└── icon.svg        ← shown in the Add integration list
```

There are two ways to ship this directory: drop it into the `integrations/` folder of a project scaffolded by `tale init`, or zip the files and upload them via **Settings > Integrations > Add integration** (max 1 MB). Both paths produce the same server-side state.

## `config.json` schema

The manifest is validated server-side against a Zod schema in [services/platform/lib/shared/schemas/integrations.ts](https://github.com/tale-project/tale/blob/main/services/platform/lib/shared/schemas/integrations.ts). The fields below are the canonical surface; consult the source if anything looks out of date.

| Field                  | Required            | Type                                                                | What it does                                                                                                                     |
| ---------------------- | ------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `title`                | yes                 | string (1-200)                                                      | Human-readable name shown in the integrations list.                                                                              |
| `description`          | no                  | string (≤2000)                                                      | One-sentence summary shown next to the title.                                                                                    |
| `version`              | no                  | integer                                                             | Bump when operations or parameter shapes change so consumers can detect drift.                                                   |
| `type`                 | no                  | `'rest_api'` \| `'sql'`                                             | Defaults to `rest_api`. Set `sql` for database connectors.                                                                       |
| `authMethod`           | yes                 | `'api_key'` \| `'bearer_token'` \| `'basic_auth'` \| `'oauth2'`     | The authentication method this connector requires.                                                                               |
| `supportedAuthMethods` | no                  | array of the same enum                                              | Use when a connector accepts more than one auth method; the user picks at install time.                                          |
| `secretBindings`       | no                  | array of strings                                                    | Names of credential keys the connector reads at runtime via `secrets.get('<key>')`. The UI prompts for exactly these.            |
| `allowedHosts`         | no                  | array of strings                                                    | Network allow-list. The connector cannot reach hosts not listed here.                                                            |
| `operations`           | rest_api connectors | array of `Operation`                                                | The named REST operations the connector exposes. See [Operation shape](#operation-shape).                                        |
| `oauth2Config`         | oauth2 connectors   | `{ authorizationUrl, tokenUrl, scopes? }`                           | Endpoints for the authorization-code flow.                                                                                       |
| `sqlConnectionConfig`  | sql connectors      | `{ engine, readOnly?, options?, security? }`                        | `engine` is `'mssql'`, `'postgres'`, or `'mysql'`. `readOnly` is a hint to the UI; the database account itself is the real gate. |
| `sqlOperations`        | sql connectors      | array of `SqlOperation`                                             | Named queries with parameter placeholders. See [SQL connectors](#sql-connectors).                                                |
| `connectionConfig`     | no                  | `{ domain?, apiVersion?, apiEndpoint?, timeout?, rateLimit?, ... }` | Optional connection hints; extra keys are accepted.                                                                              |
| `capabilities`         | no                  | `{ canSync?, canPush?, canWebhook?, syncFrequency? }`               | Declares optional capabilities the platform can schedule against (e.g. periodic sync).                                           |
| `exposeAsCapability`   | no                  | `{ label, icon?, tooltip?, order? }`                                | Surface this integration as a named capability in the UI.                                                                        |
| `setupGuide`           | no                  | string (≤5000)                                                      | Markdown rendered under **Configuration guide** in the manage dialog. Tell users where to generate keys, which scopes, etc.      |
| `metadata`             | no                  | object                                                              | Free-form metadata for tooling; not interpreted by the platform.                                                                 |

## Operation shape

A REST operation describes one callable action. The agent picks an operation by `name` and supplies validated parameters; your `connector.ts` dispatches on `ctx.operation` and uses `ctx.params`.

| Field              | Required | Type                  | What it does                                                                                            |
| ------------------ | -------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `name`             | yes      | string                | Stable identifier the agent uses. Snake_case by convention.                                             |
| `title`            | no       | string                | Human-readable label in the UI's operation list.                                                        |
| `description`      | no       | string                | What the operation does and when to use it. The agent reads this — write it for the LLM, not the human. |
| `operationType`    | no       | `'read'` \| `'write'` | Drives the approval gate. Defaults to read-style behaviour when omitted.                                |
| `requiresApproval` | no       | boolean               | Force the approval card even on a read, or skip it on a write that is genuinely safe.                   |
| `requiredScopes`   | no       | array of strings      | OAuth scopes this operation needs; surfaced to the user during connect.                                 |
| `parametersSchema` | no       | JSON Schema (object)  | Standard JSON Schema. Only `type: 'object'` with `properties` and `required` is exercised today.        |

A compact REST example, lifted from [examples/integrations/tavily/config.json](https://github.com/tale-project/tale/blob/main/examples/integrations/tavily/config.json):

```json
{
  "name": "search",
  "title": "Search the web",
  "description": "Search the open web via Tavily. Use 'basic' depth for quick facts, 'advanced' for deeper research.",
  "operationType": "read",
  "parametersSchema": {
    "type": "object",
    "required": ["query"],
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural-language search query. Be specific."
      },
      "max_results": {
        "type": "number",
        "description": "Max results to return (1-10)."
      }
    }
  }
}
```

## The connector sandbox

Connector code does not run as ordinary Node. It is transpiled and executed inside an isolated context with a small, controlled API surface. Plan accordingly: there is no `fs`, no `child_process`, no arbitrary `import`, no `process.env`, no ambient `fetch`. The only side-effects available are HTTP through `ctx.http` and credential reads through `ctx.secrets`.

### `ConnectorContext`

Every operation receives a context object. The shape is:

```typescript
interface ConnectorContext {
  operation: string; // the operation name being invoked
  params: Record<string, unknown>; // validated against parametersSchema
  http: HttpApi;
  secrets: SecretsApi;
  base64Encode(input: string): string;
  base64Decode(input: string): string;
  files?: FilesApi; // injected only when the runtime supplies a storage provider
}

interface HttpApi {
  get(url: string, options?: HttpMethodOptions): HttpResponse;
  post(url: string, options?: BodyMethodOptions): HttpResponse;
  put(url: string, options?: BodyMethodOptions): HttpResponse;
  patch(url: string, options?: BodyMethodOptions): HttpResponse;
  delete(url: string, options?: BodyMethodOptions): HttpResponse;
}

interface HttpMethodOptions {
  headers?: Record<string, string>;
  responseType?: 'base64'; // request a base64-encoded body for binary downloads
}

interface BodyMethodOptions extends HttpMethodOptions {
  body?: string; // already-serialised payload (e.g. JSON.stringify(...))
  binaryBody?: string; // base64-encoded request body
}

interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  text(): string;
  json(): unknown;
}

interface SecretsApi {
  get(key: string): string | undefined;
}

interface FilesApi {
  download(
    url: string,
    options: { headers?: Record<string, string>; fileName: string },
  ): FileReference;
  store(
    data: string,
    options: {
      encoding: 'base64' | 'utf-8';
      contentType: string;
      fileName: string;
    },
  ): FileReference;
}

interface FileReference {
  fileId: string;
  url: string;
  fileName: string;
  contentType: string;
  size: number;
}
```

`ctx.files` is only present when the host runtime injects a storage provider (the platform does this for connector executions tied to an organization). Treat it as optional in your connector code; check for `ctx.files` before using it if your operation can run in contexts that don't supply one.

The `http` client only reaches hosts listed in `allowedHosts`. A request to anything else fails before the network call.

### What the sandbox does not provide

- **No Node built-ins** — no `fs`, `child_process`, `crypto`, `path`, `os`, `net`. Use `base64Encode`/`base64Decode` for binary work; for hashing or signing, do it server-side or pre-compute.
- **No top-level `import` or `require`** — write self-contained code. TypeScript type declarations at the top of the file are stripped during transpile and are only there for editor support.
- **No environment variables** — read every credential through `ctx.secrets.get(...)`.
- **No background work** — `setTimeout`, `setInterval`, and unawaited promises are not part of the contract. An operation runs to completion synchronously (the sandbox treats your function as synchronous) and returns a value.

## The two functions a connector exports

A connector defines two functions: one to validate a connection during install, one to run operations.

| Function              | When it runs                                                   | What it should do                                                                                                   |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `testConnection(ctx)` | When the user clicks **Test connection** in the manage dialog. | Make the cheapest authenticated request the API supports. Throw a clear `Error` with a remediation hint on failure. |
| `execute(ctx)`        | Every time an operation is invoked.                            | Dispatch on `ctx.operation`, validate inputs, call the API, shape the response. Throw `Error` for any failure.      |

Both can be exported either as a single `connector` object literal (Tavily, Discord) or as top-level functions; both shapes are accepted. The `connector` object form is recommended because it keeps the two entry points close to a list of operations and makes the dispatch table obvious.

By convention, successful `execute` returns an object of the shape `{ success: true, operation, data, count?, cost?: { cents }, timestamp }`. The platform does not enforce this shape, but agents and execution logs render it cleanly.

## Worked example — Tavily

Here is the smallest end-to-end picture, drawn from [examples/integrations/tavily/](https://github.com/tale-project/tale/tree/main/examples/integrations/tavily).

The manifest declares the auth method, allow-listed host, secret binding, and two operations:

```json
{
  "title": "Tavily",
  "type": "rest_api",
  "authMethod": "api_key",
  "secretBindings": ["apiKey"],
  "allowedHosts": ["api.tavily.com"],
  "operations": [
    {
      "name": "search",
      "operationType": "read",
      "parametersSchema": {
        /* ... */
      }
    },
    {
      "name": "extract",
      "operationType": "read",
      "parametersSchema": {
        /* ... */
      }
    }
  ],
  "setupGuide": "1. Sign up at https://tavily.com\n2. Create an API key\n3. Paste it below and Test connection."
}
```

The connector exports `testConnection` (a cheap authenticated probe) and `execute` (dispatch to per-operation helpers):

```typescript
const API_BASE = 'https://api.tavily.com';

const connector = {
  testConnection(ctx: TestConnectionContext) {
    const apiKey = ctx.secrets.get('apiKey');
    if (!apiKey) throw new Error('Tavily API key is required.');

    const response = ctx.http.post(API_BASE + '/search', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query: 'ping', max_results: 1 }),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('Tavily authentication failed. Verify the API key.');
    }
    if (response.status !== 200) {
      throw new Error(
        'Tavily connection failed (' +
          response.status +
          '): ' +
          response.text(),
      );
    }
    return { status: 'ok' };
  },

  execute(ctx: ConnectorContext) {
    const apiKey = ctx.secrets.get('apiKey');
    if (!apiKey) throw new Error('Tavily API key is required.');
    if (ctx.operation === 'search') return search(ctx.http, apiKey, ctx.params);
    if (ctx.operation === 'extract')
      return extractUrls(ctx.http, apiKey, ctx.params);
    throw new Error('Unknown operation: ' + ctx.operation);
  },
};
```

Notice the shape of the error messages — they tell the user what to do (`Verify the API key`), not just that something failed. Errors from `testConnection` surface inline in the manage dialog; errors from `execute` surface in the agent's response and execution log. Make them actionable.

The full file at [tavily/connector.ts](https://github.com/tale-project/tale/blob/main/examples/integrations/tavily/connector.ts) shows the per-operation helpers, an `handleHttpError` utility that maps statuses to user-readable messages, and result truncation to keep token usage predictable. Reuse those patterns.

## SQL connectors

SQL integrations skip `connector.ts` entirely. The platform runs the queries you declare in the manifest against the configured database; you only write the SQL and the parameter schema.

```json
{
  "name": "list_reservations",
  "title": "List Reservations",
  "description": "Fetch reservations with optional status and date filters.",
  "operationType": "read",
  "query": "SELECT id, guest_id, check_in FROM reservations WHERE (@status IS NULL OR status = @status) AND check_in >= @fromDate ORDER BY check_in DESC",
  "parametersSchema": {
    "type": "object",
    "properties": {
      "status": { "type": "string", "description": "Optional status filter." },
      "fromDate": {
        "type": "string",
        "format": "date",
        "description": "ISO date."
      }
    }
  }
}
```

Placeholders use `@paramName`, matched to keys in `parametersSchema.properties`. Mark queries that mutate data with `operationType: 'write'` and (usually) `requiresApproval: true`; the platform will gate them through the approval flow. See [examples/integrations/protel/config.json](https://github.com/tale-project/tale/blob/main/examples/integrations/protel/config.json) for a full hotel-PMS connector with twenty-plus read operations and a handful of approval-gated writes.

`sqlConnectionConfig.engine` accepts `'mssql'`, `'postgres'`, or `'mysql'`. The optional `security.maxResultRows` and `security.queryTimeoutMs` are caps the platform enforces on top of whatever the database itself permits.

## Packaging and shipping

- **Project flow.** Drop `integrations/<slug>/{config.json, connector.ts, icon.svg}` into a `tale init` project. The platform live-reloads; saving a file applies the change.
- **UI upload.** Zip the same files (or upload them individually) via **Settings > Integrations > Add integration**. The total package is capped at 1 MB.
- **Versioning.** Bump `version` in `config.json` whenever you change the operation set or any parameter shape, so consumers can notice the drift.
- **Icons.** SVG, PNG, JPG, or WebP, under 256 KB. SVG renders cleanest in dark and light themes.
- **Slugs.** The directory name is the slug. Keep it stable across versions; renaming is a breaking change.

## Common mistakes to avoid

- **Long-running loops or unbounded result sets.** Operations should return quickly with paginated or truncated data. The Tavily connector caps results at 5 and truncates each page to 2 000 characters — use it as a reference.
- **Secrets in code.** Never embed API keys or tokens in `connector.ts`. Always read them through `ctx.secrets.get('<binding>')` and declare the binding in `secretBindings`.
- **Hosts not in `allowedHosts`.** A request to an unlisted host fails. Add every base URL the connector touches, including any redirect target you depend on.
- **Vague error messages.** `Failed` is not actionable. Tell the user which credential is wrong, which scope is missing, or which quota was exceeded.
- **Missing `operationType: 'write'` on mutating calls.** Without it, the approval gate doesn't engage and a write may run unattended.

## Where this fits

Building an integration is the connector-author flow. From here, the manifest gets installed on Tale instances; once installed, the connector's operations show up as tools in [Create an agent](/platform/agents/create) and as steps in automation [Workflows](/platform/automations/workflows). For the operator-side consumption surface, [Integrations overview](/platform/integrations/overview) is the canonical reference; for AI-assisted authoring of the manifest itself, [AI-assisted development](/develop/ai-assisted-development) is the workflow. The [API reference](/develop/api-reference) covers the Tale API itself — distinct from connectors.
