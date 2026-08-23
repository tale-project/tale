import { afterEach, describe, expect, it, vi } from 'vitest';

const FALLBACK_SUFFIX = 'Tale';

// The metadata i18n lookup is stubbed so the test asserts the suffix-selection
// logic, not the message bundle: `suffix` returns the static fallback, and
// `<key>.title` / `<key>.description` echo the key.
vi.mock('@/lib/i18n/i18n', () => ({
  i18n: {
    t: (key: string) => {
      if (key === 'suffix') return FALLBACK_SUFFIX;
      if (key === 'chat.title') return 'Chat';
      if (key === 'chat.description') return 'Chat with AI to get help.';
      return '';
    },
  },
}));

const getTitleSuffix = vi.fn<() => string | undefined>();
vi.mock('@/app/lib/title-suffix', () => ({
  getTitleSuffix: () => getTitleSuffix(),
}));

const { seo } = await import('./seo');

function titleOf(tags: Array<Record<string, string>>): string | undefined {
  return tags.find((tag) => 'title' in tag)?.title;
}

describe('seo', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses the cached org name as the title suffix once known', () => {
    getTitleSuffix.mockReturnValue('QA Guides Org');

    // oxlint-disable-next-line typescript/no-explicit-any -- narrowing the metadata-page key union is irrelevant to this composition test
    const tags = seo('chat');

    expect(titleOf(tags)).toBe('Chat - QA Guides Org');
    expect(tags).toContainEqual({
      name: 'og:title',
      content: 'Chat - QA Guides Org',
    });
  });

  it('falls back to "Tale" when no org name is cached (logged out)', () => {
    getTitleSuffix.mockReturnValue(undefined);

    // oxlint-disable-next-line typescript/no-explicit-any -- see above
    const tags = seo('chat');

    expect(titleOf(tags)).toBe(`Chat - ${FALLBACK_SUFFIX}`);
  });

  describe('titleOverride (#2647)', () => {
    it('substitutes the loaded entity name for the static metadata title', () => {
      getTitleSuffix.mockReturnValue('QA Guides Org');

      // oxlint-disable-next-line typescript/no-explicit-any -- see above
      const tags = seo('chat', 'Getting started');

      expect(titleOf(tags)).toBe('Getting started - QA Guides Org');
      expect(tags).toContainEqual({
        name: 'og:title',
        content: 'Getting started - QA Guides Org',
      });
    });

    it('falls back to the static metadata title when no override is given', () => {
      getTitleSuffix.mockReturnValue('QA Guides Org');

      // oxlint-disable-next-line typescript/no-explicit-any -- see above
      const tags = seo('chat', undefined);

      expect(titleOf(tags)).toBe('Chat - QA Guides Org');
    });
  });
});
