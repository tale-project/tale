---
title: Agent knowledge
description: The agent's Knowledge tab — one scope deciding which corpus its retrieval may read, and how that differs from tools.
---

Knowledge is what an agent can retrieve and cite at reply time. Without it the agent is generic; with it the agent answers from your organization's material and shows where the answer came from. The agent's **Knowledge** tab holds a single decision: which corpus this agent's retrieval is allowed to read.

That decision is smaller than it used to need to be, because retrieval itself is no longer a mode you configure. An agent searches when it judges that it needs to, and nothing is injected into a reply the agent did not go looking for.

## Pick a scope

Four values, one setting:

- **Documents** — the organization's own uploads, and nothing else.
- **Web** — the pages fetched on the organization's behalf, and nothing else.
- **All** — both corpora, fused into one ranked result. This is what an agent gets when nobody narrows it.
- **None** — the agent is offered no retrieval at all. Reach for it when the agent's job is reasoning or drafting and citations would only be noise.

Every corpus belongs to your organization, so widening the scope never crosses into another tenant's material. It only decides how much of your own the agent is pointed at.

## Narrow it on purpose

Everything in scope competes for relevance on every question, which is why a narrower scope usually answers better than a wider one. An agent pointed at the documents your team actually maintains finds the right passage; the same agent pointed at every crawled page as well has to beat the noise first.

Set **Documents** when the truth lives in files you control and a stale web page would be a liability. Set **Web** when the agent's job is about what is published rather than what is filed. Set **All** when both genuinely matter and you would rather have the recall. The material itself — what is uploaded, what is crawled, and what is indexed — is managed under [Documents](/platform/knowledge/documents) and [Websites](/platform/knowledge/crawling), not here; this tab only points the agent at it.

## How retrieval lands in the reply

When the agent retrieves, citations attach to the sentences they support — hovering shows the source, clicking opens it. A document that has not finished indexing is not retrievable yet, so an agent that seems to be ignoring an obvious source is often waiting on the index rather than misconfigured.

## When to reach for it

Structured records and live systems are tools, not knowledge. The boundaries:

| Use…                                                | When the agent needs…                                  |
| --------------------------------------------------- | ------------------------------------------------------ |
| Knowledge (this tab)                                | To search and cite the organization's material         |
| [Tools](/platform/agents/tools)                     | Contacts, products, vendors, websites, or live systems |
| [Project agents](/platform/projects/project-agents) | Knowledge scoped to one Project                        |

## Where this fits

Agent knowledge answers one question — should this agent read the organization's documents, its crawled web, both, or neither. The wider [Knowledge](/platform/knowledge/overview) section is where those sources live and get indexed; this tab wires one agent into a slice of them. For the end-to-end build — upload, scope, ask, verify the citations — walk [Agent with knowledge](/tutorials/editor/agent-with-knowledge).
