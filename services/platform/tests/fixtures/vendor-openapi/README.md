# Vendor OpenAPI documents

The OpenAPI documents that vendors publish for the services Tale's connectors call, pinned as their
vendors published them so the catalog test holds the connector scenarios' answers against them
offline (`CONN-R34`). Each document sits in a directory named for its vendor, beside the license it
was published under when the document does not carry it.

| Vendor | Connectors | Document | Source | License |
| --- | --- | --- | --- | --- |
| `slack` | `slack` | [`slack_web_openapi_v2_without_examples.json`](slack/slack_web_openapi_v2_without_examples.json) | [slackapi/slack-api-specs](https://github.com/slackapi/slack-api-specs/blob/bc08db49625630e3585bf2f1322128ea04f2a7f3/web-api/slack_web_openapi_v2_without_examples.json) at `bc08db4`: OpenAPI 2.0, version 1.7.0, last changed on 2020-10-06; the repository is archived | [MIT](slack/LICENSE) |
| `openrouter` | `jev` | [`openapi.json`](openrouter/openapi.json) | <https://openrouter.ai/openapi.json>, as fetched on 2026-11-02: OpenAPI 3.1.0, version 1.0.0; the URL serves only the latest document, so the fetch date names the pin; each example string shaped like an OpenRouter API key (`sk-or-v1-` and 64 hex digits) is replaced by `sk-or-v1-REDACTED` | [MIT](https://opensource.org/licenses/MIT), as the document's `info.license` declares |

These are the vendors' files, not fixtures to edit: the formatter skips this directory, and the test
fails when a file's SHA-256 is not the one its pin names. The one change a pin makes is to an
example string shaped like a credential: GitHub refuses a push that carries one, so the pin names
the pattern and its placeholder, the test fails while a string the pattern matches is left, and the
pin keeps the SHA-256 of the file as fetched beside the one of the file as pinned. The mock
gateway's documents in [`lib/mocks/specs`](../../../lib/mocks/specs) are another thing: fixtures
written for it to answer with.

## Move a pin

1. Replace the file with the vendor's new one, and its license if that changed too. Change nothing
   in it but what its pin redacts; for OpenRouter's, fetch the document to a scratch file and pin it
   with:

   ```bash
   sed -E 's/sk-or-v1-[0-9a-f]{64}/sk-or-v1-REDACTED/g' <fetched> > openrouter/openapi.json
   ```

2. Update the pin in [`shipped-connectors.test.ts`](../../../lib/shared/schemas/shipped-connectors.test.ts):
   the source at the new commit or fetch date, the file's SHA-256, and for a redacted file the
   SHA-256 of the file as fetched.
3. Run the catalog test. It names each scenario whose answer no longer fits the document, and each
   listed departure that no longer occurs.
4. In the same change, fix each scenario that no longer fits and its proof, or list the departure
   with the reason and the page of the vendor's reference that confirms it.
