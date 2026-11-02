import { afterEach, describe, expect, it } from 'vitest';

import { focusMainArea, MAIN_CONTENT_ID } from './main-area';

afterEach(() => {
  document.body.replaceChildren();
});

describe('focusMainArea', () => {
  it('gives the keyboard to the main area, which takes focus by script only', () => {
    document.body.innerHTML = `<button>Elsewhere</button><main id="${MAIN_CONTENT_ID}" tabindex="-1"></main>`;
    document.querySelector('button')?.focus();

    focusMainArea();

    expect(document.getElementById(MAIN_CONTENT_ID)).toHaveFocus();
  });

  it('leaves the keyboard where it is when the page has no main area', () => {
    document.body.innerHTML = '<button>Elsewhere</button>';
    const button = document.querySelector('button');
    button?.focus();

    focusMainArea();

    expect(button).toHaveFocus();
  });

  it('is the area the skip link leads to', () => {
    expect(MAIN_CONTENT_ID).toBe('main-content');
  });
});
