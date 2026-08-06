# Search — Manual Test Plan

> **Purpose**: Exercise the docs search — the header trigger and the
> **Cmd/Ctrl+K** shortcut, the shared `@tale/ui` `SearchCommand` dialog over a
> prebuilt MiniSearch index (one per locale,
> `scripts/build-search-index.ts`), result navigation, empty/short/no-result
> states, and the recent-searches store.

## Scope & routes

| Surface       | Where                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------- |
| Trigger       | header button **Open search** (`nav.openSearch`) — icon at mobile, labelled field at desktop |
| Shortcut      | **Cmd/Ctrl+K** anywhere (`app/routes/__root.tsx`)                                            |
| Dialog        | `app/features/search/dialog.tsx` → `@tale/ui` `SearchCommand`                                |
| Index         | `{base}/search-index-{locale}.json` (static, built per locale)                               |
| Recents store | `localStorage['tale.docs.recentSearches.v1']`                                                |

## Prerequisites

Bring the site up per [SETUP.md](SETUP.md) — either mode (mode B builds the
index in its `dev` script). Clear the recents key for a clean F5 run.

> **Agent note**: the dialog is lazy-loaded — the first open may take a beat.
> Strings resolve from the `search.*` namespace in
> `services/docs/messages/{locale}.yml` (the docs keys override the `@tale/ui`
> defaults). Assert navigation by URL commit, not by result-row styling.

## Automated coverage

| Case(s)          | Status         | Where                                                                                    |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------- |
| F1               | ✅ automated   | `smoke.spec.ts` (open via header button → placeholder input visible)                     |
| F2–F6            | 🔶 partial     | component `app/features/search/dialog.test.tsx` (wiring); real index + navigation manual |
| F7               | 🔶 partial     | vitest `redirects.test.ts` (no redirect source is still a page) — index content manual   |
| B1–B3, A1–A3, P1 | ⛔ manual-only | —                                                                                        |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test             | Steps (route + control)                                                                                                                        | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Open + close     | Click **Open search** (`nav.openSearch`); then press **Esc**; then press **Cmd/Ctrl+K**                                                        | The dialog opens with the **Search documentation…** input (`search.placeholder`) focused; Esc closes it; the shortcut opens it from any page and closes it again when pressed while open                                                                                                                                                                                         |
| F2  | Empty state      | Open the dialog, type nothing                                                                                                                  | Shows **Start typing to search the docs.** (`search.empty`) + hint (`search.emptyHint`) — or **Recent searches** once F5 has history                                                                                                                                                                                                                                             |
| F3  | Results + select | Type `quickstart`                                                                                                                              | Result rows from the index appear (match highlighting); a result count matching `search.results` is announced; **Enter** (or click) on the top hit commits its page URL and closes the dialog                                                                                                                                                                                    |
| F4  | Keyboard nav     | With results open, press **ArrowDown/ArrowUp**, then **Enter**                                                                                 | Selection moves row to row (footer shows the tips `search.tipNavigate` / `search.tipSelect` / `search.tipClose`); Enter opens the selected page                                                                                                                                                                                                                                  |
| F5  | Recents          | Search + open a result; reopen the dialog empty                                                                                                | **Recent searches** (`search.recent`) lists the query; the row's **Remove from recent** control (`search.removeRecent`) deletes one; **Clear** (`search.clearRecent`) empties the list; the store `tale.docs.recentSearches.v1` reflects each step and survives a reload                                                                                                         |
| F6  | Locale index     | On `{base}/de`, open search and type a German term from a translated page (e.g. `Schnellstart`)                                                | Hits come from the **German** index (`search-index-de.json`) and link into `/de/…` pages; the dialog strings render German (`messages/de.yml` `search.*`)                                                                                                                                                                                                                        |
| F7  | Index freshness  | Search `workforce` (a term only on pages removed in the content revamp — their old slugs live in `docs/redirects.json`); then search `episode` | No hit lands on a dead page — nothing links to `{base}/platform/projects/workforce-metrics` or any other redirected old slug; `episode` returns hits from the **new** tutorials video pages (e.g. **Episode 1 — Welcome to Tale**) that open `/tutorials/videos/…` correctly — the index is rebuilt with the corpus (`build-search-index.ts` runs on `dev`/`build`), never stale |

## Boundary & error tests

| ID  | Test          | Input                                               | Expected                                                                                                                       |
| --- | ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Short query   | A single character                                  | **Keep typing to search…** (`search.keepTyping`) — no result list, no error                                                    |
| B2  | No results    | `xyzzyplugh`                                        | **No results found** (`search.noResultsTitle`) + **Try different keywords or browse the navigation.** (`search.noResultsHint`) |
| B3  | Hostile query | `"><script>alert(1)</script>` and a 500-char string | Treated as plain text — no markup injection in the result panel, no console error, the dialog stays responsive                 |

## Accessibility (WCAG 2.1 AA)

| ID  | Check         | Expected                                                                                                                                                   |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Dialog        | The search is a labelled dialog (**Search documentation**, `search.title`); focus lands in the input on open; **Esc** closes and focus returns to the page |
| A2  | Trigger       | The header trigger is a labelled control (**Open search**) reachable by Tab at both mobile and desktop widths                                              |
| A3  | Announcements | The result count (`search.results`) is exposed to AT; selected rows are conveyed programmatically, not colour-only                                         |

## Performance

| ID  | Metric        | Target                                                                         |
| --- | ------------- | ------------------------------------------------------------------------------ |
| P1  | First results | Results render **< 500 ms** after typing on a warm session (client-side index) |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Search (docs)
Functional: ___/7   Boundary: ___/3   A11y: ___/3   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
