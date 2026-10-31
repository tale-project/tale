# Search

> **Prefix** `SEARCH-` · **Reset** none · **Cost** 15 boxes

Exercise the docs search — the rail trigger and the **Cmd/Ctrl+K** shortcut,
the shared `@tale/ui` `SearchCommand` dialog over a prebuilt MiniSearch index
(one per locale, `scripts/build-search-index.ts`), result navigation,
empty/short/no-result states, and the recent-searches store.

## Scope & routes

| Surface       | Where                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------- |
| Trigger       | **Search documentation** (`docs.searchPlaceholder`) — the rail's field from `md` up and the drawer's field below; the phone bar's icon **Open search** (`docs.openSearch`) |
| Shortcut      | **Cmd/Ctrl+K** anywhere (the shared `DocsLayout`)                                            |
| Dialog        | `@tale/ui/docs/docs-search-dialog` → `@tale/ui` `SearchCommand`                              |
| Index         | `{base}/search-index-{locale}.json` (static, built per locale)                               |
| Recents store | `localStorage['tale.docs.recentSearches.v1.{locale}']`, one store per language                                                |

## Preconditions

Bring the site up per [SETUP.md](../setup.md) — either mode (mode B builds the
index in its `dev` script). Clear the recents keys for a clean SEARCH-F5 and SEARCH-F9 run.

> **Agent note**: the dialog is lazy-loaded — the first open may take a beat.
> Strings resolve from `packages/ui/src/i18n/messages/{locale}.yml`: the
> documentation copy (title, placeholder, empty state and its hints) from
> `docs.search.*`, everything else from the palette's `search.*`. Assert
> navigation by URL commit, not by result-row styling.

## Functional tests

- [ ] `SEARCH-F1` · **Open + close** — Click the rail's **Search
  documentation** (`docs.searchPlaceholder`); then press **Esc**; then press **Cmd/Ctrl+K** → The
  dialog opens with the **Search documentation…** input (`docs.search.placeholder`)
  focused; Esc closes it; the shortcut opens it from any page and closes it
  again when pressed while open.
- [ ] `SEARCH-F2` · **Empty state** — Open the dialog, type nothing → Shows
  **Start typing to search the docs.** (`docs.search.empty`) + hint
  (`docs.search.emptyHint`) — or **Recent searches** once SEARCH-F5 has history.
- [ ] `SEARCH-F3` · **Results + select** — Type `quickstart` → Result rows
  from the index appear (match highlighting); a result count matching
  `search.results` is announced; **Enter** (or click) on the top hit commits
  its page URL and closes the dialog.
- [ ] `SEARCH-F4` · **Keyboard nav** — With results open, press
  **ArrowDown/ArrowUp**, then **Enter** → Selection moves row to row (footer
  shows the tips `search.tipNavigate` / `search.tipSelect` /
  `search.tipClose`); Enter opens the selected page.
- [ ] `SEARCH-F5` · **Recents** — Search + open a result; reopen the dialog
  empty → **Recent searches** (`search.recent`) lists the query; the row's
  **Remove from recent** control (`search.removeRecent`) deletes one;
  **Clear** (`search.clearRecent`) empties the list; the English store,
  the localStorage entry tale.docs.recentSearches.v1.en, reflects each step
  and survives a reload.
- [ ] `SEARCH-F6` · **Locale index** — On `{base}/de`, open search and type a
  German term from a translated page (e.g. `Schnellstart`) → Hits come from
  the **German** index (`search-index-de.json`) and link into `/de/…` pages;
  the dialog strings render German (`@tale/ui` `de.yml` `docs.search.*` / `search.*`)
- [ ] `SEARCH-F7` · **Index freshness** — Search `workforce` (a term only on
  pages removed in the content revamp — their old slugs live in
  `docs/redirects.json`); then search `episode` → No hit lands on a dead page
  — nothing links to `{base}/platform/projects/workforce-metrics` or any other
  redirected old slug; `episode` returns hits from the **new** tutorials video
  pages (e.g. **Episode 1 — Welcome to Tale**) that open `/tutorials/videos/…`
  correctly — the index is rebuilt with the corpus (`build-search-index.ts`
  runs on `dev`/`build`), never stale.
- [ ] `SEARCH-F8` · **Deep-page terms** — Search `ORG_SLUG_REQUIRED`, then
  `WEBDAV_MAX_PUT_BYTES`, then `Idempotency-Key` → Each returns hits and the
  **API reference** (the develop → API reference page) or the **environment
  reference** (the self-hosted → configuration → environment reference page)
  is among the first three rows — the whole page body is indexed, not only its intro,
  and inline-code words survive; a hit whose term sits past the stored
  snippet still opens the page (the row shows the page's opening text).
- [ ] `SEARCH-F9` · **Recents per language** — With English recents from
  SEARCH-F5, open search empty on `{base}/de`; search and open a German page,
  then go back to `{base}/` and open search empty → German lists no English
  recent and English no German one; each lists its own queries and page
  titles, in its own store (tale.docs.recentSearches.v1.de beside ….v1.en).

## Boundary & error tests

- [ ] `SEARCH-B1` · **Short query** — A single character → **Keep typing to
  search…** (`search.keepTyping`) — no result list, no error.
- [ ] `SEARCH-B2` · **No results** — `xyzzyplugh` → **No results found**
  (`search.noResultsTitle`) + **Try different keywords or browse the
  navigation.** (`search.noResultsHint`)
- [ ] `SEARCH-B3` · **Hostile query** — `"><script>alert(1)</script>` and a
  500-char string → Treated as plain text — no markup injection in the result
  panel, no console error, the dialog stays responsive.

## Accessibility (WCAG 2.1 AA)

- [ ] `SEARCH-A1` · **Dialog** → The search is a labelled dialog (**Search
  documentation**, `search.title`); focus lands in the input on open; **Esc**
  closes and focus returns to the page.
- [ ] `SEARCH-A2` · **Trigger** → Every entry point is a labelled control
  reachable by Tab: the rail field at desktop, the bar icon and the drawer
  field on a phone. Each field is named by the text it shows (**Search
  documentation**, **Dokumentation durchsuchen**, **Rechercher dans la
  documentation**), so a voice-control user can say what they see (WCAG
  2.5.3); the bar icon is **Open search**. The shortcut hint is a `<kbd>` inside
  the field, announced as its shortcut (`aria-keyshortcuts`), not read into the
  control's name.
- [ ] `SEARCH-A3` · **Announcements** → The result count (`search.results`) is
  exposed to AT; selected rows are conveyed programmatically, not colour-only.

## Performance

- [ ] `SEARCH-P1` · **First results** → Results render **< 500 ms** after
  typing on a warm session (client-side index)
