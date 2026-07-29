# Loanword buckets

Three buckets cover every English noun that appears in a non-English Tale string. The bucket decides
whether the noun translates, stays English, or matches the shipped UI verbatim. The assignment lives on
each term's `category` field in
[`packages/ui/src/i18n/tests/glossary/glossary.yml`](../../../packages/ui/src/i18n/tests/glossary/glossary.yml);
the tests enforce the rules.

## Bucket 1 — Always English

Brands, acronyms, and code identifiers — international tokens that lose meaning when translated.

| Category         | Examples                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `brand`          | `Tale`, `Convex`, `OpenRouter`, `Claude`, `GitHub`, `Slack`, `Gmail`, `Outlook`, `Shopify`, `Docker`, `Kubernetes`                       |
| `acronym`        | `AI`, `LLM`, `API`, `MCP`, `RAG`, `OIDC`, `SSO`, `SAML`, `SOC 2`, `ISO 27001`                                                            |
| `codeIdentifier` | Env vars (`TALE_CONFIG_DIR`), CLI flags (`--detach`), file paths (`docker-compose.yml`), JSON keys, API paths (`POST /api/v1/documents`) |

## Bucket 2 — Established loanwords

English in industry usage, and natural read as English in German/French. Stay English in DE/FR;
hyphenate when forming a German compound (`Webhook-Adresse`, `Workflow-Schritt`).

| Category    | Examples                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loanword`  | `Workflow`, `Dashboard`, `Cloud`, `Webhook`, `Prompt`, `Token`, `Server`, `Canvas`, `Composer`, `Status`, `Connector`, `Tool`, `Pipeline`, `Branding`, `Open Source`, `Team` |
| `gitDomain` | `Pull Request`, `Code Review`, `Merge`, `Rebase`, `Branch`, `Commit`, `Push`, `Pull`, `Fork`, `Diff`, `Issue`, `Repository`, `Tag`, `Release`                                |

The Git-domain split is a sharper sub-bucket: a German developer reading `Pull Request` recognises the
workflow instantly; `Ziehanforderung` introduces friction no native developer asks for.

## Bucket 3 — Translate-bucket

English words with a perfectly natural target-language form that must translate. Caught by
`terminology-loanword`.

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

When a term belongs here but the shipped UI still renders it English, the UI wins: add a glossary entry
with `_lintExclude: { <locale>: true }` and a `_note` explaining the deferral; plan the UI fix as a
separate PR (see [GLOSSARY_GUIDE.md](GLOSSARY_GUIDE.md)).

## Bucket assignment workflow

1. **Default to translation.** If a target-language reader expects the word in their language
   (spreadsheet headers, error names, navigation paths, role names), translate.
2. **Loanword exceptions are explicit.** A word stays English only when the target-language developer
   uses the English form in conversation without thinking — i.e. it sits in bucket 2.
3. **No half compounds.** A compound translates whole or stays whole: `Knowledge Base` →
   `Wissensdatenbank` (DE) or `Base de connaissances` (FR); never `Knowledge-Datenbank`,
   `Base de Knowledge`.
4. **The UI is authoritative.** If the bucket says "translate" but the UI ships English, the entry gets
   a `_lintExclude` for that locale plus a `_note`.

## Half-compound denylists

Known half-translation patterns the tests reject. Add new ones to the per-locale terminology file:
[`packages/ui/src/i18n/tests/locales/<locale>/terminology.ts`](../../../packages/ui/src/i18n/tests/locales/).

**DE — Git domain (keep English):**

| Wrong               | Right        | Why                                |
| ------------------- | ------------ | ---------------------------------- |
| Pull Anfrage        | Pull Request | Git vocabulary stays English       |
| Merge Anfrage       | Pull Request | "Merge-Anfrage" is not a real term |
| Code Review-Prozess | Code Review  | Drop the German suffix             |
| Branch Zweig        | Branch       | Git vocabulary stays English       |
| Commit Übergabe     | Commit       | Git vocabulary stays English       |

**DE — product domain (translate whole):**

| Wrong               | Right                     |
| ------------------- | ------------------------- |
| Knowledge Datenbank | Wissensdatenbank          |
| Knowledge Basis     | Wissensdatenbank          |
| Help Zentrum        | Hilfe-Center (matches UI) |
| Email Anbieter      | E-Mail-Anbieter           |

**FR — Git domain (keep English):**

| Wrong                 | Right        |
| --------------------- | ------------ |
| Pull Demande          | Pull Request |
| Merge Fusion          | Merge        |
| Code Review-Processus | Code Review  |
| Branch Branche        | Branch       |

**FR — product domain (translate whole):**

| Wrong          | Right                 |
| -------------- | --------------------- |
| Knowledge Base | Base de connaissances |
| Help Centre    | Centre d'aide         |
