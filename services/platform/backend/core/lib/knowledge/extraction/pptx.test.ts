import { describe, expect, it } from 'vitest';

import { Semaphore } from './helpers';
import {
  extractTextFromPptxBytes,
  iterShapes,
  processSlide,
  type Shape,
  type Slide,
} from './pptx';
import {
  buildPptx,
  buildSlideXml,
  buildTableSlideXml,
} from './pptx.test-helpers';

function textShape(value: string, top = 0): Shape {
  return {
    shapeType: 'text',
    top,
    hasTextFrame: true,
    textParagraphs: [value],
    hasTable: false,
    tableRows: [],
  };
}

function tableShape(rows: string[][], top = 0): Shape {
  return {
    shapeType: 'table',
    top,
    hasTextFrame: false,
    textParagraphs: [],
    hasTable: true,
    tableRows: rows,
  };
}

function groupShape(children: Shape[]): Shape {
  return {
    shapeType: 'group',
    top: 0,
    hasTextFrame: false,
    textParagraphs: [],
    hasTable: false,
    tableRows: [],
    shapes: children,
  };
}

describe('iterShapes', () => {
  it('returns flat shapes as-is', () => {
    const s1 = textShape('a');
    const s2 = textShape('b');
    expect([...iterShapes([s1, s2])]).toEqual([s1, s2]);
  });

  it('recurses into groups', () => {
    const inner = textShape('inner');
    expect([...iterShapes([groupShape([inner])])]).toEqual([inner]);
  });

  it('recurses into nested groups', () => {
    const deepest = textShape('deep');
    expect([...iterShapes([groupShape([groupShape([deepest])])])]).toEqual([
      deepest,
    ]);
  });

  it('handles mixed flat and grouped', () => {
    const flat = textShape('flat');
    const inner = textShape('inner');
    expect([...iterShapes([flat, groupShape([inner])])]).toEqual([flat, inner]);
  });

  it('handles an empty group', () => {
    expect([...iterShapes([groupShape([])])]).toEqual([]);
  });
});

describe('processSlide', () => {
  const sem = new Semaphore(3);

  it('extracts text from inside a group', async () => {
    const slide: Slide = {
      shapes: [groupShape([textShape('Grouped text', 100)])],
      notes: null,
    };
    const [, content] = await processSlide(1, slide, sem, null, false);
    expect(content).toContain('Grouped text');
  });

  it('extracts a table from inside a group', async () => {
    const slide: Slide = {
      shapes: [groupShape([tableShape([['Cell1', 'Cell2']], 200)])],
      notes: null,
    };
    const [, content] = await processSlide(1, slide, sem, null, false);
    expect(content).toContain('[Table]');
    expect(content).toContain('Cell1');
  });
});

describe('extractTextFromPptxBytes', () => {
  it('extracts basic slide text', async () => {
    const [text, visionUsed] = await extractTextFromPptxBytes(
      await buildPptx([buildSlideXml(['Hello World'])]),
    );
    expect(text).toContain('Hello World');
    expect(visionUsed).toBe(false);
  });

  it('extracts multiple slides in order', async () => {
    const [text] = await extractTextFromPptxBytes(
      await buildPptx([
        buildSlideXml(['Slide 1 content']),
        buildSlideXml(['Slide 2 content']),
        buildSlideXml(['Slide 3 content']),
      ]),
    );
    expect(text).toContain('Slide 1 content');
    expect(text).toContain('Slide 2 content');
    expect(text).toContain('Slide 3 content');
    expect(text.indexOf('Slide 1')).toBeLessThan(text.indexOf('Slide 2'));
    expect(text.indexOf('Slide 2')).toBeLessThan(text.indexOf('Slide 3'));
  });

  it('extracts a table', async () => {
    const [text] = await extractTextFromPptxBytes(
      await buildPptx([
        buildTableSlideXml([
          ['A1', 'B1'],
          ['A2', 'B2'],
        ]),
      ]),
    );
    expect(text).toContain('A1');
    expect(text).toContain('[Table]');
  });

  it('throws on an invalid file', async () => {
    await expect(
      extractTextFromPptxBytes(new TextEncoder().encode('not a pptx file')),
    ).rejects.toThrow('Invalid or corrupt file');
  });
});
