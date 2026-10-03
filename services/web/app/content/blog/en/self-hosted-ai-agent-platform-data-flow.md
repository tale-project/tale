---
title: "Self-hosted AI agents: map every data flow"
description: "Map models, storage, tools, telemetry, and backups before choosing a self-hosted AI agent platform. Compare local, hybrid, and managed responsibilities."
slug: self-hosted-ai-agent-platform-data-flow
topicId: T06
reviewed: 2026-10-03
draft: false
coverAlt: "An open workspace enclosure connects to separate external services."
---

Choose a self-hosted AI agent platform when the control you gain is worth the operating responsibility you accept. That decision needs three kinds of evidence: where the task's data travels, what an acceptable result costs at the expected load, and whether the team can recover the service and its work.

Application hosting alone settles none of those questions. You can run the workspace yourself while using hosted models, operate local generation with external embeddings, or keep both local while a tool sends project content elsewhere. Name the proposed configuration precisely before comparing it with a managed alternative.

## Start with a task and a data rule

Consider a synthetic supplier-comparison project. A worker reads an internal requirements brief, searches public supplier pages, and produces a report for a teammate to review. The team's illustrative rule is: the internal brief and extracted passages must stay inside its controlled environment; public supplier material may be retrieved from the web.

This rule makes a hybrid design possible, but it does not authorize sending the whole report context to a hosted model. The internal and public material become mixed when the worker compares them. Classify the assembled request, not merely the source of each original file.

The rule is an example for reasoning, not legal advice or a reported Tale deployment. Substitute your organization's actual requirements and permitted exceptions.

![A chosen infrastructure boundary contains workspace storage and agent execution. Configured connections may lead to model services, connected tools, and operational systems. Every connection needs a data-flow inventory.](/blog/diagrams/en/T06-diagram.svg)

A useful inventory records the process, destination, payload, and purpose of each flow. A vendor name is too coarse: a model endpoint, analytics endpoint, and backup location are different destinations even if one company operates them.

| Flow in the synthetic task | Why the boundary matters | Decision under the example rule |
| --- | --- | --- |
| Brief → storage and text extraction | Original and extracted copies contain internal requirements | Keep both inside the controlled environment |
| Extracted passages → embedding service | Processing can disclose text before generation begins | Use an approved internal endpoint |
| Mixed context → generation model | Public facts do not make the internal passages public | Keep this request internal |
| Worker → public supplier website | Queries and form fields may contain internal details | Use only the public lookup information needed |
| Error report → monitoring service | A failure message can contain task content | Inspect actual fields or disable the external path |
| Stores and keys → backup system | Recovery copies preserve the same sensitive material | Apply the intended access and location rules to copies |

This filled example eliminates some architectures before price enters the discussion. If the requirement later permits a named hosted processor, generation becomes a cost, quality, and reliability choice again. Document that change; do not bury it in a configuration toggle.

## Verify destinations and access separately

A local address does not prove local inference. Ollama documents both local and cloud-hosted models, and its local API requires no authentication by default. A local API can relay a cloud-model request. Inspect model selection and endpoint behavior as well as the URL. These are Ollama-specific examples, not claims about Tale's inference implementation. [Ollama FAQ](https://docs.ollama.com/faq) and [authentication documentation](https://docs.ollama.com/api/authentication).

Likewise, a private application address says little about a database or model port accidentally published elsewhere. Test reachability from outside the intended network. Docker documents that published-container traffic can bypass ufw's usual chains, so host firewall configuration alone is insufficient evidence of container exposure. [Docker firewall guidance](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

For outbound paths, identify the process making the call. A sandbox restriction cannot establish what a separate backend connector or model gateway can reach. Observe a successful task and a controlled failure: optional error reporting may remain invisible during the successful path. Record unobserved paths as unverified, not as nonexistent.

## Compare the cost of accepted work

Local inference can replace a variable provider bill with fixed capacity and operating work. Whether that helps depends on volume, model suitability, concurrency, and the share of outputs the team can use.

Here is an entirely hypothetical calculation, in US dollars. These are invented planning inputs, not provider prices, hardware recommendations, Tale costs, or measured acceptance rates. Both options serve the same supplier-report workload and acceptance rules. For this cost comparison, assume the organization has approved a particular hosted processor for the internal payload, making both options eligible. If the earlier internal-only rule remains, the hosted option is excluded regardless of price.

| Monthly assumption | Self-operated inference | Hosted inference |
| --- | ---: | ---: |
| Fixed incremental cost, F | $2,600 | $200 |
| Modeled processing and retries per initiated job | $0.10 | $0.80 |
| Modeled review/correction per initiated job | $2.00 | $2.00 |
| Total variable cost per initiated job, v | $2.10 | $2.80 |
| Initiated jobs, N | 5,000 | 5,000 |
| Fraction accepted after allowed retries, a | 90% | 90% |
| Estimated covered cost, F + v × N | $13,100 | $14,200 |
| Accepted deliverables, a × N | 4,500 | 4,500 |
| Estimated covered cost per accepted deliverable | $2.91 | $3.16 |

The fixed inputs represent the incremental capacity, operational labor, and recovery provision assigned to each option. The $2 review/correction allowance assumes two minutes per initiated job at $60 per hour, including the average effort on unsuccessful jobs. It is a planning assumption to replace with observation. Variable processing includes allowed retries; fixed operational labor and variable review labor are separate. Common application costs are excluded from this illustration; real budgets must add any differing licenses, storage, networking, support, and staff costs. Count each distinct accepted deliverable once.

With equal acceptance, the monthly cost crossover is `(2600 − 200) / (2.80 − 2.10)`, about 3,429 jobs. Below that volume, the hosted option is cheaper under these assumptions. At 1,000 jobs, the covered totals are $4,700 and $3,000.

Now challenge the attractive local result. If its acceptance fraction is 65% while all other assumptions stay fixed, it yields 3,250 accepted deliverables. Its cost becomes about $4.03 each, above the hosted option's $3.16. Extra correction work would widen that difference. The change does not prove hosted models are better; it shows why equal quality is an assumption to test rather than a saving to claim.

The calculation also assumes the local capacity can process that workload on time. If reaching 5,000 jobs requires another server, the fixed cost changes and the crossover must be recalculated. An estimated saving beyond a machine's usable capacity is not a purchase justification.

## Test the peak that can invalidate the average

Five thousand jobs spread through a month differ from hundreds arriving before a deadline. Use representative input lengths, output lengths, tools, and simultaneous jobs. Record queue time, completion time, failed/timed-out jobs, and accepted results. Tokens per second alone cannot tell a project owner when the report will be ready.

vLLM offers a concrete capacity tradeoff: when its attention cache lacks space, it can preempt and later recompute requests, increasing end-to-end latency. Its tuning guidance also describes tradeoffs among batching, latency, and parallelism overhead. These are reasons to test a chosen serving setup under load, not evidence that Tale uses vLLM or has a particular throughput. [vLLM optimization and tuning, version 0.21.0](https://docs.vllm.ai/en/v0.21.0/configuration/optimization/).

Managed capacity has tradeoffs too. Hugging Face documents that scaling an endpoint to zero saves idle resources but introduces a cold start; requests can receive a 503 while a replica initializes. For an intermittent overnight report, waiting may be acceptable. For an interactive reviewer, maintaining warm capacity may be worth the cost. [Hugging Face autoscaling](https://huggingface.co/docs/inference-endpoints/guides/autoscaling).

If a peak misses the deadline, decide which constraint can move: concurrency, model/context size, capacity, or delivery time. Recheck quality after reducing context or changing the model. Do not silently route internal material to an external fallback that violates the data rule.

## Design recovery around dependencies

Consider another synthetic failure. A database is recoverable to 10:05, but the available file backup is from 10:00. A report uploaded at 10:03 appears in the restored task record while its file bytes are missing. The application can start and still fail the user's recovery test.

Keep traffic and scheduled actions stopped in the isolated recovery environment. Preserve the damaged state and identify the matching file version or a complete coordinated recovery set. If the last usable set is 10:00, choosing it means explicitly accepting the later work's loss or reconstructing that work through a documented process. Starting newer application code or re-indexing cannot manufacture missing source bytes.

Database recovery has its own prerequisites. PostgreSQL's point-in-time recovery needs a base backup and a continuous required WAL archive; it does not restore manually edited configuration files through WAL. This is database recovery guidance, not a claim that every application's stores are covered by it. [PostgreSQL 18: continuous archiving](https://www.postgresql.org/docs/18/continuous-archiving.html).

Define recovery success as usable work: sign in, open an old project, download a known file, retrieve a known source, and access the required credentials without sending production notifications. Measure the lost-data interval and time to usable service. A database health check alone answers a smaller question.

## Apply these decisions to Tale's actual boundaries

Tale's [self-hosted architecture](https://docs.tale.dev/self-hosted/overview) separates persistent stores, execution, egress, and model gateway responsibilities. Its [data-store guide](https://docs.tale.dev/self-hosted/configuration/data-residency) distinguishes application records, knowledge, and original files. Repointing a connection does not migrate history; include existing data in the transition plan.

The sandbox egress proxy permits public HTTPS destinations by default, with private-address and metadata-address restrictions; an operator can narrow hostnames. Model calls routed through Tale’s gateway use a path separate from sandbox egress. Supported direct subscription runtimes can instead call their provider outside gateway metering and controls; inventory those destinations too. [Runtime credential paths](https://docs.tale.dev/platform/agents/harnesses). Check the configured routes using [Hardening](https://docs.tale.dev/self-hosted/operate/security/hardening) and [Providers](https://docs.tale.dev/self-hosted/configuration/providers). Optional error reporting and analytics need their own review: masking selected headers does not make every error message content-free. See [Observability](https://docs.tale.dev/self-hosted/configuration/observability-config).

Tale's CLI snapshots are volume-level crash-consistent archives, not an atomic snapshot of every store. External databases and buckets need coordinated backups; sandbox workspaces fall outside that snapshot inventory. Preserve the matching version, deployment configuration, and decryption keys, and copy completed backups off the host. These details materially change the recovery plan. [Tale backups and restore](https://docs.tale.dev/self-hosted/operate/backups-and-restore).

## Choose the responsibility you can sustain

A self-hosted pilot proves that a configuration can run a task. It does not prove affordable capacity or recoverability. The n8n AI starter kit makes a similar distinction by describing itself as a proof-of-concept starting point rather than a fully production-optimized deployment. [n8n starter kit](https://github.com/n8n-io/self-hosted-ai-starter-kit).

Self-operated inference becomes attractive when a tested model meets the work's quality bar, utilization supports the economics, and the team can operate the required boundary. Hosted or managed components become stronger candidates when variable demand, model quality, or limited operating capacity outweigh that control—provided their data handling is acceptable. If neither meets the requirement, reduce the workload or defer that use case.

Use the [data-flow and deployment decision worksheet](/blog/worksheets/en/T06-data-flow-inventory.md) to record the boundary, reproduce the cost sensitivity, and plan the mismatched-store recovery drill. Bring the completed decision record to a [Tale demo](/request-demo) so the discussion starts with your team's work and operating constraints.
