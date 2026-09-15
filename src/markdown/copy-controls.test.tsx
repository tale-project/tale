import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { initServiceI18n } from '../i18n/init-service';
import { uiMessages } from '../i18n/messages';
import { AnchoredHeading } from './anchored-heading';
import { CodeBlock } from './code-block';

vi.mock('./shiki', () => ({ highlightCode: async () => null }));

let i18n: ReturnType<typeof initServiceI18n>;

beforeAll(() => {
  i18n = initServiceI18n({
    bundles: { en: {}, de: {}, fr: {} },
    regional: {},
    packages: [uiMessages],
  });
});

const labels = [
  ['en', 'Copy link to this section', 'Link copied', 'Copy code', 'Copied'],
  [
    'de',
    'Link zu diesem Abschnitt kopieren',
    'Link kopiert',
    'Code kopieren',
    'Kopiert',
  ],
  [
    'de-CH',
    'Link zu diesem Abschnitt kopieren',
    'Link kopiert',
    'Code kopieren',
    'Kopiert',
  ],
  [
    'fr',
    'Copier le lien vers cette section',
    'Lien copié',
    'Copier le code',
    'Copié',
  ],
] as const;

describe.each(labels)(
  '%s Markdown copy controls',
  (locale, copyLink, linkCopied, copyCode, codeCopied) => {
    it('announces the copied heading link in the selected locale and keeps focus', async () => {
      await i18n.changeLanguage(locale);
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      render(
        <AnchoredHeading level="h2" className="">
          Policy {'{#policy}'}
        </AnchoredHeading>,
      );
      const button = screen.getByRole('button', { name: copyLink });
      button.focus();
      fireEvent.click(button);
      expect(
        await screen.findByRole('button', { name: linkCopied }),
      ).toHaveFocus();
      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        `${window.location.origin}${window.location.pathname}#policy`,
      );
      expect(button).toHaveAttribute('aria-live', 'polite');
    });

    it.each([false, true])(
      'translates the code-copy control with hideHeader=%s and copies the source',
      async (hideHeader) => {
        await i18n.changeLanguage(locale);
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText },
        });
        render(
          <CodeBlock
            code={'const value = "<orgSlug>";\n'}
            language="typescript"
            hideHeader={hideHeader}
          />,
        );
        const button = screen.getByRole('button', { name: copyCode });
        fireEvent.click(button);
        expect(
          await screen.findByRole('button', { name: codeCopied }),
        ).toBeDisabled();
        expect(writeText).toHaveBeenCalledExactlyOnceWith(
          'const value = "<orgSlug>";',
        );
        expect(button).toHaveAttribute('aria-live', 'polite');
      },
    );
  },
);
