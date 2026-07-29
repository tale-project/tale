import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Window } from 'happy-dom';

import { computeAccessibleName, computeRole, elementLabel } from './accname';

/** Narrow `T | null` (the DOM query return) without the banned non-null assert. */
function need<T>(value: T | null, message: string): T {
  if (value === null) throw new Error(message);
  return value;
}

// Put happy-dom's document on globalThis and read it back through Reflect, which
// yields the lib `Document` type (the no-`as`/no-`any` pattern instrument.test
// uses); restore globals after, so the assignment never leaks to other files.
const saved = new Map<string, unknown>();
function doc(): Document {
  return Reflect.get(globalThis, 'document');
}

beforeAll(() => {
  saved.set('document', Reflect.get(globalThis, 'document'));
  Reflect.set(
    globalThis,
    'document',
    new Window({ url: 'https://x.test/' }).document,
  );
});

afterAll(() => {
  for (const [name, value] of saved) Reflect.set(globalThis, name, value);
});

/** Render markup and return its first element. */
function el(html: string): Element {
  doc().body.innerHTML = html;
  return need(doc().body.firstElementChild, 'no element rendered');
}

describe('computeRole', () => {
  test('an explicit role wins (first token)', () => {
    expect(computeRole(el('<div role="tab button">x</div>'))).toBe('tab');
  });

  test('implicit roles come from the tag', () => {
    expect(computeRole(el('<nav></nav>'))).toBe('navigation');
    expect(computeRole(el('<button>Go</button>'))).toBe('button');
    expect(computeRole(el('<h2>Title</h2>'))).toBe('heading');
    expect(computeRole(el('<footer></footer>'))).toBe('contentinfo');
  });

  test('an anchor is a link only with an href', () => {
    expect(computeRole(el('<a href="/x">x</a>'))).toBe('link');
    expect(computeRole(el('<a>x</a>'))).toBeNull();
  });

  test('an unmapped tag has no role', () => {
    expect(computeRole(el('<span>x</span>'))).toBeNull();
  });

  // Regression (round 8, table-layout-reflow finding): IMPLICIT_ROLE mapped
  // <table> but not its descendants, so cells/rows/groups were labelled by bare
  // text. They now expose their W3C HTML-AAM implicit roles.
  test('table descendants expose implicit roles', () => {
    const table = el(
      '<table>' +
        '<thead><tr><th scope="col">Name</th></tr></thead>' +
        '<tbody><tr><th scope="row">Alpha</th><td>10</td></tr></tbody>' +
        '<tfoot><tr><td>sum</td></tr></tfoot>' +
        '</table>',
    );
    expect(computeRole(table)).toBe('table');
    expect(computeRole(need(table.querySelector('thead'), 'thead'))).toBe(
      'rowgroup',
    );
    expect(computeRole(need(table.querySelector('tbody'), 'tbody'))).toBe(
      'rowgroup',
    );
    expect(computeRole(need(table.querySelector('tfoot'), 'tfoot'))).toBe(
      'rowgroup',
    );
    expect(computeRole(need(table.querySelector('tr'), 'tr'))).toBe('row');
    expect(computeRole(need(table.querySelector('td'), 'td'))).toBe('cell');
    expect(
      computeRole(need(table.querySelector('th[scope=col]'), 'th col')),
    ).toBe('columnheader');
    expect(
      computeRole(need(table.querySelector('th[scope=row]'), 'th row')),
    ).toBe('rowheader');
  });

  test('a <th> with no scope defaults to columnheader', () => {
    const table = el('<table><tr><th>H</th></tr></table>');
    expect(computeRole(need(table.querySelector('th'), 'th'))).toBe(
      'columnheader',
    );
  });

  // An <input>'s implicit role is its type, not a blanket "textbox" — a
  // checkbox/radio/range/etc. was previously mislabelled as a textbox.
  test('input roles follow the type (W3C HTML-AAM)', () => {
    const role = (html: string): string | null => computeRole(el(html));
    expect(role('<input />')).toBe('textbox'); // missing type ⇒ text
    expect(role('<input type="text" />')).toBe('textbox');
    expect(role('<input type="email" />')).toBe('textbox');
    expect(role('<input type="WEIRD" />')).toBe('textbox'); // invalid ⇒ text
    expect(role('<input type="search" />')).toBe('searchbox');
    expect(role('<input type="checkbox" />')).toBe('checkbox');
    expect(role('<input type="radio" />')).toBe('radio');
    expect(role('<input type="range" />')).toBe('slider');
    expect(role('<input type="number" />')).toBe('spinbutton');
    expect(role('<input type="button" />')).toBe('button');
    expect(role('<input type="submit" />')).toBe('button');
    expect(role('<input type="reset" />')).toBe('button');
    expect(role('<input type="image" />')).toBe('button');
  });

  test('a <datalist>-bound input is a combobox', () => {
    expect(computeRole(el('<input type="text" list="opts" />'))).toBe(
      'combobox',
    );
    expect(computeRole(el('<input type="search" list="opts" />'))).toBe(
      'combobox',
    );
  });

  test('role-less input types report no role (not a bogus textbox)', () => {
    for (const type of [
      'color',
      'date',
      'datetime-local',
      'file',
      'hidden',
      'month',
      'password',
      'time',
      'week',
    ]) {
      expect(computeRole(el(`<input type="${type}" />`))).toBeNull();
    }
  });

  test('a multi-row or multiple <select> is a listbox, else a combobox', () => {
    expect(computeRole(el('<select></select>'))).toBe('combobox');
    expect(computeRole(el('<select size="1"></select>'))).toBe('combobox');
    expect(computeRole(el('<select multiple></select>'))).toBe('listbox');
    expect(computeRole(el('<select size="4"></select>'))).toBe('listbox');
  });

  test('an <area> is a link only with an href', () => {
    expect(computeRole(el('<area href="/x" />'))).toBe('link');
    expect(computeRole(el('<area />'))).toBeNull();
  });

  // Form/grouping/structural elements now expose their implicit roles so they
  // label as e.g. `progressbar`/`status`/`separator` rather than a bare path.
  test('form-associated and grouping elements expose implicit roles', () => {
    expect(computeRole(el('<output></output>'))).toBe('status');
    expect(computeRole(el('<progress></progress>'))).toBe('progressbar');
    expect(computeRole(el('<meter></meter>'))).toBe('meter');
    expect(computeRole(el('<details></details>'))).toBe('group');
    expect(computeRole(el('<fieldset></fieldset>'))).toBe('group');
    expect(computeRole(el('<figure></figure>'))).toBe('figure');
    expect(computeRole(el('<hr />'))).toBe('separator');
    expect(computeRole(el('<blockquote></blockquote>'))).toBe('blockquote');
    expect(computeRole(el('<p>x</p>'))).toBe('paragraph');
    expect(computeRole(el('<menu></menu>'))).toBe('list');
    expect(computeRole(el('<search></search>'))).toBe('search');
    expect(computeRole(el('<address></address>'))).toBe('group');
    expect(computeRole(el('<datalist></datalist>'))).toBe('listbox');
    expect(computeRole(el('<optgroup></optgroup>'))).toBe('group');
    expect(computeRole(el('<option>x</option>'))).toBe('option');
  });

  test('phrasing-level elements expose their implicit roles', () => {
    expect(computeRole(el('<code>x</code>'))).toBe('code');
    expect(computeRole(el('<em>x</em>'))).toBe('emphasis');
    expect(computeRole(el('<strong>x</strong>'))).toBe('strong');
    expect(computeRole(el('<del>x</del>'))).toBe('deletion');
    expect(computeRole(el('<ins>x</ins>'))).toBe('insertion');
    expect(computeRole(el('<sub>x</sub>'))).toBe('subscript');
    expect(computeRole(el('<sup>x</sup>'))).toBe('superscript');
  });

  // The spec leaves these role-less/generic; we must NOT invent a role for them.
  test('genuinely role-less elements still map to null', () => {
    expect(computeRole(el('<div>x</div>'))).toBeNull();
    expect(computeRole(el('<label>x</label>'))).toBeNull();
    expect(computeRole(el('<summary>x</summary>'))).toBeNull();
    expect(computeRole(el('<figcaption>x</figcaption>'))).toBeNull();
  });
});

describe('computeAccessibleName', () => {
  test('aria-label takes priority', () => {
    expect(
      computeAccessibleName(el('<button aria-label="Close">x</button>')),
    ).toBe('Close');
  });

  test('aria-labelledby beats aria-label when both are present (W3C 2B before 2C)', () => {
    // The W3C accname algorithm resolves aria-labelledby (step 2B) BEFORE
    // aria-label (step 2C), and every screen reader announces the labelledby
    // text. So an element carrying both must be named from the referenced node,
    // not the inline aria-label.
    const wrap = el(
      '<div><span id="lbl">Submit form</span>' +
        '<button aria-labelledby="lbl" aria-label="Close">x</button></div>',
    );
    const button = need(wrap.querySelector('button'), 'no labelledby target');
    expect(computeAccessibleName(button)).toBe('Submit form');
  });

  test('aria-label is used when aria-labelledby resolves to nothing', () => {
    // A dangling aria-labelledby (the referenced id does not exist) produces no
    // text, so the name must fall through to aria-label — labelledby-first must
    // not swallow the aria-label fallback.
    expect(
      computeAccessibleName(
        el('<button aria-labelledby="missing" aria-label="Close">x</button>'),
      ),
    ).toBe('Close');
  });

  test('aria-labelledby resolves referenced text', () => {
    const button = el(
      '<div><span id="lbl">Add to cart</span>' +
        '<button aria-labelledby="lbl">+</button></div>',
    );
    const target = need(button.querySelector('button'), 'no labelledby target');
    expect(computeAccessibleName(target)).toBe('Add to cart');
  });

  test('aria-labelledby still reads a directly-referenced HIDDEN node (W3C 2A)', () => {
    // A node directly referenced by aria-labelledby is used even when hidden —
    // this is spec-correct and must NOT be "fixed" by the name-from-content
    // hidden-text exclusion.
    const wrap = el(
      '<div><span id="lbl" style="visibility:hidden">Add to cart</span>' +
        '<button aria-labelledby="lbl">+</button></div>',
    );
    const button = need(wrap.querySelector('button'), 'no labelledby target');
    expect(computeAccessibleName(button)).toBe('Add to cart');
  });

  test('aria-labelledby excludes a HIDDEN DESCENDANT of the referenced node (regression)', () => {
    // The referenced node ("Outer") is kept even if hidden, but a display:none
    // descendant reached by recursion must not leak into the name.
    const wrap = el(
      '<div><span id="lbl">Outer<span style="display:none">INNER_HIDDEN</span></span>' +
        '<button aria-labelledby="lbl">+</button></div>',
    );
    const button = need(wrap.querySelector('button'), 'no labelledby target');
    expect(computeAccessibleName(button)).toBe('Outer');
  });

  test('img falls back to alt', () => {
    expect(computeAccessibleName(el('<img alt="Logo" />'))).toBe('Logo');
  });

  // A captioning child names its host — not name-from-content over the whole
  // subtree, which would fold the controls/cells/figure body into the name.
  test('a captioning child names its host (legend/figcaption/caption)', () => {
    expect(
      computeAccessibleName(
        el('<fieldset><legend>Shipping</legend><input /></fieldset>'),
      ),
    ).toBe('Shipping');
    expect(
      computeAccessibleName(
        el(
          '<figure><img alt="" /><figcaption>Fig 1. Sales</figcaption></figure>',
        ),
      ),
    ).toBe('Fig 1. Sales');
    expect(
      computeAccessibleName(
        el('<table><caption>Q3 revenue</caption><tr><td>1</td></tr></table>'),
      ),
    ).toBe('Q3 revenue');
  });

  test('aria-label still beats a captioning child', () => {
    expect(
      computeAccessibleName(
        el(
          '<fieldset aria-label="Billing"><legend>Shipping</legend></fieldset>',
        ),
      ),
    ).toBe('Billing');
  });

  test('a form control uses its associated <label>', () => {
    const wrap = el('<div><label for="q">Search</label><input id="q" /></div>');
    const input = need(wrap.querySelector('input'), 'no input');
    expect(computeAccessibleName(input)).toBe('Search');
  });

  test('a control with no label uses its placeholder', () => {
    expect(
      computeAccessibleName(el('<input placeholder="Email address" />')),
    ).toBe('Email address');
  });

  test('a <label for> pointing elsewhere is ignored; placeholder wins', () => {
    // The label's `for` does not match the control id, so the loop walks past it
    // without returning and the name falls through to the placeholder.
    doc().body.innerHTML =
      '<div><label for="other">Other</label>' +
      '<input id="q" placeholder="Email address" /></div>';
    const input = need(doc().querySelector('input'), 'no input');
    expect(computeAccessibleName(input)).toBe('Email address');
  });

  test('the matching label among several still wins', () => {
    doc().body.innerHTML =
      '<div><label for="nope">Nope</label>' +
      '<label for="q">Search</label><input id="q" /></div>';
    const input = need(doc().querySelector('input'), 'no input');
    expect(computeAccessibleName(input)).toBe('Search');
  });

  test('text content names a button', () => {
    expect(computeAccessibleName(el('<button>  Sign in  </button>'))).toBe(
      'Sign in',
    );
  });

  test('name-from-content excludes a display:none subtree (regression)', () => {
    // The button renders no visible text, so it has no accessible name — the
    // hidden caption must not leak in as `button "Stale hidden label"`.
    expect(
      computeAccessibleName(
        el(
          '<button><span style="display:none">Stale hidden label</span></button>',
        ),
      ),
    ).toBeNull();
  });

  test('name-from-content keeps visible text beside a hidden sibling', () => {
    expect(
      computeAccessibleName(
        el('<button>Buy<span style="display:none"> (old copy)</span></button>'),
      ),
    ).toBe('Buy');
  });

  test('name-from-content excludes visibility:hidden and aria-hidden text', () => {
    expect(
      computeAccessibleName(
        el(
          '<button><span style="visibility:hidden">ghost</span>Shown</button>',
        ),
      ),
    ).toBe('Shown');
    expect(
      computeAccessibleName(
        el('<button><span aria-hidden="true">x</span>Save</button>'),
      ),
    ).toBe('Save');
  });

  test('title is the last resort', () => {
    expect(computeAccessibleName(el('<div title="Tooltip"></div>'))).toBe(
      'Tooltip',
    );
  });

  test('whitespace-only content yields no name', () => {
    expect(computeAccessibleName(el('<div>   </div>'))).toBeNull();
  });

  test('a long name is collapsed and truncated', () => {
    const name = computeAccessibleName(
      el(`<button>${'a'.repeat(200)}</button>`),
    );
    expect(name?.length).toBe(80);
    expect(name?.endsWith('…')).toBe(true);
  });
});

describe('elementLabel', () => {
  test('combines role and name', () => {
    expect(elementLabel('button', 'Add to cart')).toBe('button "Add to cart"');
  });

  test('falls back to role, then quoted name, then null', () => {
    expect(elementLabel('navigation', null)).toBe('navigation');
    expect(elementLabel(null, 'Hi')).toBe('"Hi"');
    expect(elementLabel(null, null)).toBeNull();
  });
});
