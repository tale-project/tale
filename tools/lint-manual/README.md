# @tale/lint-manual

The manual-test gate: the shape [`AGENTS.md`](../../AGENTS.md) states, enforced.
`bun run lint:manual` walks the checkout, finds every `tests/manual/` tree, and
fails on the drift that makes a manual layer stop being usable — a suite the
guide does not list, a box ID two suites both own, a pin keyed to a box nobody
wrote, a round record with no row in the journal, a tick committed into a test.

```bash
bun run lint:manual              # this checkout
bun tools/lint-manual/cli.ts ~/git/other-repo
bun run --filter @tale/lint-manual test
```

It runs in `bun run check` through this workspace's own `test` script, so the
structure is proven on every commit rather than on the day someone reads it.

## Shape

Same division as any gate in this family: one module touches disk, the rules are
pure functions over a model, and the entry point holds nothing worth testing.

| Path | What |
| --- | --- |
| `src/model.ts` | the model a rule reads — roots, suites, boxes, registers |
| `src/parse.ts` | the markdown: the box grammar, the prefix declaration, links |
| `src/collect.ts` | the only module that touches disk |
| `src/rules/` | one file per rule, each a pure `(repo) => Finding[]` |
| `src/lint.ts` | runs the rules, formats findings, decides the exit code |
| `cli.ts` | argv and exit code; proven as a subprocess by `tests/cli.test.ts` |

## The rules

| Rule | Holds |
| --- | --- |
| `layout` | every tree carries the same files: `readme.md`, `setup.md`, `template.md`, `suites/` with at least one suite, the four registers under `reference/`, and the journal plus its two templates under `runs/`. `scripts/` is the one optional slot. |
| `suites` | each suite declares a prefix and no prefix shadows another (two suites may share one, so a chain and its standalone tours can continue one numbering), every box parses as ``- [ ] `ID` · **action** → judgment``, every ID starts with its suite's prefix and is unique in the tree, no box is ticked, no suite holds a findings table, and the guide's suites table and the directory agree. |
| `runs` | a record is `r<nnnn>.md`, and the rounds table and the files agree in both directions. |
| `references` | every box `pins.md`, `automation.md` or the guide cites exists — as a box, or as the group a box belongs to (`P4` for `P4.1`) — and every `BL-n` cited anywhere is defined in `not-a-finding.md`. `runs/` is exempt — a record is history and is never rewritten. |

**Add a rule here, add its test in `tests/rules/` under the same name, and state
it in the manual layer's own `readme.md`** — a rule nothing checks rots, and a
rule nobody documented is a trap.

## Adding a rule

1. Write it in `src/rules/<name>.ts` as a pure function over `Repo`.
2. Register it in `src/rules/index.ts` — the order is the order a reader meets
   the tree.
3. Test it in `tests/rules/<name>.test.ts` against the factories in
   `tests/factories.ts`; reach for the on-disk fixture (`tests/repo-fixture.ts`)
   only when the rule is about the filesystem.
