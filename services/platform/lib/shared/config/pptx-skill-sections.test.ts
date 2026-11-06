// @vitest-environment node

/**
 * The builtin pptx skill builds a deck from a template by deleting,
 * duplicating and adding slides. A template's sections sit beside the slide
 * list in `ppt/presentation.xml`; left alone they keep naming the deleted
 * slides and never the new ones, and PowerPoint then shows every template
 * section empty above or below the deck's real slides. These run the skill's
 * own scripts with the machine's python3 on synthetic decks, the way its
 * editing guide tells the model to. The scripts parse with defusedxml, which
 * the sandbox image bakes; here a stand-in hands them the standard library's
 * minidom, which builds the same tree for these documents. A deck built
 * with python-pptx loses its slides through `delete_slide`; python-pptx is
 * not installed here, so stand-ins play the few objects it touches, and the
 * sandbox image runs the real library (CHAT-F98 checks the result in
 * PowerPoint).
 */

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SKILL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../configs/platform/custom/skills/pptx',
);
const SCRIPTS = path.join(SKILL, 'scripts');

const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const SECTIONS_EXT = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';
const GUIDES_EXT = '{EFAFB233-063F-42B5-8137-9DF3F51BA10A}';
const NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * Deletes slides of an unpacked deck through delete_slide, the way a
 * python-pptx program would, with stand-ins for the python-pptx objects it
 * touches; prints the relationships it dropped and every slide part's name.
 */
const PYTHON_PPTX_STAND_IN = `import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from sections import delete_slide

P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
for prefix, uri in {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": R[1:-1],
    "p": P[1:-1],
    "p14": "${P14}",
    "p15": "http://schemas.microsoft.com/office/powerpoint/2012/main",
}.items():
    ET.register_namespace(prefix, uri)


class PackURI(str):
    pass


class Part:
    def __init__(self, partname):
        self.partname = PackURI(partname)


class PresentationPart:
    def __init__(self, related):
        self.related = related
        self.dropped = []

    def related_part(self, rid):
        return self.related[rid]

    def drop_rel(self, rid):
        self.dropped.append(rid)
        del self.related[rid]

    def rename_slide_parts(self, rids):
        for number, rid in enumerate(rids, start=1):
            self.related[rid].partname = PackURI(f"/ppt/slides/slide{number}.xml")


class Presentation:
    def __init__(self, element, part):
        self.element = element
        self.part = part


class Slide:
    def __init__(self, part):
        self.part = part


deck = Path(sys.argv[1])
tree = ET.parse(deck / "ppt" / "presentation.xml")
rels = ET.parse(deck / "ppt" / "_rels" / "presentation.xml.rels").getroot()
parts = {
    rel.get("Id"): Part("/ppt/" + rel.get("Target"))
    for rel in rels
    if rel.get("Type").endswith("/slide")
}
prs = Presentation(tree.getroot(), PresentationPart(dict(parts)))
rid_of = {s.get("id"): s.get(R + "id") for s in tree.getroot().iter(P + "sldId")}
try:
    for slide_id in sys.argv[2:]:
        delete_slide(prs, Slide(parts[rid_of[slide_id]]))
except ValueError as error:
    print(json.dumps({"error": str(error)}))
    sys.exit(0)
tree.write(deck / "ppt" / "presentation.xml", encoding="UTF-8", xml_declaration=True)
names = {rid: str(part.partname) for rid, part in parts.items()}
print(json.dumps({"dropped": prs.part.dropped, "parts": names}))
`;

let root = '';
let shim = '';
let standIn = '';

beforeAll(() => {
  const probe = spawnSync(
    'python3',
    [
      '-c',
      'import xml.dom.minidom, zipfile; xml.dom.minidom.parseString("<a/>")',
    ],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0) {
    throw new Error(
      `the pptx skill's scripts need a python3 that parses XML: ${probe.error?.message ?? probe.stderr}`,
    );
  }
  root = mkdtempSync(path.join(tmpdir(), 'pptx-sections-'));
  shim = path.join(root, 'shim');
  mkdirSync(path.join(shim, 'defusedxml'), { recursive: true });
  writeFileSync(path.join(shim, 'defusedxml', '__init__.py'), '');
  writeFileSync(
    path.join(shim, 'defusedxml', 'minidom.py'),
    'from xml.dom.minidom import parse, parseString  # noqa: F401\n',
  );
  standIn = path.join(root, 'python_pptx_stand_in.py');
  writeFileSync(standIn, PYTHON_PPTX_STAND_IN);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function python(args: string[], pythonPath = shim) {
  return spawnSync('python3', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      PYTHONPATH: pythonPath,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONUTF8: '1',
    },
  });
}

function run(script: string, ...args: string[]): string {
  const result = python([path.join(SCRIPTS, script), ...args]);
  if (result.status !== 0) {
    throw new Error(
      `${script} exited ${result.status}: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout;
}

interface TemplateSection {
  name: string;
  /** 1-based slide numbers: slide n is `slide{n}.xml` with id 255 + n. */
  slides: number[];
}

interface Template {
  slides: number;
  sections?: TemplateSection[];
  /** Another presentation extension the sections must leave alone. */
  guides?: boolean;
  /** The section list's prefix (`p14` unless given); '' makes it the default namespace. */
  sectionPrefix?: string;
}

const slideId = (n: number) => String(255 + n);

function writeTemplate(template: Template): string {
  const dir = mkdtempSync(path.join(root, 'deck-'));
  const numbers = Array.from({ length: template.slides }, (_, i) => i + 1);
  const write = (name: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  };

  const prefix = template.sectionPrefix ?? 'p14';
  const tag = (name: string) => (prefix ? `${prefix}:${name}` : name);
  const sectionsExt = template.sections
    ? `
    <p:ext uri="${SECTIONS_EXT}">
      <${tag('sectionLst')} ${prefix ? `xmlns:${prefix}` : 'xmlns'}="${P14}">${template.sections
        .map(
          (section, i) => `
        <${tag('section')} name="${section.name}" id="{${String(i + 1).padStart(8, '0')}-AAAA-4BBB-8CCC-${String(i + 1).padStart(12, '0')}}">
          ${
            section.slides.length
              ? `<${tag('sldIdLst')}>${section.slides
                  .map(
                    (n) => `
            <${tag('sldId')} id="${slideId(n)}"/>`,
                  )
                  .join('')}
          </${tag('sldIdLst')}>`
              : `<${tag('sldIdLst')}/>`
          }
        </${tag('section')}>`,
        )
        .join('')}
      </${tag('sectionLst')}>
    </p:ext>`
    : '';
  const guidesExt = template.guides
    ? `
    <p:ext uri="${GUIDES_EXT}">
      <p15:sldGuideLst xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main"/>
    </p:ext>`
    : '';
  const extLst =
    sectionsExt || guidesExt
      ? `
  <p:extLst>${sectionsExt}${guidesExt}
  </p:extLst>`
      : '';

  write(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<p:presentation ${NAMESPACES} saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>${numbers
    .map(
      (n) => `
    <p:sldId id="${slideId(n)}" r:id="rId${n + 1}"/>`,
    )
    .join('')}
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>${extLst}
</p:presentation>
`,
  );
  write(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${numbers
    .map(
      (n) => `
  <Relationship Id="rId${n + 1}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`,
    )
    .join('')}
</Relationships>
`,
  );
  write(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>${numbers
    .map(
      (n) => `
  <Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join('')}
</Types>
`,
  );
  write(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="utf-8"?>\n<p:sldMaster ${NAMESPACES}/>\n`,
  );
  write(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="utf-8"?>\n<p:sldLayout ${NAMESPACES}/>\n`,
  );
  for (const n of numbers) {
    write(
      `ppt/slides/slide${n}.xml`,
      `<?xml version="1.0" encoding="utf-8"?>\n<p:sld ${NAMESPACES}/>\n`,
    );
    write(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>
`,
    );
  }
  return dir;
}

const presentationOf = (dir: string) =>
  path.join(dir, 'ppt', 'presentation.xml');

function slideEntries(xml: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [entry] of xml.matchAll(/<p:sldId\b[^>]*\/>/g)) {
    const id = /\bid="(\d+)"/.exec(entry)?.[1];
    if (id) entries.set(id, entry);
  }
  return entries;
}

/** Rewrite `<p:sldIdLst>` the way the model edits it: delete, insert, reorder. */
function setDeck(
  dir: string,
  ids: string[],
  added: Map<string, string> = new Map(),
): void {
  const file = presentationOf(dir);
  const xml = readFileSync(file, 'utf8');
  const known = new Map([...slideEntries(xml), ...added]);
  const lines = ids.map((id) => {
    const entry = known.get(id);
    if (!entry) throw new Error(`slide ${id} is neither in the deck nor added`);
    return `\n    ${entry}`;
  });
  writeFileSync(
    file,
    xml.replace(
      /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
      `<p:sldIdLst>${lines.join('')}\n  </p:sldIdLst>`,
    ),
  );
}

/** Run add_slide.py and return the `<p:sldId>` it prints for the deck. */
function addSlide(
  dir: string,
  source: string,
): { id: string; entry: string; stdout: string } {
  const stdout = run('add_slide.py', dir, source);
  const entry = /<p:sldId id="(\d+)" r:id="rId\d+"\/>/.exec(stdout);
  if (!entry?.[1])
    throw new Error(`add_slide.py printed no <p:sldId>: ${stdout}`);
  return { id: entry[1], entry: entry[0], stdout };
}

/**
 * Move a slide's `<p14:sldId>` to right after another slide's, in that
 * slide's section: what the editing guide has the model do with a copy it
 * places away from its source.
 */
function moveSectionEntry(dir: string, id: string, afterId: string): void {
  const file = presentationOf(dir);
  const xml = readFileSync(file, 'utf8');
  const entry = `<p14:sldId id="${id}"/>`;
  const anchor = `<p14:sldId id="${afterId}"/>`;
  const without = xml.replace(new RegExp(`\\s*${entry}`), '');
  if (without === xml || !without.includes(anchor))
    throw new Error(`no section entry ${entry} to move after ${anchor}`);
  writeFileSync(
    file,
    without.replace(anchor, `${anchor}\n            ${entry}`),
  );
}

interface Sections {
  order: string[];
  sections: { name: string; slides: string[] }[];
  extensions: string[];
}

function readDeck(xml: string): Sections {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const all = (parent: Document | Element, namespace: string, name: string) => {
    const list = parent.getElementsByTagNameNS(namespace, name);
    const found: Element[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const item = list.item(i);
      if (item) found.push(item);
    }
    return found;
  };
  const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  return {
    order: all(doc, P, 'sldId').map((e) => e.getAttribute('id') ?? ''),
    sections: all(doc, P14, 'section').map((section) => ({
      name: section.getAttribute('name') ?? '',
      slides: all(section, P14, 'sldId').map((e) => e.getAttribute('id') ?? ''),
    })),
    extensions: all(doc, P, 'ext').map((e) => e.getAttribute('uri') ?? ''),
  };
}

const readUnpacked = (dir: string) =>
  readDeck(readFileSync(presentationOf(dir), 'utf8'));

/** Every slide sits in exactly one section, and the sections run in deck order. */
function expectOneRunPerSection(deck: Sections): void {
  expect(deck.sections.flatMap((s) => s.slides)).toEqual(deck.order);
  expect(new Set(deck.sections.map((s) => s.name)).size).toBe(
    deck.sections.length,
  );
}

const STANDARD: TemplateSection[] = [
  { name: 'Title slides', slides: [1] },
  { name: 'Agenda', slides: [2] },
  { name: 'Content slides', slides: [3, 4] },
  { name: 'Closing slides', slides: [5] },
  { name: 'Instructions', slides: [6] },
];

describe('the pptx skill keeps a template deck’s sections in step with its slides', () => {
  it('drops deleted slides from their sections and removes the sections they empty', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD, guides: true });
    setDeck(dir, ['256', '258', '260']);

    const stdout = run('clean.py', dir);

    const deck = readUnpacked(dir);
    expect(deck.sections).toEqual([
      { name: 'Title slides', slides: ['256'] },
      { name: 'Content slides', slides: ['258'] },
      { name: 'Closing slides', slides: ['260'] },
    ]);
    expectOneRunPerSection(deck);
    expect(deck.extensions).toEqual([SECTIONS_EXT, GUIDES_EXT]);
    expect(stdout).toContain('Updated the slide sections');
  });

  it('files a slide made from a layout in the section of the slide before it', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD });
    const content = addSlide(dir, 'slideLayout1.xml');
    setDeck(
      dir,
      ['256', '258', '259', content.id, '260'],
      new Map([[content.id, content.entry]]),
    );
    const closing = addSlide(dir, 'slideLayout1.xml');
    setDeck(
      dir,
      ['256', '258', '259', content.id, '260', closing.id],
      new Map([[closing.id, closing.entry]]),
    );

    run('clean.py', dir);

    const deck = readUnpacked(dir);
    expect(deck.sections).toEqual([
      { name: 'Title slides', slides: ['256'] },
      { name: 'Content slides', slides: ['258', '259', content.id] },
      { name: 'Closing slides', slides: ['260', closing.id] },
    ]);
    expectOneRunPerSection(deck);
  });

  it('files slides ahead of every section in the first section still holding a slide, never in an emptied one', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD });
    const title = addSlide(dir, 'slideLayout1.xml');
    setDeck(dir, [title.id, '258', '259'], new Map([[title.id, title.entry]]));

    run('clean.py', dir);

    const deck = readUnpacked(dir);
    expect(deck.sections).toEqual([
      { name: 'Content slides', slides: [title.id, '258', '259'] },
    ]);
    expectOneRunPerSection(deck);
  });

  it('keeps a duplicated slide in the section of the slide it copies', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD });

    const copy = addSlide(dir, 'slide3.xml');

    expect(copy.stdout).toContain(
      'Listed it in section "Content slides" right after slide3.xml',
    );
    expect(
      readUnpacked(dir).sections.find((s) => s.name === 'Content slides'),
    ).toEqual({ name: 'Content slides', slides: ['258', copy.id, '259'] });

    setDeck(
      dir,
      ['256', '258', copy.id, '259', '260'],
      new Map([[copy.id, copy.entry]]),
    );
    run('clean.py', dir);

    const deck = readUnpacked(dir);
    expect(deck.sections).toEqual([
      { name: 'Title slides', slides: ['256'] },
      { name: 'Content slides', slides: ['258', copy.id, '259'] },
      { name: 'Closing slides', slides: ['260'] },
    ]);
    expectOneRunPerSection(deck);
  });

  it('never gives a new slide the id of a deleted slide its section still lists', () => {
    // The last slide (id 261) is the template's instructions; deleted, its
    // id would be the next free one in <p:sldIdLst>, and a new slide taking
    // it would land under Instructions.
    const dir = writeTemplate({ slides: 6, sections: STANDARD });
    const kept = ['256', '257', '258', '259', '260'];
    setDeck(dir, kept);

    const added = addSlide(dir, 'slideLayout1.xml');

    expect(added.id).toBe('262');
    setDeck(dir, [...kept, added.id], new Map([[added.id, added.entry]]));
    run('clean.py', dir);
    expect(readUnpacked(dir).sections).toEqual([
      { name: 'Title slides', slides: ['256'] },
      { name: 'Agenda', slides: ['257'] },
      { name: 'Content slides', slides: ['258', '259'] },
      { name: 'Closing slides', slides: ['260', added.id] },
    ]);
  });

  it('keeps every section one run of slides, in deck order, after slides move', () => {
    const dir = writeTemplate({
      slides: 6,
      sections: [
        { name: 'Title slides', slides: [1, 2, 3] },
        { name: 'Content slides', slides: [4, 5] },
        { name: 'Closing slides', slides: [6] },
      ],
    });
    setDeck(dir, ['259', '256', '257', '260', '258', '261']);

    run('clean.py', dir);

    const deck = readUnpacked(dir);
    expect(deck.sections).toEqual([
      { name: 'Content slides', slides: ['259'] },
      { name: 'Title slides', slides: ['256', '257', '260', '258'] },
      { name: 'Closing slides', slides: ['261'] },
    ]);
    expectOneRunPerSection(deck);
  });

  it('keeps a section where most of its slides sit when one of them moves away', () => {
    const dir = writeTemplate({
      slides: 6,
      sections: [
        { name: 'Title slides', slides: [1] },
        { name: 'Section dividers', slides: [2] },
        { name: 'Content slides', slides: [3, 4, 5] },
        { name: 'Closing slides', slides: [6] },
      ],
    });
    // A copy of a content slide, used as the agenda right after the title.
    const copy = addSlide(dir, 'slide4.xml');
    setDeck(
      dir,
      ['256', copy.id, '257', '258', '259', '260', '261'],
      new Map([[copy.id, copy.entry]]),
    );

    run('clean.py', dir);

    expect(readUnpacked(dir).sections).toEqual([
      { name: 'Title slides', slides: ['256', copy.id] },
      { name: 'Section dividers', slides: ['257'] },
      { name: 'Content slides', slides: ['258', '259', '260'] },
      { name: 'Closing slides', slides: ['261'] },
    ]);

    // A content slide moved to the very front joins the section after it.
    setDeck(dir, ['259', '256', copy.id, '257', '258', '260', '261']);

    run('clean.py', dir);

    const deck = readUnpacked(dir);
    expect(deck.sections).toEqual([
      { name: 'Title slides', slides: ['259', '256', copy.id] },
      { name: 'Section dividers', slides: ['257'] },
      { name: 'Content slides', slides: ['258', '260'] },
      { name: 'Closing slides', slides: ['261'] },
    ]);
    expectOneRunPerSection(deck);
  });

  it('removes the section list, and keeps the other extensions, when every template slide was replaced', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD, guides: true });
    const first = addSlide(dir, 'slideLayout1.xml');
    setDeck(dir, [first.id], new Map([[first.id, first.entry]]));
    const second = addSlide(dir, 'slideLayout1.xml');
    setDeck(dir, [first.id, second.id], new Map([[second.id, second.entry]]));

    const stdout = run('clean.py', dir);

    const deck = readUnpacked(dir);
    expect(deck.order).toEqual([first.id, second.id]);
    expect(deck.sections).toEqual([]);
    expect(deck.extensions).toEqual([GUIDES_EXT]);
    expect(stdout).toContain('Removed the slide sections');
  });

  it('drops the extension list too when the sections were its only extension', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD });
    const only = addSlide(dir, 'slideLayout1.xml');
    setDeck(dir, [only.id], new Map([[only.id, only.entry]]));

    run('clean.py', dir);

    const xml = readFileSync(presentationOf(dir), 'utf8');
    expect(xml).not.toContain('sectionLst');
    expect(xml).not.toContain('extLst');
    expect(readDeck(xml).order).toEqual([only.id]);
  });

  it('leaves a deck without sections byte for byte as it was', () => {
    const dir = writeTemplate({ slides: 4, guides: true });
    const added = addSlide(dir, 'slide2.xml');
    setDeck(dir, ['256', '257', added.id], new Map([[added.id, added.entry]]));
    const before = readFileSync(presentationOf(dir));

    run('clean.py', dir);

    expect(readFileSync(presentationOf(dir))).toEqual(before);
    expect(added.stdout).not.toContain('Listed it in section');
  });

  it('changes nothing on a second run', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD, guides: true });
    setDeck(dir, ['256', '258', '260']);
    run('clean.py', dir);
    const once = readFileSync(presentationOf(dir));

    const stdout = run('sections.py', dir);

    expect(readFileSync(presentationOf(dir))).toEqual(once);
    expect(stdout).toContain('already match');
  });

  // Someone's own deck, edited for its text: an empty section there is a
  // placeholder they made, not one a deletion left behind.
  const OWN_DECK: TemplateSection[] = [
    { name: 'Intro', slides: [1] },
    { name: 'Draft', slides: [] },
    { name: 'Main', slides: [2, 3] },
  ];

  it('leaves sections that already match the slides byte for byte, an empty one included', () => {
    const dir = writeTemplate({ slides: 3, sections: OWN_DECK });
    const before = readFileSync(presentationOf(dir));

    const stdout = run('clean.py', dir);

    expect(readFileSync(presentationOf(dir))).toEqual(before);
    expect(stdout).not.toContain('sections');
    expect(run('sections.py', dir)).toContain(
      'already match its slides:\n  Intro: slide 1\n  Draft: no slides\n  Main: slides 2-3\n',
    );
    expect(readFileSync(presentationOf(dir))).toEqual(before);
  });

  it('keeps a section that listed no slide after the section it followed, and removes the ones a deletion empties', () => {
    const dir = writeTemplate({
      slides: 4,
      sections: [...OWN_DECK, { name: 'Old', slides: [4] }],
    });
    setDeck(dir, ['256', '257']);

    run('clean.py', dir);

    expect(readUnpacked(dir).sections).toEqual([
      { name: 'Intro', slides: ['256'] },
      { name: 'Draft', slides: [] },
      { name: 'Main', slides: ['257'] },
    ]);

    setDeck(dir, ['257', '256']);
    run('clean.py', dir);

    expect(readUnpacked(dir).sections).toEqual([
      { name: 'Main', slides: ['257'] },
      { name: 'Intro', slides: ['256'] },
      { name: 'Draft', slides: [] },
    ]);
  });

  it('keeps a slide that two sections list in the first of them', () => {
    const dir = writeTemplate({
      slides: 3,
      sections: [
        { name: 'Intro', slides: [1, 2] },
        { name: 'Main', slides: [2, 3] },
      ],
    });

    run('clean.py', dir);

    const deck = readUnpacked(dir);
    expect(deck.sections).toEqual([
      { name: 'Intro', slides: ['256', '257'] },
      { name: 'Main', slides: ['258'] },
    ]);
    expectOneRunPerSection(deck);
  });

  it.each([
    ['another prefix', 'q14'],
    ['the default namespace', ''],
  ])(
    'reads a section list written with %s, and never hands out an id it lists',
    (_, sectionPrefix) => {
      const dir = writeTemplate({
        slides: 6,
        sections: STANDARD,
        sectionPrefix,
      });
      const kept = ['256', '257', '258', '259', '260'];
      setDeck(dir, kept);

      const added = addSlide(dir, 'slideLayout1.xml');

      expect(added.id).toBe('262');
      setDeck(dir, [...kept, added.id], new Map([[added.id, added.entry]]));
      run('clean.py', dir);
      expect(readUnpacked(dir).sections).toEqual([
        { name: 'Title slides', slides: ['256'] },
        { name: 'Agenda', slides: ['257'] },
        { name: 'Content slides', slides: ['258', '259'] },
        { name: 'Closing slides', slides: ['260', added.id] },
      ]);
      expect(readFileSync(presentationOf(dir), 'utf8')).toContain(
        sectionPrefix
          ? `<${sectionPrefix}:sectionLst xmlns:${sectionPrefix}="${P14}">`
          : `<sectionLst xmlns="${P14}">`,
      );
    },
  );

  it('gives every slide added before its <p:sldId> goes in an id of its own', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD });

    const first = addSlide(dir, 'slideLayout1.xml');
    const second = addSlide(dir, 'slideLayout1.xml');
    const copy = addSlide(dir, 'slide4.xml');
    const third = addSlide(dir, 'slideLayout1.xml');

    expect([first, second, copy, third].map((added) => added.entry)).toEqual([
      '<p:sldId id="262" r:id="rId262"/>',
      '<p:sldId id="263" r:id="rId263"/>',
      '<p:sldId id="264" r:id="rId264"/>',
      '<p:sldId id="265" r:id="rId265"/>',
    ]);
    setDeck(
      dir,
      [
        '256',
        '257',
        '258',
        '259',
        copy.id,
        first.id,
        second.id,
        '260',
        third.id,
      ],
      new Map([first, second, copy, third].map((a) => [a.id, a.entry])),
    );
    run('clean.py', dir);
    expect(readUnpacked(dir).sections).toEqual([
      { name: 'Title slides', slides: ['256'] },
      { name: 'Agenda', slides: ['257'] },
      {
        name: 'Content slides',
        slides: ['258', '259', copy.id, first.id, second.id],
      },
      { name: 'Closing slides', slides: ['260', third.id] },
    ]);
  });

  it('files a copy of a toolbox slide among the content slides once its entry is moved there, as the guide says', () => {
    const dir = writeTemplate({
      slides: 6,
      sections: [
        { name: 'Title slides', slides: [1] },
        { name: 'Content slides', slides: [2, 3] },
        { name: 'Toolbox', slides: [4, 5] },
        { name: 'Closing slides', slides: [6] },
      ],
    });

    const copy = addSlide(dir, 'slide4.xml');

    expect(copy.id).toBe('262');
    expect(copy.stdout).toContain(
      'Listed it in section "Toolbox" right after slide4.xml\n' +
        'Placing it anywhere else? Move <p14:sldId id="262"/> in presentation.xml into the section of the slides around it\n',
    );
    // Between the two content slides, with the toolbox slides deleted.
    setDeck(
      dir,
      ['256', '257', copy.id, '258', '261'],
      new Map([[copy.id, copy.entry]]),
    );
    moveSectionEntry(dir, copy.id, '257');
    run('clean.py', dir);

    const deck = readUnpacked(dir);
    expect(deck.sections).toEqual([
      { name: 'Title slides', slides: ['256'] },
      { name: 'Content slides', slides: ['257', copy.id, '258'] },
      { name: 'Closing slides', slides: ['261'] },
    ]);
    expectOneRunPerSection(deck);
    expect(run('sections.py', dir)).toContain(
      '  Title slides: slide 1\n  Content slides: slides 2-4\n  Closing slides: slide 5\n',
    );
  });
});

describe('sections.py on a finished .pptx (built without unpack and clean)', () => {
  // What python-pptx saves from a template: compact parts with a standalone
  // declaration, the deleted slides still listed in their sections, and a
  // new slide in none.
  async function writePptx(sectioned: boolean): Promise<string> {
    const dir = writeTemplate({
      slides: 6,
      sections: sectioned ? STANDARD : undefined,
      guides: true,
    });
    setDeck(
      dir,
      ['256', '258', '262'],
      new Map([['262', '<p:sldId id="262" r:id="rId99"/>']]),
    );
    const zip = new JSZip();
    const compact = (xml: string) =>
      xml
        .replace(
          '<?xml version="1.0" encoding="utf-8"?>',
          "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>",
        )
        .replace(/>\s+</g, '><');
    zip.file(
      '[Content_Types].xml',
      compact(readFileSync(path.join(dir, '[Content_Types].xml'), 'utf8')),
    );
    zip.file(
      'ppt/presentation.xml',
      compact(readFileSync(presentationOf(dir), 'utf8')),
    );
    zip.file(
      'ppt/_rels/presentation.xml.rels',
      readFileSync(path.join(dir, 'ppt/_rels/presentation.xml.rels')),
    );
    zip.file(
      'ppt/slides/slide1.xml',
      readFileSync(path.join(dir, 'ppt/slides/slide1.xml')),
    );
    const file = path.join(dir, 'deck.pptx');
    writeFileSync(
      file,
      await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    );
    return file;
  }

  async function entries(file: string): Promise<Map<string, Buffer>> {
    const zip = await JSZip.loadAsync(readFileSync(file));
    const out = new Map<string, Buffer>();
    for (const name of Object.keys(zip.files)) {
      const entry = zip.file(name);
      if (entry) out.set(name, await entry.async('nodebuffer'));
    }
    return out;
  }

  it('rewrites only ppt/presentation.xml, in place, and keeps its declaration', async () => {
    const file = await writePptx(true);
    const before = await entries(file);

    const stdout = run('sections.py', file);

    const after = await entries(file);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [name, bytes] of before) {
      if (name !== 'ppt/presentation.xml')
        expect(after.get(name)).toEqual(bytes);
    }
    const xml = after.get('ppt/presentation.xml')?.toString('utf8') ?? '';
    expect(
      xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'),
    ).toBe(true);
    const deck = readDeck(xml);
    expect(deck.sections).toEqual([
      { name: 'Title slides', slides: ['256'] },
      { name: 'Content slides', slides: ['258', '262'] },
    ]);
    expect(deck.extensions).toEqual([SECTIONS_EXT, GUIDES_EXT]);
    expect(stdout).toContain('Updated the sections');

    const settled = readFileSync(file);
    expect(run('sections.py', file)).toContain('already match');
    expect(readFileSync(file)).toEqual(settled);
  });

  it('leaves a .pptx without sections byte for byte as it was', async () => {
    const file = await writePptx(false);
    const before = readFileSync(file);

    expect(run('sections.py', file)).toContain('has no sections');

    expect(readFileSync(file)).toEqual(before);
  });
});

describe('delete_slide, for a deck built with python-pptx', () => {
  interface Deleted {
    dropped?: string[];
    parts?: Record<string, string>;
    error?: string;
  }

  function deleteSlides(dir: string, ...ids: string[]): Deleted {
    const result = python(
      [standIn, dir, ...ids],
      `${shim}${path.delimiter}${SCRIPTS}`,
    );
    if (result.status !== 0)
      throw new Error(`delete_slide failed: ${result.stderr}`);
    return JSON.parse(result.stdout) as Deleted;
  }

  it('takes a slide out of its section, removes the sections it empties and numbers the slides left', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD, guides: true });

    const deleted = deleteSlides(dir, '257', '261');

    const deck = readUnpacked(dir);
    expect(deck.order).toEqual(['256', '258', '259', '260']);
    expect(deck.sections).toEqual([
      { name: 'Title slides', slides: ['256'] },
      { name: 'Content slides', slides: ['258', '259'] },
      { name: 'Closing slides', slides: ['260'] },
    ]);
    expect(deck.extensions).toEqual([SECTIONS_EXT, GUIDES_EXT]);
    expect(deleted.dropped).toEqual(['rId3', 'rId7']);
    // python-pptx names a new slide's file after the slide count: slide5.xml
    // is free now, and a slide another slide still links to keeps a name
    // outside that numbering.
    expect(deleted.parts).toEqual({
      rId2: '/ppt/slides/slide1.xml',
      rId3: '/ppt/slides/deleted-slide257.xml',
      rId4: '/ppt/slides/slide2.xml',
      rId5: '/ppt/slides/slide3.xml',
      rId6: '/ppt/slides/slide4.xml',
      rId7: '/ppt/slides/deleted-slide261.xml',
    });
  });

  it('leaves the next slide python-pptx adds, which takes the deleted slide’s id, to the section of the slide before it', () => {
    const dir = writeTemplate({ slides: 6, sections: STANDARD });
    deleteSlides(dir, '261');
    // python-pptx's next id: the highest in <p:sldIdLst> plus one.
    setDeck(
      dir,
      ['256', '257', '258', '259', '260', '261'],
      new Map([['261', '<p:sldId id="261" r:id="rId8"/>']]),
    );

    expect(run('sections.py', dir)).toContain('Updated the sections');

    expect(readUnpacked(dir).sections).toEqual([
      { name: 'Title slides', slides: ['256'] },
      { name: 'Agenda', slides: ['257'] },
      { name: 'Content slides', slides: ['258', '259'] },
      { name: 'Closing slides', slides: ['260', '261'] },
    ]);
  });

  it('removes the section list, and an extension list it leaves empty, with the last sectioned slide', () => {
    const sections: TemplateSection[] = [
      { name: 'Title slides', slides: [1] },
      { name: 'Content slides', slides: [2] },
    ];
    const bare = writeTemplate({ slides: 2, sections });
    const guided = writeTemplate({ slides: 2, sections, guides: true });

    deleteSlides(bare, '256', '257');
    deleteSlides(guided, '256', '257');

    const xml = readFileSync(presentationOf(bare), 'utf8');
    expect(readDeck(xml).order).toEqual([]);
    expect(xml).not.toContain('sectionLst');
    expect(xml).not.toContain('extLst');
    expect(readUnpacked(guided).extensions).toEqual([GUIDES_EXT]);
  });

  it('leaves a section that listed no slide as it was, and refuses a slide no longer in the deck', () => {
    const dir = writeTemplate({
      slides: 3,
      sections: [
        { name: 'Intro', slides: [1] },
        { name: 'Draft', slides: [] },
        { name: 'Main', slides: [2, 3] },
      ],
    });

    expect(deleteSlides(dir, '258', '258')).toEqual({
      error: 'the slide is not in this presentation',
    });
    deleteSlides(dir, '258');

    expect(readUnpacked(dir).sections).toEqual([
      { name: 'Intro', slides: ['256'] },
      { name: 'Draft', slides: [] },
      { name: 'Main', slides: ['257'] },
    ]);
  });
});

describe('the scripts as modules of a program', () => {
  function program(pythonPath: string, code: string, ...args: string[]) {
    const result = python(['-c', code, ...args], pythonPath);
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout;
  }

  const FROM = [
    ['the skill folder', 'scripts.', SKILL],
    ['the scripts folder', '', SCRIPTS],
  ] as const;

  it.each(FROM)(
    'brings the sections in step in clean_unused_files, imported from %s',
    (_, pkg, folder) => {
      const dir = writeTemplate({ slides: 6, sections: STANDARD });
      setDeck(dir, ['256', '258', '260']);

      const removed = program(
        `${shim}${path.delimiter}${folder}`,
        `import sys; from pathlib import Path; from ${pkg}clean import clean_unused_files; print(clean_unused_files(Path(sys.argv[1])))`,
        dir,
      );

      expect(removed).toContain('ppt/slides/slide2.xml');
      expect(readUnpacked(dir).sections).toEqual([
        { name: 'Title slides', slides: ['256'] },
        { name: 'Content slides', slides: ['258'] },
        { name: 'Closing slides', slides: ['260'] },
      ]);
    },
  );

  it.each(FROM)(
    'duplicates a slide into its section through add_slide, imported from %s',
    (_, pkg, folder) => {
      const dir = writeTemplate({ slides: 6, sections: STANDARD });

      const stdout = program(
        `${shim}${path.delimiter}${folder}`,
        `import sys; from pathlib import Path; from ${pkg}add_slide import duplicate_slide; duplicate_slide(Path(sys.argv[1]), "slide3.xml")`,
        dir,
      );

      expect(stdout).toContain('<p:sldId id="262" r:id="rId262"/>');
      expect(stdout).toContain(
        'Listed it in section "Content slides" right after slide3.xml',
      );
    },
  );
});
