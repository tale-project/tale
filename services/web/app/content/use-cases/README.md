# Use-case content

The use-case hub and five practical work guides use the same marketing reading surface and
publication registry as the comparison pages. Resources navigation and the footer link to the
hub; relevant platform pages and comparisons link to individual guides.

Each EN/DE/FR tree contains a hub (`index.md`) and five distinct use cases. Routes are
`/use-cases`, `/use-cases/<slug>`, and their `/de` and `/fr` equivalents. The comparison hub
and its links follow the same pattern under `/compare`. The content registry validates matching locale identities before registering published URLs.

Frontmatter supplies `title`, `description`, `slug`, `reviewed`, and `draft` (true for new pages). Render the
title as the only H1. Keep the task examples, sample acceptance criteria, and practical next
steps visible; they distinguish these pages from generic AI landing pages. Add relevant links
from product pages and the resource navigation, then validate canonicals, language alternates,
prerendered content, sitemap discovery, and mobile reading before setting `draft: false` in all three locales.

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

For the dev-only draft preview, publication gate, and test commands, follow
[the comparison content contract](../comparisons/README.md#publication-and-preview).
