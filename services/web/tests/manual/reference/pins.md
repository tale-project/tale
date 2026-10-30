# Why a box says that

Each row below is an expectation a suite carries **because something once went
wrong**. The box itself states only the check, so it stays readable; the reason
lives here.

Read this **before you reword, merge or delete a box** — an oddly specific
expectation is usually specific on purpose. Read it too when a box fails and you
want to know what class of defect it was written to catch.

Rows marked `docs` are corrections to this guide rather than to the product: the
box used to ask for something unreachable or wrong, and a round proved it. They
stay so nobody re-introduces the old wording.

**Adding a row:** when a round sharpens a box, add the row here in the same
change as the box edit. Key it by box ID, state the mechanism (not the symptom),
and name the test that now holds it. Never key a row by round — the journal in
[`../runs`](../runs) records rounds, this register records product knowledge.

**This register starts empty on purpose.** It was created on 2026-09-08 with the
shared manual-test shape; until then a box's reason lived inside its own wording,
which is why several boxes read as long as they do. Move a reason here the first
time you are tempted to shorten one.

| Box | What it pins |
|---|---|
| `FORM-B11` | The server once capped a submission at a fixed 4 KiB while the schemas allow 2,000 UTF-16 units per field, and a typed character takes up to three UTF-8 bytes per unit: a 2,000-character message in Russian (about 4.2 KB) or Japanese (about 6.2 KB) passed client validation and was refused with 413, shown as the generic error (#4677). The cap now covers the largest valid submission, held by `lib/forms/submit-body.test.ts`. |
