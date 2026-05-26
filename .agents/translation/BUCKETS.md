# Loanword buckets

Three buckets cover every English noun that appears in a non-English Tale string. The bucket determines whether the noun translates, stays English, or matches the shipped UI string verbatim. The bucket assignment lives on each term entry in [`packages/ui/src/i18n/tests/glossary/glossary.json`](../../packages/ui/src/i18n/tests/glossary/glossary.json) as the `category` field; the tests enforce the bucket rules automatically.

## Bucket 1 — Always English

Brands, acronyms, and code identifiers. Never translate in any language. These are international tokens; translating them obscures meaning.

| Category         | Examples                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `brand`          | `Tale`, `Convex`, `OpenRouter`, `Claude`, `GitHub`, `Slack`, `Gmail`, `Outlook`, `Shopify`, `Docker`, `Kubernetes`                       |
| `acronym`        | `AI`, `LLM`, `API`, `MCP`, `RAG`, `OIDC`, `SSO`, `SAML`, `SOC 2`, `ISO 27001`                                                            |
| `codeIdentifier` | Env vars (`TALE_CONFIG_DIR`), CLI flags (`--detach`), file paths (`docker-compose.yml`), JSON keys, API paths (`POST /api/v1/documents`) |

## Bucket 2 — Established loanwords

Words that are English in industry usage and read natural in German/French as English. Stay English in DE and FR; hyphenate when forming compounds in German (`Webhook-Adresse`, `Workflow-Schritt`).

| Category    | Examples                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loanword`  | `Workflow`, `Dashboard`, `Cloud`, `Webhook`, `Prompt`, `Token`, `Server`, `Canvas`, `Composer`, `Status`, `Integration`, `Tool`, `Pipeline`, `Branding`, `Open Source`, `Team` |
| `gitDomain` | `Pull Request`, `Code Review`, `Merge`, `Rebase`, `Branch`, `Commit`, `Push`, `Pull`, `Fork`, `Diff`, `Issue`, `Repository`, `Tag`, `Release`                                  |

The Git-domain split exists because Git vocabulary is a sharper sub-bucket: a German developer who reads `Pull Request` recognises the workflow immediately; rendering it `Ziehanforderung` introduces friction that no native developer asks for.

## Bucket 3 — Translate-bucket

English words that have a perfectly natural target-language form and must translate. Caught by the `terminology-loanword` check.

| EN             | DE                  | FR                    | de-CH (override) |
| -------------- | ------------------- | --------------------- | ---------------- |
| Header         | Kopfzeile           | En-tête               | (same as DE)     |
| Request        | Anfrage             | Requête               | (same as DE)     |
| Provider       | Anbieter            | Fournisseur           | (same as DE)     |
| Email          | E-Mail              | Courriel              | (same as DE)     |
| Help Center    | Hilfe-Center        | Centre d'aide         | (same as DE)     |
| Billing        | Abrechnung          | Facturation           | (same as DE)     |
| Sales Research | Vertriebs-Recherche | Recherche commerciale | (same as DE)     |
| Draft          | Entwurf             | Brouillon             | (same as DE)     |
| Attachment     | Anhang              | Pièce jointe          | (same as DE)     |
| Self-hosted    | selbst gehostet     | auto-hébergé          | (same as DE)     |

When a term clearly belongs in this bucket but is currently rendered English in the shipped UI, the UI wins — add a glossary entry with `_lintExclude: { <locale>: true }` and a note explaining the deferral. Plan the UI fix as a separate PR.

## Bucket assignment workflow

1. **Default to translation.** If a target-language reader would expect to see the word in their language (Spreadsheet headers, error names, navigation paths, role names), translate.
2. **Loanword exceptions are explicit.** A word stays English only when the target-language developer uses the English form in conversation without thinking. The check rejects mid-prose `Pull Request` for DE only if the term is in the translate-bucket; bucket-2 keeps it.
3. **No half compounds.** A compound translates whole or stays whole. `Knowledge Base` → `Wissensdatenbank` (DE) or `Base de connaissances` (FR); never `Knowledge-Datenbank` or `Base de Knowledge`.
4. **The UI is authoritative.** If the bucket says "translate" but the UI ships English, the bucket entry gets a `_lintExclude` for that locale and a `_note` describing the deferral.

## Half-compound denylists

Known half-translation patterns the tests reject. Add to the per-locale terminology file when you find new ones: [`packages/ui/src/i18n/tests/locales/<locale>/terminology.ts`](../../packages/ui/src/i18n/tests/locales/).

**DE half-compounds (Git domain — keep English):**

| Wrong               | Right        | Why                                |
| ------------------- | ------------ | ---------------------------------- |
| Pull Anfrage        | Pull Request | Git vocabulary stays English       |
| Merge Anfrage       | Pull Request | "Merge-Anfrage" is not a real term |
| Code Review-Prozess | Code Review  | Drop the German suffix             |
| Branch Zweig        | Branch       | Git vocabulary stays English       |
| Commit Übergabe     | Commit       | Git vocabulary stays English       |

**DE half-compounds (product domain — translate whole):**

| Wrong               | Right                     |
| ------------------- | ------------------------- |
| Knowledge Datenbank | Wissensdatenbank          |
| Knowledge Basis     | Wissensdatenbank          |
| Help Zentrum        | Hilfe-Center (matches UI) |
| Email Anbieter      | E-Mail-Anbieter           |

**FR half-compounds (Git domain — keep English):**

| Wrong                 | Right        |
| --------------------- | ------------ |
| Pull Demande          | Pull Request |
| Merge Fusion          | Merge        |
| Code Review-Processus | Code Review  |
| Branch Branche        | Branch       |

**FR half-compounds (product domain — translate whole):**

| Wrong          | Right                 |
| -------------- | --------------------- |
| Knowledge Base | Base de connaissances |
| Help Centre    | Centre d'aide         |
