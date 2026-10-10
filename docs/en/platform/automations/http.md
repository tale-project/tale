---
title: Call an API from an automation
description: Read from or send to any HTTPS API with the http.get and http.send steps, with a stored credential or without one, and know what Tale refuses.
---

Use an HTTP step when an automation needs an outside API that has no connector of its own. `http.get` reads, and `http.send` writes with POST, PUT, PATCH or DELETE. A send changes data outside Tale, so a live run asks for an [approval](/platform/approvals/concepts) first, as every write does. A test run never sends: it answers with a mock.

## Read from an API

```yaml
nodes:
  - id: orders
    type: http.get
    credential: Shop API
    input:
      url: /orders
      query: { status: open }
```

| Input          | What it holds                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `url`          | A full `https://` address, or with a credential a path under its base URL, such as `/orders`.                  |
| `query`        | Query parameters added to the address.                                                                         |
| `headers`      | Request headers. `Authorization`, `Cookie` and the API key header come from the credential, never from here.   |
| `timeoutMs`    | How long to wait for the whole answer: 1,000 to 30,000 milliseconds, 15,000 by default.                        |
| `responseType` | `json` or `text`. Without it, the answer is read as JSON when its content type is JSON, and as text otherwise. |
| `okStatuses`   | Statuses outside 200–299 that do not fail the step, such as `[404]`.                                           |

The step returns `{ status, ok, headers, body }`. `body` holds the parsed JSON or the text, and `null` for an empty answer. `headers` keeps `content-type`, `etag`, `last-modified`, `location`, `link`, `retry-after` and the `x-ratelimit-` headers, and drops the others. A status outside 200–299 fails the step unless `okStatuses` lists it; then `ok` is `false`, and a later step decides what to do with the answer.

## Send to an API

`http.send` takes the same inputs and three more: `method` (POST, PUT, PATCH or DELETE, required), `body` and `contentType`. A JSON value in `body` is sent as JSON. A string is sent as it is, with `contentType`, or `text/plain` without one.

```yaml
nodes:
  - id: create_order
    type: http.send
    credential: Shop API
    input:
      url: /orders
      method: POST
      body:
        item: '{{ input.item }}'
        quantity: 2
```

## Sign in with a credential

In **Settings › Connectors**, add a credential to **HTTP**. Choose how it signs in: a bearer token, an API key sent in a header, or a user name and password. Enter its **Base URL**, such as `https://api.example.com/v2`; for an API key, **API key header** names the header, `X-Api-Key` by default. Give the credential a name, and name it in the step's `credential` field.

A credentialed step stays under the base URL. A path is placed under it, a full address must start with it, and a redirect may not leave it. Only the credential signs the request. Wherever an answer would hand back one of the credential's values, Tale replaces it with `[redacted]`, so it never reaches a run's record.

A step without a credential carries none, never the organization's default one, and calls public `https://` addresses only.

## What Tale refuses

- A private network address or a cloud metadata address, with or without a credential.
- A plain `http://` address. The editor warns about one before you save.
- A user name or a password written into the address, or a credential in a query parameter of it: the editor refuses the save. Store the credential in **Settings › Connectors** instead.
- An `Authorization` or `Cookie` header set by the step. The editor refuses this too.
- An answer larger than 1 MB.

An organization's HTTP steps make at most 120 calls a minute across the deployment, and 10 at once on one server. A call over the minute's budget fails; one over the number at once waits for a free slot as long as its `timeoutMs` allows.

## When a step fails

The run page says why an HTTP step failed and how to fix it. The [execution logs](/platform/automations/execution-logs#failures) explain how to read the failure.

| Failure                                     | What happened                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **The API answered with an error**          | The status was outside 200–299, and `okStatuses` doesn't list it.                                              |
| **The API took too long**                   | No whole answer arrived within `timeoutMs`.                                                                    |
| **The API couldn't be reached**             | The name didn't resolve, or the connection or its TLS failed.                                                  |
| **The address isn't allowed**               | The address is private, a cloud metadata address, or plain `http://`.                                          |
| **The address is outside the credential's** | A credentialed call, or one of its redirects, left the base URL.                                               |
| **The address can't be called**             | The URL isn't an address, isn't `https`, is a path without a credential, or carries a user name or a password. |
| **A header belongs to the credential**      | The step set `Authorization`, `Cookie` or the API key header.                                                  |
| **The answer is too large**                 | The answer was larger than 1 MB.                                                                               |
| **The answer isn't JSON**                   | `responseType` is `json`, and the answer was something else.                                                   |
| **Too many API calls at once**              | The organization's steps spent their budget of calls.                                                          |
