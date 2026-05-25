# PPTX design reference

Read this file via `read_skill_file` when you need to pick a palette, font pairing, or slide layout for a deck. The defaults in `scripts/generate.py` reach for solid choices — but a deck about a brand, a topic, or a mood will land harder if you pick a palette that fits.

## Don't create boring slides

Plain bullets on a white background won't impress anyone. For every deck:

- **Pick a bold, content-informed palette.** If swapping your colors into a different deck would still "work", you haven't been specific enough. A finance deck should not look like a wellness deck.
- **Dominance over equality.** One color should dominate (60–70% visual weight), with 1–2 supporting tones and one sharp accent. Never give all colors equal weight.
- **Dark/light contrast.** Dark title + conclusion slides, light content ("sandwich"). Or commit to dark throughout for a premium feel.
- **Commit to a visual motif.** Pick ONE distinctive element and repeat it across slides — rounded image frames, icons in colored circles, thick single-side borders.

## Color palettes

`palette: <key>` in the outline frontmatter. Pick from this list — adding new ones means editing `scripts/generate.py`.

| Key                  | Mood                              | Primary           | Secondary           | Accent           |
| -------------------- | --------------------------------- | ----------------- | ------------------- | ---------------- |
| `midnight-executive` | Corporate, finance, default       | `1E2761` (navy)   | `CADCFC` (ice blue) | `FFFFFF` (white) |
| `forest-moss`        | Sustainability, agriculture, calm | `2C5F2D` (forest) | `97BC62` (moss)     | `F5F5F5` (cream) |
| `coral-energy`       | Consumer, marketing, energetic    | `F96167` (coral)  | `F9E795` (gold)     | `2F3C7E` (navy)  |
| `warm-terracotta`    | Hospitality, lifestyle, warm      | `B85042` (clay)   | `E7E8D1` (sand)     | `A7BEAE` (sage)  |
| `charcoal-minimal`   | Editorial, premium, restrained    | `36454F` (slate)  | `F2F2F2` (offwhite) | `212121` (black) |
| `teal-trust`         | Tech, healthcare, trustworthy     | `028090` (teal)   | `00A896` (seafoam)  | `02C39A` (mint)  |
| `berry-cream`        | Beauty, fashion, soft             | `6D2E46` (berry)  | `A26769` (rose)     | `ECE2D0` (cream) |
| `cherry-bold`        | Bold launches, statements         | `990011` (cherry) | `FCF6F5` (offwhite) | `2F3C7E` (navy)  |

## Font pairings

`font: <key>` in the outline frontmatter. Header font carries personality; body font stays clean.

| Key                 | Header       | Body          | Best for                      |
| ------------------- | ------------ | ------------- | ----------------------------- |
| `georgia-calibri`   | Georgia      | Calibri       | Default — readable, serious   |
| `arial-black-arial` | Arial Black  | Arial         | Bold statements, sales        |
| `calibri-light`     | Calibri      | Calibri Light | Modern, minimal               |
| `cambria-calibri`   | Cambria      | Calibri       | Editorial, long-form          |
| `trebuchet-calibri` | Trebuchet MS | Calibri       | Tech, friendly                |
| `impact-arial`      | Impact       | Arial         | Marketing, energetic          |
| `palatino-garamond` | Palatino     | Garamond      | Classical, academic           |
| `consolas-calibri`  | Consolas     | Calibri       | Developer / engineering decks |

## Sizes (the script already enforces this)

| Element        | Size          |
| -------------- | ------------- |
| Slide title    | 36–44pt bold  |
| Section header | 20–24pt bold  |
| Body text      | 14–16pt       |
| Captions       | 10–12pt muted |

## Spacing

- 0.5" minimum margin from slide edges.
- 0.3–0.5" between content blocks; pick one and use it consistently.
- Leave breathing room. Don't fill every inch.

## Layout patterns

The default `scripts/generate.py` ships Title-Content layouts because they're forgiving. If you extend the script, these are the patterns that lift a deck:

- **Two-column** — text left, illustration or pull-quote right.
- **Icon rows** — icon in a colored circle, bold header beside it, description below.
- **2×2 / 2×3 grid** — content blocks for comparisons or feature lists.
- **Half-bleed image** — full-side image with content overlay on the other half.
- **Big stat callouts** — 60–72pt number, small caption below. Use sparingly; one per deck.

## Anti-patterns (don't do these)

- Repeating the same layout on every slide — vary cards, columns, callouts.
- Centering body text — left-align paragraphs and lists; center only titles.
- 14pt titles on 14pt body — titles need ≥36pt to carry weight.
- Defaulting to corporate blue regardless of topic.
- Mixing 0.3" and 0.5" gaps randomly — pick one.
- Styling one slide and leaving the rest plain — commit fully or keep it simple throughout.
- Text-only slides — add icons, shapes, or accent bars; plain title + bullets reads as AI-generated.
- Forgetting text-box padding when aligning shapes to text — `tf.margin_left = 0` or offset the shape.
- Low-contrast pairings (light text on light backgrounds, dark icons on dark fills).
- Decorative accent lines under titles — a hallmark of AI-generated slides. Use whitespace or a background block instead.

## QA pass

The reference Anthropic pptx skill runs a visual-QA loop (render slides to JPGs, ask a subagent to spot issues). **That workflow does not work in this sandbox** — no LibreOffice, no pdftoppm. Instead:

1. Read `stdoutPreview` to confirm slide count and titles match what the outline declared.
2. Quote the titles back to the user before declaring success — they spot wrong order / typos better than you do.
3. If the user opens the deck and reports a layout issue, fix the script and re-run — there is no shortcut to local rendering inside the sandbox.
