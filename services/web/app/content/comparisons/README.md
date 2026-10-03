# Competitor comparison content

Content handoff for **Marketing UI Redesign**. These are page drafts, not registered routes.
The design agent owns page composition, routing, navigation, and publication. Reuse the existing
marketing components, metadata adapter, and SEO compiler when integrating them.

## Product message

Tale is a collaborative project workspace for teams and AI agents. People organize tasks,
delegate work to agents, steer progress, and review results together. Software delivery,
marketing campaigns, research, document work, and operations are examples; Tale is not limited
to software engineering. Coordination, delegation, persistent sandbox workspaces, and configured
parallel execution are core. Supported agent subscriptions and API credentials reduce adoption
friction. Private AI and self-hosting are additional benefits.

Do not promise arbitrary agent compatibility, unlimited concurrency, automatic cross-agent
memory, universal human approval, automatic deployment, or complete gateway metering of vendor
subscription calls. Supported subscriptions use compatible harnesses and bypass Tale gateway
spending caps. Scope ISO 27001 to Ruler GmbH's Tale Enterprise and professional services. Tale
and Ruler GmbH make no SOC 2 claim.

## Content contract

One file per product in `en/`, `de/`, and `fr/`, with matching filenames and frontmatter:

```yaml
title: Tale vs Example — compare team workflows
description: A specific search description explaining the comparison and the decision it helps a team make, without claiming a universal winner.
competitor: Example
slug: tale-vs-example
relationship: direct
reviewed: '2026-10-03'
draft: true
```

Proposed routes are `/compare/<slug>`, `/de/compare/<slug>`, and `/fr/compare/<slug>`.
The renderer should use the frontmatter title as its sole H1; body headings begin at H2.
Titles target 30–60 characters and descriptions 110–160, matching the existing marketing tests.
Relationship is `direct`, `adjacent`, `framework`, or `runtime`; explain the distinction in the
page instead of pretending a framework or compatible runtime is the same kind of product.

Each draft provides a distinct buyer question, accurate product emphasis, a balanced comparison,
when each choice fits, a concrete evaluation task, and linked primary sources. No competitor
was installed or benchmarked for this research. Claims describe documented scope; a missing
mention is not evidence of a missing feature. Avoid performance, pricing, security, superiority,
or universal compatibility claims without equivalent evidence. Dates identify the review, not
an assurance that the competitor will remain unchanged.

Read each language naturally using Tale's `you` / `du` / `tu` voice. Preserve factual scope,
source links, and equivalent outcomes. Bodies use ordinary Markdown so the design agent can
compose prose, comparison tables, and calls to action with the existing primitives.

## Integration handoff

- Lead each page with the real decision, then give Tale's relevant project-work example.
- Link the comparison index from an appropriate existing resource surface; avoid crowding the
  primary product navigation with dozens of brands.
- Register only integrated pages in route discovery, prerendering, sitemaps, and `llms.txt`.
  Apply canonical URLs, EN/DE/FR alternates, localized metadata, and the existing logo OG card.
- Use factual WebPage/Breadcrumb structured data. Do not add ratings or mark a comparison as
  an independently tested review. FAQ schema, if used, must match visible questions and answers.
- Use the existing demo and self-host CTAs. Preserve a helpful link to the alternative's own
  official product information; these pages are buying guides, not universal-win scorecards.
- Check live competitor sources again before publication, especially licensing, maintenance
  status, and subscription support. Retired Relay.app is excluded from the 49-product
  set; Vibe Kanban's maintenance transition is explained in its own draft. Flowise's official end-of-life notice is treated as a dated migration comparison, not an active-product recommendation.
- Remove `draft: true` only when the design agent has integrated and verified the page.
- Run locale/content/link checks, the marketing production build, prerender SEO checks, and
  real-browser desktop/mobile checks before publishing. No draft URL is advertised as live.

Existing homepage copy and task-board/demo corrections from the positioning work are also
available in this branch. Treat those components as handoff material for the redesign; this
content task adds no comparison layout or second design system.
