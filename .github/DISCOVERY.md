# Maintain Tale's public discovery surfaces

The repository README, GitHub organization profile, website and documentation describe the same
product: an open-source project workspace for teams and AI agents. Keep claims about runtimes,
credentials, data flows, licensing and professional services aligned with their maintained guides.

## GitHub entry points

- The public organization landing page lives in
  [`tale-project/.github/profile`](https://github.com/tale-project/.github/tree/main/profile),
  with English, German and French versions. Keep it concise and link to the product documentation.
- Keep the repository and organization About text consistent with the README. GitHub's default
  repository search matches names, descriptions and topics; README search uses `in:readme`.
- Topics describe actual capabilities and intended users. Review the existing 20 topics when
  positioning changes; do not add unrelated brands or treat the limit as a quota.
- Pin the main repository on the organization overview. The repository social preview reuses
  `services/web/public/og.png`; upload a replacement in repository Settings when that brand asset changes.
- Use Discussions for the [maintainer welcome](https://github.com/tale-project/tale/discussions/4130),
  [starter evaluation task](https://github.com/tale-project/tale/discussions/4131), real questions and answers.
  Mark answers when they resolve a question. Keep bug reports in Issues and vulnerability reports private.
- Write release outcomes and upgrade implications before publishing; see [Releasing](RELEASING.md).

## Preserve a private traffic baseline

GitHub retains traffic for 14 days. With `gh` authenticated as a repository administrator, run:

```bash
bun tools/cli/scripts/github-traffic-snapshot.ts
```

The script saves a new dated JSON file under `~/.local/share/tale/discovery/`, with owner-only
file permissions. An optional `--output-dir /absolute/private/path` must point outside a Git checkout.
It validates all responses before writing and refuses to overwrite an observation. Collection stops
if Git cannot verify that the destination is outside a checkout. Schedule this
command weekly in the operator's private scheduler; the machine must have Bun, Git and an authenticated
GitHub CLI. Use an absolute script path and a PATH that includes those programs. Do not put snapshots
in this public repository or public Actions artifacts. Check the scheduler's exit status and local logs.

Compare complete UTC days, preserving each snapshot's collection time. Windows overlap: never sum
successive 14-day totals, and never add daily unique counts to claim unique people for a longer period.
Referrer data covers the top ten sources only. Clone and visitor counts can include automation and
are not installation, adoption, customer or ranking metrics.

## Measure useful discovery

Review weekly, keeping observations in a private report:

| Surface | Measure | Interpretation |
| --- | --- | --- |
| GitHub Traffic | Search-referred views, popular pages and changes across comparable windows | A partial discovery signal; no keyword rankings or reliable install count |
| Google Search Console | Indexed canonical pages, search queries, clicks and generative-AI impressions | Use verified properties for `tale.dev` and `docs.tale.dev`; inspect URLs after a release |
| Bing Webmaster Tools | Index coverage and AI Performance citations/grounding queries | Citations describe supported Microsoft/partner surfaces, not every answer engine |
| Existing Umami analytics | Documentation/quickstart pageviews, external entry referrer origins and successful `demo-request-submitted` events | Track aggregate discovery and outcomes separately; respect existing DNT/GPC and privacy controls |
| Fixed evaluation questions | Whether an answer cites Tale and represents its capabilities accurately | Record engine, date, locale and source URLs; repeated samples, not a universal ranking |

Umami is optional. When enabled, the first pageview carries an external referrer's origin if the
browser supplies it; source paths and queries are removed. Later pageviews and successful form
events do not carry that referrer. These aggregates do not establish which referral led to a demo
request or connect a GitHub visitor to a website outcome. An absent referrer is not proof of a direct visit.

Start the evaluation set with real decisions: choosing a workspace for people and AI agents,
self-hosting requirements, supported runtimes/subscriptions, data flows, and reviewing agent outputs.
Use customer questions to refine it. Separate named-product accuracy from unbranded discovery.

## Verify publication before requesting recrawling

Open the deployed HTML, metadata/JSON-LD, localized pages and Markdown/LLM exports after the website
release. Confirm corrected product facts and working canonical links. New guides must be linked,
prerendered and included in the existing sitemap pipeline. Inspect the deployed commit/version;
a merged PR does not prove deployment. Submit the current sitemaps and request indexing of key
changed URLs in the verified search-console accounts. Do not use the Google Indexing API for
ordinary product pages.

Keep search crawler access distinct from model-training choices: OAI-SearchBot supports ChatGPT
search, while GPTBot controls training crawling. A normal HTTP probe or a spoofed user-agent does
not prove access from a crawler's real IP range; use edge logs when diagnosing blocks.

`llms.txt` and Markdown exports are maintained for consumers that use them, not as promised Google
ranking signals. Prefer useful original examples and accurate, sourced explanations over keyword
repetition, synthetic community activity or unverified claims.

Sources: [GitHub repository search](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories),
[GitHub traffic](https://docs.github.com/en/rest/metrics/traffic),
[Google AI search guidance](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide),
[OpenAI crawlers](https://developers.openai.com/api/docs/bots),
[Bing AI Performance](https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/).
