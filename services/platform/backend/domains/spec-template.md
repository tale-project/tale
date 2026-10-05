# The shape of a domain spec

Copy the skeleton at the foot of this file to `<domain>/spec.md` and fill it in. A spec states
what a domain guarantees, for a person who has not read the code: who can do what, what is
refused, and what stays true. It says nothing about how the code does it.
`tests/guards/domain-specs.guard.test.ts` parses every `domains/*/spec.md` and fails on a spec
that leaves this shape.

A spec does not replace the other records of a feature. It gives them one key:

| Record | Where | What it holds |
| --- | --- | --- |
| User docs | `docs/en/platform/` | how the feature behaves, told to the person using it |
| Manual suite | `tests/manual/suites/` | what a person judges in a browser |
| REST contract | `scripts/openapi/spec.ts` | the request and response shapes |
| Domain spec | `backend/domains/<domain>/spec.md` | the rules behind all three |
| Tests | beside the code | the proof of each rule, named by the rule's ID in the test's title |

## Authoring conventions

Write each rule the way you would tell it to a colleague who has never opened the code.

1. **Declare the prefix in the header blockquote.** Use the prefix of the manual suite that
   covers the same feature (`TASK-` for `suites/tasks.md`) and link that suite as **Suite**, so a
   rule and a box of one feature read as one family: `TASK-R4`, `TASK-F63`. A domain no suite
   covers takes a new prefix that no suite and no other spec uses. Suite boxes own the kind
   letters `F`, `B`, `A`, `P`, `AT`, `L` and `G`; a spec owns `R`.
2. **Group the rules under topic headings**, named for what a reader would look up: `## Who can
   do what`, `## Size limits`. Open a group with the view a reader wants first: a table when
   the rules are a grid (who against what, a field against its limit), a sentence or two
   otherwise.
3. **One rule, one card.** `### <PREFIX>-R<n> · <the rule>`. The heading is the rule itself, as
   one plain sentence of at most 80 characters. Say who can do what, in the positive: "Only
   owners and admins can delete a task", not "A delete must be refused unless the caller is an
   owner or an admin".
4. **Keep the body to a few short sentences**: what the rule covers, its exception, and the
   refusal code in brackets. Use the product's words, not the code's: "the provider's rate
   limit", not "the broker cooldown". A reader who needs the mechanism reads the code.
5. **Give every rule an example.** `- **Example**: <a named person, a situation, one action> →
   <what happens>.` An example is what makes a rule checkable by someone who was not there when
   it was written. Use the same few names across a spec.
6. **A test holds every rule, and the test says so.** The spec lists no tests. Put the rule's
   ID at the end of the title of the test that holds it, or of the `describe` when the whole
   block does: `it('does not delete it [TASK-R4]', …)`. The guard reads the test titles of this
   workspace and fails on a rule no running test names, and on a title that names a rule no
   spec states. A skipped test holds nothing. To find the tests of a rule, search the workspace
   for its ID. A rule no test holds yet is not a rule yet: write the test, or leave the rule
   under Not yet.
7. **A spec holds rules, nothing about them.** A rule in the spec is a rule of the product.
   Whether it is the intended one is settled where every change is: in the review of the change
   that adds or moves it. The spec carries no status and no list of tests.
8. **Never guess.** Where the code, the docs and the tests leave the intent undecided, do not
   write a rule. Put the question under Not yet, as `**Undecided: <the question>?**` with each
   reading and where it comes from. It becomes a rule, with an ID, once someone decides. A rule
   read off the code alone records the code's bugs as requirements; this is what keeps the two
   apart.
9. **Append IDs; never renumber.** A rule that dies is deleted and its ID is never reused.
   Suites, findings and commit messages cite these IDs.
10. **Not yet holds what the spec leaves out**: the parts of the domain it does not cover, the
    rules no test holds yet, the questions nobody has decided, and the known debt against a
    rule. Link the ledger entry in
    [`.agents/repo.md`](../../../../.agents/repo.md) rather than restating it.
11. **State the rule, not its history.** Why a rule is worded as it is belongs in the code
    comment or the commit that made it so.

The optional **Docs** link names the user docs page of the feature. A page outside this
workspace must be an input of the platform's `test` task in [`turbo.json`](../../turbo.json),
or an edit to the page alone would replay the guard's cached verdict; the guard checks that too.

---

# <Domain> — <what these rules decide>

> **Prefix** `<PREFIX>-` · **Suite** [`<suite>`](../../../tests/manual/suites/<suite>.md) · **Docs** [`<page>`](../../../../../docs/en/platform/<page>.md)

<One paragraph: what the rules below cover, and the parts of the domain they leave to Not yet.>

## <Topic, as a reader would look it up>

<The view a reader wants first: a table for a grid of rules, a sentence or two otherwise.>

### <PREFIX>-R1 · <Who can do what, as one plain sentence>

<What the rule covers, its exception, and the refusal code in brackets.>

- **Example**: <A named person, a situation, one action> → <what happens>.

## Not yet

- <A part of the domain this spec does not cover yet.>
- <A rule the code keeps and no test holds yet.>
- **Undecided: <a question the code, the docs and the tests answer differently>?** <Each
  reading, and where it comes from.>
