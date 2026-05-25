#!/usr/bin/env python3
"""Generate /workspace/output/deck.pptx from an outline.md.

Parse a small markdown subset (H1 = deck title, H2 = slide, list items =
bullets, prose = speaker notes). Optional YAML frontmatter on the
outline selects a `palette` and `font` pairing — see references/design.md
for the catalog.

The platform stages every chat-uploaded attachment into
/workspace/output/<filename> before this script runs; we look there for
outline.md / *.outline.md. If no outline is found we fall back to a
3-slide demo so cold invocations still produce a visible artifact.
"""

import glob
import sys
from dataclasses import dataclass, field
from pathlib import Path

try:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Emu, Inches, Pt
except ImportError as e:
    sys.stderr.write(f"python-pptx import failed: {e}\n")
    sys.exit(1)

WORKDIR = Path("/workspace/output")
OUT_PATH = WORKDIR / "deck.pptx"

# Slide dimensions for the default 4:3 layout from python-pptx. We keep
# 4:3 because it matches the upstream default template — switching to
# widescreen would mean recomputing every margin.
SLIDE_W = Inches(10)
SLIDE_H = Inches(7.5)


@dataclass(frozen=True)
class Palette:
    primary: str
    secondary: str
    accent: str
    title_fg: str = "FFFFFF"
    body_fg: str = "1A1A1A"


PALETTES: dict[str, Palette] = {
    "midnight-executive": Palette("1E2761", "CADCFC", "FFFFFF"),
    "forest-moss": Palette("2C5F2D", "97BC62", "F5F5F5"),
    "coral-energy": Palette("F96167", "F9E795", "2F3C7E"),
    "warm-terracotta": Palette("B85042", "E7E8D1", "A7BEAE"),
    "charcoal-minimal": Palette("36454F", "F2F2F2", "212121"),
    "teal-trust": Palette("028090", "00A896", "02C39A"),
    "berry-cream": Palette("6D2E46", "A26769", "ECE2D0"),
    "cherry-bold": Palette("990011", "FCF6F5", "2F3C7E"),
    "ocean-gradient": Palette("065A82", "1C7293", "21295C"),
    "sage-calm": Palette("84B59F", "69A297", "50808E"),
}

FONTS: dict[str, tuple[str, str]] = {
    # key -> (header font, body font)
    "georgia-calibri": ("Georgia", "Calibri"),
    "arial-black-arial": ("Arial Black", "Arial"),
    "calibri-light": ("Calibri", "Calibri Light"),
    "cambria-calibri": ("Cambria", "Calibri"),
    "trebuchet-calibri": ("Trebuchet MS", "Calibri"),
    "impact-arial": ("Impact", "Arial"),
    "palatino-garamond": ("Palatino", "Garamond"),
    "consolas-calibri": ("Consolas", "Calibri"),
}

DEFAULT_PALETTE = "midnight-executive"
DEFAULT_FONT = "georgia-calibri"


@dataclass
class Slide:
    title: str
    bullets: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


@dataclass
class Outline:
    title: str
    slides: list[Slide] = field(default_factory=list)
    palette_key: str = DEFAULT_PALETTE
    font_key: str = DEFAULT_FONT


def find_outline_file() -> Path | None:
    candidates: list[Path] = []
    for pattern in ("outline.md", "*.outline.md", "outline.markdown"):
        candidates.extend(Path(p) for p in glob.glob(str(WORKDIR / pattern)))
    candidates = sorted(set(candidates))
    return candidates[0] if candidates else None


def split_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Tiny YAML-subset frontmatter parser — only top-level `key: value`
    pairs, no nesting. Returns ({}, original_text) if no frontmatter is
    present. Anything fancier should live in the agent, not the sandbox."""
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    body = text[end + 5 :]
    fm: dict[str, str] = {}
    for raw_line in text[4:end].splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        fm[k.strip()] = v.strip().strip("\"'")
    return fm, body


def parse_outline(text: str) -> Outline:
    fm, body = split_frontmatter(text)
    outline = Outline(
        title="Untitled deck",
        palette_key=fm.get("palette", DEFAULT_PALETTE),
        font_key=fm.get("font", DEFAULT_FONT),
    )
    if outline.palette_key not in PALETTES:
        sys.stderr.write(
            f"warning: unknown palette '{outline.palette_key}', using {DEFAULT_PALETTE}\n"
        )
        outline.palette_key = DEFAULT_PALETTE
    if outline.font_key not in FONTS:
        sys.stderr.write(
            f"warning: unknown font pairing '{outline.font_key}', using {DEFAULT_FONT}\n"
        )
        outline.font_key = DEFAULT_FONT

    title_seen = False
    current: Slide | None = None
    for raw_line in body.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue
        if stripped.startswith("# ") and not stripped.startswith("## "):
            if not title_seen:
                outline.title = stripped[2:].strip() or outline.title
                title_seen = True
            continue
        if stripped.startswith("## "):
            current = Slide(
                title=stripped[3:].strip() or f"Slide {len(outline.slides) + 1}"
            )
            outline.slides.append(current)
            continue
        if current is None:
            current = Slide(title=outline.title)
            outline.slides.append(current)
        if stripped.startswith(("-", "*", "+")):
            current.bullets.append(stripped.lstrip("-*+ ").strip())
        else:
            current.notes.append(stripped)

    if not outline.slides:
        outline.slides.append(
            Slide(
                title=outline.title,
                notes=["(outline had no slide-level headings)"],
            )
        )
    return outline


def demo_outline() -> Outline:
    return Outline(
        title="Sample deck",
        slides=[
            Slide(
                title="What this skill does",
                bullets=[
                    "Turns a markdown outline into a .pptx",
                    "Title slide + one slide per `## Heading`",
                    "Bullets from list items, prose becomes speaker notes",
                ],
                notes=["Demo fallback — attach outline.md to drive real content."],
            ),
            Slide(
                title="How to drive it",
                bullets=[
                    "Attach outline.md to the thread",
                    "Optional `palette:` / `font:` frontmatter",
                    "Ask the agent for a deck",
                    "Receive deck.pptx as an attachment",
                ],
            ),
            Slide(
                title="Extending",
                bullets=[
                    "Edit scripts/generate.py for charts, images, layouts",
                    "Add palettes / fonts to the PALETTES / FONTS dicts",
                    "Declare new packages in SKILL.md frontmatter",
                ],
                notes=[
                    "The bundle stays minimal on purpose so the script is readable.",
                ],
            ),
        ],
    )


def hex_to_rgb(hex_str: str) -> RGBColor:
    return RGBColor(int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16))


def add_background(slide, color_hex: str) -> None:
    """python-pptx has no direct slide-background-fill setter, so paint a
    full-bleed rectangle and send it to the back. Cheap and pixel-exact."""
    bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SLIDE_W, SLIDE_H)
    bg.fill.solid()
    bg.fill.fore_color.rgb = hex_to_rgb(color_hex)
    bg.line.fill.background()
    bg.shadow.inherit = False
    # Send to back so subsequent shapes overlay it.
    spTree = bg._element.getparent()
    spTree.remove(bg._element)
    spTree.insert(2, bg._element)


def add_accent_bar(slide, color_hex: str) -> None:
    """Thin left-edge bar — the committed visual motif. Repeats on every
    content slide so the deck reads as one piece, not a stack of templates."""
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Emu(45720), SLIDE_H)
    bar.fill.solid()
    bar.fill.fore_color.rgb = hex_to_rgb(color_hex)
    bar.line.fill.background()


def style_run(
    run, font_name: str, size_pt: int, color_hex: str, bold: bool = False
) -> None:
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.color.rgb = hex_to_rgb(color_hex)


def build_title_slide(
    prs, outline: Outline, palette: Palette, header_font: str
) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    add_background(slide, palette.primary)

    # Title text box, large and left-aligned with a comfortable margin.
    tb = slide.shapes.add_textbox(Inches(0.7), Inches(2.6), Inches(8.6), Inches(1.8))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    tf.margin_right = 0
    p = tf.paragraphs[0]
    p.text = outline.title
    style_run(p.runs[0], header_font, 44, palette.title_fg, bold=True)

    # Subtitle: slide count, in the accent color so it pops against the
    # primary background without competing with the title.
    sub_box = slide.shapes.add_textbox(
        Inches(0.7), Inches(4.5), Inches(8.6), Inches(0.6)
    )
    sub_tf = sub_box.text_frame
    sub_tf.margin_left = 0
    sp = sub_tf.paragraphs[0]
    sp.text = f"{len(outline.slides)} slide{'s' if len(outline.slides) != 1 else ''}"
    style_run(sp.runs[0], header_font, 18, palette.accent)


def build_content_slide(
    prs,
    spec: Slide,
    palette: Palette,
    header_font: str,
    body_font: str,
) -> None:
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    add_accent_bar(slide, palette.primary)

    # Title — Georgia-style serif at 36pt, primary palette color.
    title_box = slide.shapes.add_textbox(
        Inches(0.7), Inches(0.5), Inches(8.8), Inches(1.0)
    )
    tf = title_box.text_frame
    tf.word_wrap = True
    tf.margin_left = 0
    p = tf.paragraphs[0]
    p.text = spec.title
    style_run(p.runs[0], header_font, 36, palette.primary, bold=True)

    # Body — bullet list, left-aligned, body color.
    body_box = slide.shapes.add_textbox(
        Inches(0.7), Inches(1.8), Inches(8.8), Inches(5.0)
    )
    body_tf = body_box.text_frame
    body_tf.word_wrap = True
    body_tf.margin_left = 0

    if spec.bullets:
        for i, bullet in enumerate(spec.bullets):
            para = body_tf.paragraphs[0] if i == 0 else body_tf.add_paragraph()
            para.text = f"•  {bullet}"
            para.space_after = Pt(8)
            style_run(para.runs[0], body_font, 22, palette.body_fg)
    else:
        para = body_tf.paragraphs[0]
        para.text = ""

    if spec.notes:
        notes_tf = slide.notes_slide.notes_text_frame
        notes_tf.text = " ".join(spec.notes)


def build_deck(outline: Outline, out_path: Path) -> None:
    palette = PALETTES[outline.palette_key]
    header_font, body_font = FONTS[outline.font_key]

    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H

    build_title_slide(prs, outline, palette, header_font)
    for spec in outline.slides:
        build_content_slide(prs, spec, palette, header_font, body_font)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out_path))


def main() -> int:
    outline_path = find_outline_file()
    if outline_path is None:
        outline = demo_outline()
        source = "(built-in demo)"
    else:
        try:
            text = outline_path.read_text(encoding="utf-8")
        except OSError as exc:
            sys.stderr.write(f"could not read {outline_path}: {exc}\n")
            return 1
        outline = parse_outline(text)
        source = outline_path.name

    build_deck(outline, OUT_PATH)

    sys.stdout.write(
        f"Wrote {OUT_PATH} — {len(outline.slides)} content slide(s) from {source}\n"
        f"  palette: {outline.palette_key}\n"
        f"  font:    {outline.font_key}\n"
    )
    sys.stdout.write("Slide titles:\n")
    for i, slide in enumerate(outline.slides, start=1):
        sys.stdout.write(f"  {i}. {slide.title}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
