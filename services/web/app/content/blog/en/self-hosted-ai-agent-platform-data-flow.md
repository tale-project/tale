---
title: "Does self-hosting keep your AI data in-house?"
description: "Self-hosting an AI app does not keep every request local. Follow one task through models, tools, storage, and logs to see where its data goes."
slug: self-hosted-ai-agent-platform-data-flow
topicId: T06
reviewed: '2026-10-03'
draft: false
coverAlt: "An open workspace enclosure connects to separate external services."
---

Self-hosting lets you choose where the application runs. Whether its data stays inside your company depends on the services it calls. An agent on your server can still send a confidential document to a hosted model, include its contents in a web search, or write them to an external error log.

The useful question is: **which parts of this task may leave our environment, and through which connections?** You can answer it before buying hardware or choosing a deployment. Follow one representative task from its input to its result, including the services used along the way.

## Follow a document through the task

Imagine your procurement team asks an agent to compare three suppliers against an internal requirements brief. The brief includes a budget and an unannounced launch date. Supplier websites are public; the brief must remain inside the company’s controlled environment.

The agent needs to read both kinds of material, but they do not have to travel together. It could retrieve public product pages using supplier names, then compare them with the brief using an internal model. Sending the combined material to a hosted model would break the example’s rule. So would putting the launch date into a public search query.

Write down what each step actually sends. “Uses our private cloud” does not tell you enough about a model request or a search query.

| Step | What to inspect | What the example permits |
| --- | --- | --- |
| Upload and extract the brief | Original file, extracted text, temporary copies | Keep these inside the controlled environment |
| Make the brief searchable | Text sent to the embedding service | Use an internal service for this text |
| Look up suppliers | Search queries, requested pages, form submissions | Send supplier names and public lookup terms |
| Draft the comparison | The full request sent to the generation model | Keep the mixed internal and public context inside |
| Save the result | Report, conversation history, logs and backups | Apply the same rule to copies containing internal details |

This also reveals a common gap: hosting the text-generation model yourself leaves the embedding service unresolved. An embedding service turns text into vectors for search; if it runs externally, the text reaches that service before anyone asks a question.

![The application and workspace sit inside the chosen infrastructure. Connections to models, tools and operating services each need a separate data-flow check.](/blog/diagrams/en/T06-diagram.svg)

## Check the connections that the hosting label leaves out

Ask whoever operates the system to identify the actual destination for each row. For a model call, record the endpoint, the provider behind it and whether there is a fallback. For a tool, inspect the query or submitted fields. For storage, include extracted text and backups as well as uploaded files.

In Tale, application records, searchable knowledge and original files have separate storage settings. Moving one store does not move the others or their existing contents. The [data-store guide](https://docs.tale.dev/self-hosted/configuration/data-residency) explains those boundaries.

Network restrictions also have a scope. Tale’s sandbox egress controls and its model-gateway route are separate; narrowing the sites an agent can browse does not choose where model processing happens. Use the [hardening guide](https://docs.tale.dev/self-hosted/operate/security/hardening) to identify which path a restriction covers. Check direct provider connections in the [runtime guide](https://docs.tale.dev/platform/agents/harnesses) as well.

Include error reporting in this review. A successful run might never exercise it, yet a failed request can produce a message containing task data. Tale’s optional monitoring destinations depend on configuration; header masking alone does not remove sensitive text from every error. See [observability configuration](https://docs.tale.dev/self-hosted/configuration/observability-config).

## Verify with harmless data

A configuration file tells you what should happen. A controlled run helps you check what does happen. Use a made-up brief with a distinctive, harmless phrase, then ask the operator to inspect the corresponding model requests, tool calls and reporting events. Keep the phrase out of public search requests unless that is explicitly the path you intend to test.

Check a normal run and a controlled failure. If your setup has an external fallback, exercise that path separately. Test a refused destination too: an internal-only task should stop when its permitted model is unavailable, rather than silently use an external model.

Observing one run does not prove that no other path exists. Combine what you saw with the configured destination list and enforced network rules. Mark paths you could not inspect as unresolved. That gives the person approving the deployment a concrete decision instead of a reassuring label.

## Choose a deployment you can describe precisely

For the supplier task, a useful conclusion might read:

> The brief, extracted text, model requests and report stay in our controlled environment. Public supplier names go to the web-search service. External error reporting is disabled. Backups remain in our approved storage.

That is an example of a decision to verify, not a description of every self-hosted deployment. Your answer may legitimately allow a named external model provider. The important distinction is that the exception is visible and approved before confidential work starts.

Use the [data-flow worksheet](/blog/worksheets/en/T06-data-flow-inventory.md) to record destinations and unresolved connections with your operator. Once you can explain where a real task sends its data, you can compare hosting options against the requirement that brought you to self-hosting in the first place.
