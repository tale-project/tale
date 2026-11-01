import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { ComposerSkillChoice } from '@/app/lib/backend/chat';
import { relativeLuminance } from '@/lib/utils/color';
import { inkContrast, painted } from '@/tests/utils/paint';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import type { ComposerModelOption } from '../types';
import { ComposerSelectionPicker } from './composer-selection-picker';

import '@/app/globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

const PROVIDERS = [
  { providerSlug: 'openrouter', providerLabel: 'OpenRouter' },
  { providerSlug: 'anthropic', providerLabel: 'Anthropic' },
] as const;

const model = (index: number, label: string): ComposerModelOption => ({
  id: `vendor/model-${index}`,
  label,
  ...PROVIDERS[index % 2],
  credential: { authMethod: 'api-key' },
});

const LONG_MODEL_LABEL = 'A model whose display name runs past any panel';
const LONG_SKILL_DESCRIPTION =
  'Reads every attachment of the conversation, compares the figures across them and writes a summary of what changed, sheet by sheet and quarter by quarter.';

/** More rows than the list renders at once: short ones first, long ones
 * further down, so only scrolling brings the long ones into the DOM. */
const MODELS = Array.from({ length: 200 }, (_, index) =>
  model(
    index,
    index < 100 ? `Model ${index + 1}` : `${LONG_MODEL_LABEL} ${index + 1}`,
  ),
);
const SKILLS: ComposerSkillChoice[] = Array.from(
  { length: 150 },
  (_, index) => ({
    slug: `skill-${index + 1}`,
    description:
      index < 75 ? 'Short.' : `${LONG_SKILL_DESCRIPTION} (${index + 1})`,
  }),
);

function renderPicker(
  models: readonly ComposerModelOption[] = MODELS,
  skills: readonly ComposerSkillChoice[] = SKILLS,
) {
  return render(
    <ComposerSelectionPicker
      models={models}
      skills={skills}
      selection={{ modelId: models[0].id, providerSlug: 'openrouter' }}
      onSelectionChange={() => {}}
    />,
  );
}

async function openSection(name: RegExp) {
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Choose model, reasoning effort and skills',
    }),
  );
  await userEvent.click(await screen.findByRole('menuitem', { name }));
}

const row = (key: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-picker-key="${CSS.escape(key)}"]`,
  );

/** The tip a row shows, by the text Radix gives its `role="tooltip"`. */
const tip = () => document.querySelector('[role="tooltip"]')?.textContent;

/** Scrolls the list and waits until the virtualizer has rendered the rows
 * that are now in view. */
async function scrollList(list: HTMLElement, top: number) {
  list.scrollTop = top;
  await expect
    .poll(() => {
      const box = list.getBoundingClientRect();
      return [...list.querySelectorAll('[data-index]')].some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > box.top + 1 && rect.top < box.bottom - 1;
      });
    })
    .toBe(true);
  await new Promise(requestAnimationFrame);
}

describe('the section panels', () => {
  it.each([
    [/^Model/, 'openrouter:vendor/model-0'],
    [/^Skills/, 'skill-1'],
  ])(
    'keep %s at one width while its list scrolls',
    async (section, firstKey) => {
      await page.viewport(1280, 800);
      renderPicker();
      await openSection(section);
      await expect.poll(() => row(firstKey)).not.toBeNull();
      const first = row(firstKey);
      const list = first?.closest<HTMLElement>('[role="group"]');
      const panel = first?.closest<HTMLElement>('[role="menu"]');
      if (!list || !panel) throw new Error('no section panel');
      expect(Number(first?.getAttribute('aria-setsize'))).toBeGreaterThan(100);

      const widths = new Set([panel.offsetWidth]);
      const observer = new ResizeObserver(() => widths.add(panel.offsetWidth));
      observer.observe(panel);
      const end = list.scrollHeight - list.clientHeight;
      for (const share of [0.25, 0.5, 0.75, 1, 0]) {
        await scrollList(list, Math.round(share * end));
        widths.add(panel.offsetWidth);
      }
      observer.disconnect();

      // Long rows were in view, and cut rather than widening the panel.
      expect(list.scrollHeight).toBeGreaterThan(list.clientHeight * 10);
      expect([...widths]).toEqual([320]);
    },
  );
});

describe('a cut row', () => {
  it('shows its model and provider whole on hover and on keyboard focus, and a row that fits shows none', async () => {
    await page.viewport(1280, 800);
    const models = [
      model(0, 'Short'),
      model(2, `${LONG_MODEL_LABEL} 3`),
      model(4, `${LONG_MODEL_LABEL} 5`),
    ];
    renderPicker(models, []);
    await openSection(/^Model/);
    await expect.poll(() => row('openrouter:vendor/model-0')).not.toBeNull();

    await userEvent.hover(row('openrouter:vendor/model-0') as HTMLElement);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(tip()).toBeUndefined();
    await userEvent.hover(row('openrouter:vendor/model-2') as HTMLElement);
    await expect.poll(tip).toBe(`${LONG_MODEL_LABEL} 3 · OpenRouter`);

    row('openrouter:vendor/model-2')?.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect
      .poll(() => document.activeElement)
      .toBe(row('openrouter:vendor/model-4'));
    await expect.poll(tip).toBe(`${LONG_MODEL_LABEL} 5 · OpenRouter`);
  });

  it('shows a clamped skill description whole', async () => {
    await page.viewport(1280, 800);
    renderPicker(MODELS.slice(0, 2), [
      { slug: 'docx', description: 'Short.' },
      { slug: 'xlsx', description: LONG_SKILL_DESCRIPTION },
    ]);
    await openSection(/^Skills/);
    await expect.poll(() => row('xlsx')).not.toBeNull();

    await userEvent.hover(row('docx') as HTMLElement);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(tip()).toBeUndefined();
    await userEvent.hover(row('xlsx') as HTMLElement);
    await expect.poll(tip).toBe(`xlsx · ${LONG_SKILL_DESCRIPTION}`);
  });
});

describe.each(['light', 'dark'] as const)('in %s mode', (theme) => {
  /** The panel's own paint, to prove the theme took. */
  const assertTheme = (panel: Element) => {
    const luminance = relativeLuminance(
      painted(getComputedStyle(panel).backgroundColor),
    );
    if (theme === 'dark') expect(luminance).toBeLessThan(0.1);
    else expect(luminance).toBeGreaterThan(0.8);
  };

  it('reads the provider and the Auto description at AA, at rest and on the focused row', async () => {
    await page.viewport(1280, 800);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    renderPicker(MODELS.slice(0, 4));
    await openSection(/^Model/);
    await expect.poll(() => row('openrouter:vendor/model-0')).not.toBeNull();
    const first = row('openrouter:vendor/model-0') as HTMLButtonElement;
    assertTheme(first.closest('[role="menu"]') as Element);

    const provider = within(first).getByText('OpenRouter');
    const auto = screen.getByText(
      'Let Tale pick the best model for each message — balances quality, speed, and cost.',
    );
    expect(inkContrast(provider)).toBeGreaterThanOrEqual(4.5);
    expect(inkContrast(auto)).toBeGreaterThanOrEqual(4.5);
    first.focus();
    expect(inkContrast(provider)).toBeGreaterThanOrEqual(4.5);
    auto.closest('button')?.focus();
    expect(inkContrast(auto)).toBeGreaterThanOrEqual(4.5);
  });

  it('reads a skill description at AA, at rest and on the focused row', async () => {
    await page.viewport(1280, 800);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    renderPicker(MODELS.slice(0, 2), SKILLS.slice(0, 3));
    await openSection(/^Skills/);
    await expect.poll(() => row('skill-1')).not.toBeNull();
    const first = row('skill-1') as HTMLButtonElement;
    assertTheme(first.closest('[role="menu"]') as Element);

    const description = within(first).getByText('Short.');
    expect(inkContrast(description)).toBeGreaterThanOrEqual(4.5);
    first.focus();
    expect(inkContrast(description)).toBeGreaterThanOrEqual(4.5);
  });
});
