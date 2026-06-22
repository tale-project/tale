import { describe, expect, it } from 'bun:test';

import {
  ensureLayoutImport,
  planLayout,
  transformSource,
} from './codemod-layout';

describe('planLayout — vertical (Stack)', () => {
  it('omits gap at the default (4) and the stretch align default', () => {
    expect(planLayout('flex flex-col gap-4')).toEqual({
      comp: 'Stack',
      props: {},
      passthrough: [],
    });
  });
  it('emits a non-default gap', () => {
    expect(planLayout('flex flex-col gap-2')).toEqual({
      comp: 'Stack',
      props: { gap: 2 },
      passthrough: [],
    });
  });
  it('emits gap={0} when a flex-col div has no gap (overrides the default 4)', () => {
    expect(planLayout('flex flex-col')).toEqual({
      comp: 'Stack',
      props: { gap: 0 },
      passthrough: [],
    });
  });
  it('emits a non-stretch align', () => {
    expect(planLayout('flex flex-col gap-2 items-center')).toEqual({
      comp: 'Stack',
      props: { gap: 2, align: 'center' },
      passthrough: [],
    });
  });
});

describe('planLayout — horizontal (Row)', () => {
  it('keeps Row default (center) implicit but preserves passthrough', () => {
    expect(planLayout('flex items-center gap-2 px-4 py-3 border-b')).toEqual({
      comp: 'Row',
      props: { gap: 2 },
      passthrough: ['px-4', 'py-3', 'border-b'],
    });
  });
  it('emits align="stretch" when a flex row has no items-* (Row default is center)', () => {
    expect(planLayout('flex gap-2')).toEqual({
      comp: 'Row',
      props: { gap: 2, align: 'stretch' },
      passthrough: [],
    });
  });
  it('emits justify but omits the center align default', () => {
    expect(planLayout('flex items-center justify-between gap-3')).toEqual({
      comp: 'Row',
      props: { gap: 3, justify: 'between' },
      passthrough: [],
    });
  });
  it('emits wrap and the stretch align for a gapless wrapping row', () => {
    expect(planLayout('flex flex-wrap')).toEqual({
      comp: 'Row',
      props: { gap: 0, align: 'stretch', wrap: true },
      passthrough: [],
    });
  });
});

describe('planLayout — skips (left raw)', () => {
  const skips = [
    'inline-flex items-center gap-2', // inline-flex
    'flex flex-col sm:flex-row gap-2', // responsive direction
    'flex gap-[10px]', // arbitrary gap
    'flex gap-7', // off-scale gap
    'flex gap-2 gap-4', // ambiguous gap
    'flex gap-x-2', // directional gap
    'flex flex-col-reverse gap-2', // reverse
    'flex space-y-2', // mixed spacing model
  ];
  for (const cls of skips) {
    it(`skips "${cls}"`, () => {
      expect(planLayout(cls)).toBeNull();
    });
  }
});

describe('planLayout — grid (Grid)', () => {
  it('maps grid-cols + omits the default gap', () => {
    expect(planLayout('grid grid-cols-3 gap-4')).toEqual({
      comp: 'Grid',
      props: { cols: 3 },
      passthrough: [],
    });
  });
  it('maps responsive cols and a non-default gap; omits base cols=1', () => {
    expect(planLayout('grid grid-cols-1 md:grid-cols-2 gap-2')).toEqual({
      comp: 'Grid',
      props: { md: 2, gap: 2 },
      passthrough: [],
    });
  });
  it('passes through align/extra classes (Grid has no align prop)', () => {
    expect(planLayout('grid grid-cols-2 gap-2 items-start rounded-lg')).toEqual(
      {
        comp: 'Grid',
        props: { cols: 2, gap: 2 },
        passthrough: ['items-start', 'rounded-lg'],
      },
    );
  });
  it('skips a bare grid with no explicit base cols (Grid would force grid-cols-1)', () => {
    expect(planLayout('grid gap-2')).toBeNull();
  });
  it('skips arbitrary / unsupported grid columns', () => {
    expect(planLayout('grid grid-cols-[200px,1fr] gap-2')).toBeNull();
    expect(planLayout('grid grid-cols-12 gap-2')).toBeNull();
  });
});

describe('transformSource — non-div layout tags via `as`', () => {
  it('preserves <section> via as="section"', () => {
    const { code, needs } = transformSource(
      '<section className="flex gap-2">x</section>',
    );
    expect([...needs]).toEqual(['Row']);
    expect(code).toBe('<Row as="section" gap={2} align="stretch">x</Row>');
  });
  it('preserves <ul> via as="ul"', () => {
    const { code } = transformSource(
      '<ul className="flex flex-col gap-1"><li>a</li></ul>',
    );
    expect(code).toBe('<Stack as="ul" gap={1}><li>a</li></Stack>');
  });
  it('converts a grid div to Grid', () => {
    const { code, needs } = transformSource(
      '<div className="grid grid-cols-2 gap-4">x</div>',
    );
    expect([...needs]).toEqual(['Grid']);
    expect(code).toBe('<Grid cols={2}>x</Grid>');
  });
});

describe('transformSource', () => {
  it('rewrites a vertical div and reports the needed primitive', () => {
    const { code, changed, needs } = transformSource(
      '<div className="flex flex-col gap-2"><p>x</p></div>',
    );
    expect(changed).toBeGreaterThan(0);
    expect([...needs]).toEqual(['Stack']);
    expect(code).toBe('<Stack gap={2}><p>x</p></Stack>');
  });

  it('preserves other attributes and passthrough classes', () => {
    const { code } = transformSource(
      '<div onClick={fn} className="flex items-center gap-2 px-4" data-x="1">c</div>',
    );
    expect(code).toBe(
      '<Row onClick={fn} gap={2} className="px-4" data-x="1">c</Row>',
    );
  });

  it('leaves dynamic className untouched', () => {
    const src = '<div className={cn("flex flex-col gap-2", x)}>c</div>';
    expect(transformSource(src).changed).toBe(0);
  });

  it('skips a rewrite that would shadow an existing binding (e.g. TanStack Row)', () => {
    const src =
      'import { Row } from \'@tanstack/react-table\';\n<div className="flex gap-2">c</div>';
    const { changed, needs } = transformSource(src);
    expect(changed).toBe(0);
    expect([...needs]).toEqual([]);
  });

  it('still converts Stack when only Row is reserved', () => {
    const src =
      'import { Row } from \'@tanstack/react-table\';\n<div className="flex flex-col gap-2">c</div>';
    const { code, needs } = transformSource(src);
    expect([...needs]).toEqual(['Stack']);
    expect(code).toContain('<Stack gap={2}>');
  });
});

describe('ensureLayoutImport', () => {
  it('merges into an existing @tale/ui/layout import', () => {
    const src = "import { Grid } from '@tale/ui/layout';\nconst x = 1;";
    expect(ensureLayoutImport(src, new Set(['Stack']))).toBe(
      "import { Grid, Stack } from '@tale/ui/layout';\nconst x = 1;",
    );
  });
  it('inserts a new import after the last import', () => {
    const src = "import { Button } from '@tale/ui/button';\nconst x = 1;";
    expect(ensureLayoutImport(src, new Set(['Row', 'Stack']))).toBe(
      "import { Button } from '@tale/ui/button';\nimport { Row, Stack } from '@tale/ui/layout';\nconst x = 1;",
    );
  });
  it('inserts after a multi-line import, never inside it', () => {
    const src = "import {\n  a,\n  b,\n} from './x';\nconst y = 1;";
    expect(ensureLayoutImport(src, new Set(['Row']))).toBe(
      "import {\n  a,\n  b,\n} from './x';\nimport { Row } from '@tale/ui/layout';\nconst y = 1;",
    );
  });
});
