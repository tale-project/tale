---
name: search-codebase
description: "Use this skill whenever you need to know where something lives in a codebase or what else a change touches — before any code change, when you're new to a repo, when a request names one screen and parallel ones may exist, or when a visible label or error must be traced to code. It owns three jobs: ORIENT (build the mental map from the repo layout and its enforced tooling — the configs are the conventions), FIND (trace a concept from user-visible vocabulary to i18n keys to symbol names to usages — what a thing is called and what it calls), and SWEEP (after changing one site, enumerate every other occurrence of the concept and change or rule out each — the request names one site; the task is the concept). Load it at Gate A of implement-feature, make-improvement, fix-bug, or implement-ui. Never change one copy of a duplicated concept without sweeping the rest. For facts outside the repo use deep-research."
---

# search-codebase

The request names one site; the task is the **concept**. This skill is how you stop being a visitor
in a codebase: orient once, find by concept, and sweep every occurrence — so a change lands
everywhere it belongs, not just where it was reported. For facts outside the repo (docs,
dependencies, the web) use `deep-research`.

## When this applies

At Gate A of any work skill (`implement-feature`, `make-improvement`, `fix-bug`, `implement-ui`);
in a repo you don't know yet; whenever a request is shaped like "change X on this page" and
parallel pages may exist; whenever a visible label, error, or feature name must be traced to the
code that owns it. No separate note: your outputs — the concept's name and home, the sweep list —
are the **Reuse** and **Blast radius** answers in the active skill's note.

## Orient — build the mental map

Do this once per repo, fast, before trusting any instinct about "where things go":

- **Read the root layout and the workspace manifest** — the parts of the system and their kinds
  (apps, services, packages, tools).
- **Read the contributor and agent docs as pointers, not gospel** — they tell you where to look;
  the code tells you what's true.
- **Read the enforced tooling — the configs are the conventions.** The linter, formatter, and type
  configs, the commit rules, the CI pipeline, and the test setup are the house style that cannot
  drift. Discover conventions there and in neighbouring code, never from memory: the guards are
  the spec.
- **Sample two or three files of the kind you're about to write** and mirror their structure,
  naming, and error handling.
- **Locate one known example of each kind you'll touch** — a route, a schema, a shared component,
  a test. Its home is where yours belongs.

## Find — trace the concept, both directions

Work the ladder in order; each rung narrows the next:

1. **Search the request's own vocabulary** — the words on the screen or in the report: the button
   label, the heading, the error text.
2. **Localized UI? Find the i18n key.** The visible string lives in a message catalog; grep the
   string to get its key, then grep the key — the key's call sites are the real code.
3. **Search symbol space** — the component, function, route, and file names the vocabulary
   suggests.
4. **From a hit, walk both directions.** What it imports tells you whether the behaviour lives
   upstream in something shared; who imports it tells you every usage.
5. **Search structural siblings** — the same directory pattern, parallel routes, parallel schemas,
   parallel exports. Duplicated concepts hide as similarly shaped files, not shared symbols.
6. **Search what a thing is called and what it calls.** Definition-side names and behaviour-side
   calls — one of the two survives any rename.

Use every tool you have: grep/ripgrep, the harness's search tools, "find references" where a
language server exists, and `git log -S` when history explains a survivor.

## Sweep — apply the change everywhere the concept occurs

The **blast radius** of a change is every other place the same concept occurs:

- **importers and callers** of what you changed,
- **duplicated copies** of the concept on parallel surfaces,
- **cross-cutting artifacts** a change of this shape drags along — tests, docs, locales, fixtures,
  exports, migrations.

Enumerate the sweep set **in the note before editing**; after the change, tick each entry as
changed or explicitly ruled out with a reason. A sweep ends when the enumeration is exhausted —
not when you're tired. And first, decide which case you're in — that decision is the whole game:

**Fix the source once (shared component).** "The delete-confirmation dialog doesn't trap focus on
the Invoices page." Grep the dialog's title → an i18n key → rendered by the one `ConfirmDialog` in
the shared UI package, imported by forty screens. Fix focus in `ConfirmDialog`, not on Invoices;
the sweep is verifying a sample of the other surfaces still behaves. _Tell: the concept lives in
one file everything imports._

**Sweep every copy (duplicated concept).** "Move the New Product button above the table." The
Products page hand-rolls its own header row — and so do Customers and Orders: three copies of the
same list-page shape, no shared import. The concept is "list page with a create action": enumerate
every page built on the pattern (grep the table component's importers, walk the sibling route
dirs) and apply the same move to each — or extract the header into one shared component
(`make-improvement`) and fix the source once. Rule out pages where the placement is intentionally
different, in the note. _Tell: the same markup shape recurs across sibling files with no shared
import._

**A data shape ripples (parallel artifacts).** "Split `name` into first and last name on the
registration form." The changed thing is a _field_, not a form — sweep everywhere the shape flows:
the profile form that edits the same record, the API schema and validators, the data model and its
migration, seeds and fixtures, the CSV export, the email templates that render the name, and every
locale's labels for the new inputs. Search the symbol and the storage key, not just the screen you
were shown. _Tell: you changed data, so the sweep set is every producer, consumer, and renderer of
that data._

## Before you call a sweep complete

- [ ] The concept is named and its home identified — one shared source, or N copies.
- [ ] The shared-vs-duplicated decision is stated: fix the source once, or sweep every copy.
- [ ] The sweep set is enumerated in the note — importers, copies, cross-cutting artifacts.
- [ ] Every entry is changed or ruled out with a reason. None is "probably fine".
- [ ] The vocabulary you searched is recorded, so a reviewer can re-run it.
