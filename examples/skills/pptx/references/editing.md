# Editing Presentations

This doc adapts Anthropic's upstream `editing.md` for the Tale `run_code` sandbox.
The XML-level guidance (formatting rules, common pitfalls) is verbatim from upstream;
the workflow section is rewritten because each `run_code` invocation is a fresh
container — multi-step shell pipelines don't survive between calls.

---

## Tale workspace notes (read first)

The upstream skill assumes a long-lived shell where you run `unpack.py` →
edit files in `unpacked/` → `clean.py` → `pack.py` as separate commands. The
Tale sandbox does NOT work this way. Each `run_code` call spins up a clean
container, runs one step, then throws the filesystem away. Anything written
into `/workspace/output/` is harvested back; anything else evaporates.

So the editing flow must live inside a **single Python wrapper script** that
imports `unpack`/`pack`/`clean` as modules and runs them in-process against a
`tempfile.TemporaryDirectory()`. The reference impl is at
[scripts/example_edit.py](../scripts/example_edit.py) — read it before you
write your own.

**Staging the helper scripts.** The agent must `file_write` each helper into
the workspace before `run_code`:

1. `read_skill_file({ skillSlug: "pptx", path: "scripts/__init__.py" })` →
   `file_write({ path: "scripts/__init__.py", content: ... })`
2. Same for `scripts/clean.py`, `scripts/add_slide.py`,
   `scripts/office/unpack.py`, `scripts/office/pack.py`.
3. Then `file_write` your wrapper (start from `scripts/example_edit.py`).
4. `run_code({ entryPath: "edit.py", packages: { python: ["python-pptx==1.0.2", "defusedxml==0.7.1"] } })`.

**Always pass `validate=False` to `pack()`.** The `validators` package and
its XSD schema tree (~1 MB) are NOT shipped with this skill, so validation
is disabled by design. The `pack.py` module imports validators lazily, only
when `validate=True` — but if you forget and pass `validate=True`, you'll
get an `ImportError`.

**Visual QA via `soffice` + `pdftoppm` does NOT work** in this sandbox — no
LibreOffice, no Poppler. Substitute by running `python -m markitdown` on the
output (declare `markitdown[pptx]==0.1.5` in `packages.python`) and quoting
the extracted slide titles back to the user before declaring success. See
[reading.md](reading.md).

---

## Template-Based Workflow

When using an existing presentation as a template:

1. **Analyze existing slides** — `markitdown` only, no `thumbnail.py`:

   ```python
   # In your wrapper script:
   import subprocess
   subprocess.run(["python", "-m", "markitdown", "template.pptx"], check=True)
   ```

   Read the markitdown output to see placeholder text and slide ordering.

2. **Plan slide mapping**: For each content section, choose a template slide.

   ⚠️ **USE VARIED LAYOUTS** — monotonous presentations are a common failure
   mode. Don't default to basic title + bullet slides. Actively seek out:
   - Multi-column layouts (2-column, 3-column)
   - Image + text combinations
   - Full-bleed images with text overlay
   - Quote or callout slides
   - Section dividers
   - Stat/number callouts
   - Icon grids or icon + text rows

   **Avoid:** Repeating the same text-heavy layout for every slide.

   Match content type to layout style (e.g., key points → bullet slide, team
   info → multi-column, testimonials → quote slide).

3. **Unpack** (in-process):

   ```python
   from office.unpack import unpack
   unpack("/workspace/output/template.pptx", "/tmp/unpacked")
   ```

4. **Structural changes** (do this before content edits):
   - Delete unwanted slides (remove their `<p:sldId>` from `ppt/presentation.xml`'s `<p:sldIdLst>`).
   - Duplicate slides with `add_slide.add_slide(unpacked_dir, "slide2.xml")`.
   - Reorder slides by rearranging `<p:sldId>` elements.

5. **Edit content**: Open each `ppt/slides/slide{N}.xml` and rewrite text
   spans. The Tale sandbox doesn't have a separate Edit tool inside the run,
   so do the edits in Python — read the file, run targeted string or DOM
   replacements, write it back. Keep edits minimal and specific (find a
   distinctive substring, replace it).

6. **Clean**:

   ```python
   from clean import clean
   clean("/tmp/unpacked")
   ```

7. **Pack** (validation off):
   ```python
   from office.pack import pack
   pack("/tmp/unpacked", "/workspace/output/edited.pptx", validate=False)
   ```

---

## Scripts

| Script         | Purpose                               |
| -------------- | ------------------------------------- |
| `unpack.py`    | Extract and pretty-print PPTX         |
| `add_slide.py` | Duplicate slide or create from layout |
| `clean.py`     | Remove orphaned files                 |
| `pack.py`      | Repack (validation disabled in Tale)  |

All four are vendored under `scripts/` and `scripts/office/`. The
upstream `scripts/thumbnail.py` and `scripts/office/soffice.py` are NOT
shipped — they depend on LibreOffice which isn't in the sandbox image.

### `unpack(input_path, output_dir)`

Extracts a `.pptx` to `output_dir`, pretty-prints XML, escapes smart quotes.
Idempotent.

### `add_slide(unpacked_dir, source_name)`

Duplicates `slide{N}.xml` or instantiates a slide from a `slideLayout{N}.xml`.
Prints the `<p:sldId>` line you append to `<p:sldIdLst>` in
`ppt/presentation.xml`.

### `clean(unpacked_dir)`

Removes slides not referenced in `<p:sldIdLst>`, drops unreferenced media,
prunes orphaned `.rels` entries.

### `pack(input_dir, output_path, original_file=None, validate=False)`

Repacks `input_dir` into `output_path`. Always pass `validate=False` in
this sandbox.

---

## Slide Operations

Slide order is in `ppt/presentation.xml` → `<p:sldIdLst>`.

**Reorder**: Rearrange `<p:sldId>` elements.

**Delete**: Remove `<p:sldId>`, then call `clean()`.

**Add**: Use `add_slide()`. Never manually copy slide files — the function
handles notes references, `Content_Types.xml`, and relationship IDs that
manual copying misses.

---

## Editing Content (XML rules)

For each slide:

1. Read the slide's XML.
2. Identify ALL placeholder content — text, images, charts, icons, captions.
3. Replace each placeholder with final content.

### Formatting Rules

- **Bold all headers, subheadings, and inline labels**: set `b="1"` on `<a:rPr>`. This includes:
  - Slide titles
  - Section headers within a slide
  - Inline labels (e.g., "Status:", "Description:") at the start of a line
- **Never use unicode bullets (`•`)**: use proper list formatting with `<a:buChar>` or `<a:buAutoNum>`.
- **Bullet consistency**: let bullets inherit from the layout. Only specify `<a:buChar>` or `<a:buNone>` when overriding.

---

## Common Pitfalls

### Template Adaptation

When source content has fewer items than the template:

- **Remove excess elements entirely** (images, shapes, text boxes), don't just clear text.
- Check for orphaned visuals after clearing text content.

When replacing text with different-length content:

- **Shorter replacements**: usually safe.
- **Longer replacements**: may overflow or wrap unexpectedly.
- Consider truncating or splitting content to fit the template's design constraints.

**Template slots ≠ Source items**: if template has 4 team members but
source has 3 users, delete the 4th member's entire group (image + text
boxes), not just the text.

### Multi-Item Content

If source has multiple items (numbered lists, multiple sections), create
separate `<a:p>` elements for each — **never concatenate into one string**.

**❌ WRONG** — all items in one paragraph:

```xml
<a:p>
  <a:r><a:rPr .../><a:t>Step 1: Do the first thing. Step 2: Do the second thing.</a:t></a:r>
</a:p>
```

**✅ CORRECT** — separate paragraphs with bold headers:

```xml
<a:p>
  <a:pPr algn="l"><a:lnSpc><a:spcPts val="3919"/></a:lnSpc></a:pPr>
  <a:r><a:rPr lang="en-US" sz="2799" b="1" .../><a:t>Step 1</a:t></a:r>
</a:p>
<a:p>
  <a:pPr algn="l"><a:lnSpc><a:spcPts val="3919"/></a:lnSpc></a:pPr>
  <a:r><a:rPr lang="en-US" sz="2799" .../><a:t>Do the first thing.</a:t></a:r>
</a:p>
<a:p>
  <a:pPr algn="l"><a:lnSpc><a:spcPts val="3919"/></a:lnSpc></a:pPr>
  <a:r><a:rPr lang="en-US" sz="2799" b="1" .../><a:t>Step 2</a:t></a:r>
</a:p>
```

Copy `<a:pPr>` from the original paragraph to preserve line spacing. Use
`b="1"` on headers.

### Smart Quotes

Handled automatically by `unpack`/`pack`. When adding new text with quotes,
use XML entities:

```xml
<a:t>the &#x201C;Agreement&#x201D;</a:t>
```

| Character | Name               | Unicode | XML Entity |
| --------- | ------------------ | ------- | ---------- |
| `"`       | Left double quote  | U+201C  | `&#x201C;` |
| `"`       | Right double quote | U+201D  | `&#x201D;` |
| `'`       | Left single quote  | U+2018  | `&#x2018;` |
| `'`       | Right single quote | U+2019  | `&#x2019;` |

### Other

- **Whitespace**: use `xml:space="preserve"` on `<a:t>` with leading/trailing spaces.
- **XML parsing**: use `defusedxml.minidom`, not `xml.etree.ElementTree` (corrupts namespaces).
