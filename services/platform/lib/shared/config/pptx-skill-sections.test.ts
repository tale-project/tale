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
 * minidom, which builds the same tree for these documents.
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

const SCRIPTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../configs/platform/custom/skills/pptx/scripts',
);

const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const SECTIONS_EXT = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';
const GUIDES_EXT = '{EFAFB233-063F-42B5-8137-9DF3F51BA10A}';
const NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

let root = '';
let shim = '';

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
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function run(script: string, ...args: string[]): string {
  const result = spawnSync('python3', [path.join(SCRIPTS, script), ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      PYTHONPATH: shim,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONUTF8: '1',
    },
  });
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
}

const slideId = (n: number) => String(255 + n);

function writeTemplate(template: Template): string {
  const dir = mkdtempSync(path.join(root, 'deck-'));
  const numbers = Array.from({ length: template.slides }, (_, i) => i + 1);
  const write = (name: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  };

  const sectionsExt = template.sections
    ? `
    <p:ext uri="${SECTIONS_EXT}">
      <p14:sectionLst xmlns:p14="${P14}">${template.sections
        .map(
          (section, i) => `
        <p14:section name="${section.name}" id="{${String(i + 1).padStart(8, '0')}-AAAA-4BBB-8CCC-${String(i + 1).padStart(12, '0')}}">
          <p14:sldIdLst>${section.slides
            .map(
              (n) => `
            <p14:sldId id="${slideId(n)}"/>`,
            )
            .join('')}
          </p14:sldIdLst>
        </p14:section>`,
        )
        .join('')}
      </p14:sectionLst>
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
