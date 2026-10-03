# Use-case content

Content handoff for **Marketing UI Redesign**. These Markdown drafts are not registered routes.
Use the existing marketing components and SEO compiler when integrating them; do not publish
the files as a separate site or add draft URLs to the sitemap.

Each EN/DE/FR tree contains a hub (`index.md`) and five distinct use cases. Proposed routes are
`/use-cases`, `/use-cases/<slug>`, and their `/de` and `/fr` equivalents. The comparison hub
and its links follow the same pattern under `/compare`. Internal links to those routes are
intended for the integrated bundle, not evidence that those URLs already exist.

Frontmatter supplies `title`, `description`, `slug`, `reviewed`, and `draft: true`. Render the
title as the only H1. Keep the task examples, sample acceptance criteria, and practical next
steps visible; they distinguish these pages from generic AI landing pages. Add relevant links
from product pages and the resource navigation, then validate canonicals, language alternates,
prerendered content, sitemap discovery, and mobile reading before removing the draft flag.

These are product landing pages, not customer case studies. Examples describe work a team can
set up; they do not claim measured results, customer endorsements, or autonomous publishing.
Projects coordinate people and agents; configured tools, credentials, review, and sandbox
capacity determine what a run can do. Keep API keys and supported subscription access as an
adoption benefit, with details linked to the runtime documentation. Existing subscription
credentials are not general chat credentials, and direct provider calls bypass Tale's gateway
metering and spending caps.

The existing `/platform/projects` page owns the general project-management search intent.
These pages answer specific work questions without creating a duplicate product overview.
The comparison content contract in `../comparisons/README.md` covers competitive claims.
