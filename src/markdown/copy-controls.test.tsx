import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Toaster } from '../components/feedback/toaster';
import { toast } from '../hooks/use-toast';
import { initServiceI18n } from '../i18n/init-service';
import { uiMessages } from '../i18n/messages';
import { AnchoredHeading } from './anchored-heading';
import { CodeBlock } from './code-block';

vi.mock('./shiki', () => ({
  highlightCode: async () => null,
  peekHighlightedCode: () => null,
}));

let i18n: ReturnType<typeof initServiceI18n>;

beforeAll(() => {
  i18n = initServiceI18n({
    bundles: { en: {}, de: {}, fr: {} },
    regional: {},
    packages: [uiMessages],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  // The toast store outlives a render: close what a test raised, so the next
  // test cannot pass on a toast it did not raise.
  act(() => toast({ title: '' }).dismiss());
});

const labels = [
  [
    'en',
    'Copy link to this section',
    'Link copied',
    'Copy code',
    'Copied',
    "Couldn't copy to clipboard",
  ],
  [
    'de',
    'Link zu diesem Abschnitt kopieren',
    'Link kopiert',
    'Code kopieren',
    'Kopiert',
    'Kopieren in die Zwischenablage fehlgeschlagen',
  ],
  [
    'de-CH',
    'Link zu diesem Abschnitt kopieren',
    'Link kopiert',
    'Code kopieren',
    'Kopiert',
    'Kopieren in die Zwischenablage fehlgeschlagen',
  ],
  [
    'fr',
    'Copier le lien vers cette section',
    'Lien copié',
    'Copier le code',
    'Copié',
    'Échec de la copie dans le presse-papiers',
  ],
] as const;

describe.each(labels)(
  '%s Markdown copy controls',
  (locale, copyLink, linkCopied, copyCode, codeCopied, copyFailed) => {
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

    // A refused or missing clipboard must not look like a click that did
    // nothing: the reader would paste whatever they had copied before.
    it.each([
      [
        'refuses the write',
        () => ({
          writeText: vi
            .fn()
            .mockRejectedValue(
              new DOMException('Write permission denied.', 'NotAllowedError'),
            ),
        }),
      ],
      ['is missing', () => undefined],
    ])(
      'says so when the clipboard %s for a heading link',
      async (_case, clipboard) => {
        await i18n.changeLanguage(locale);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: clipboard(),
        });
        render(
          <>
            <AnchoredHeading level="h2" className="">
              Policy {'{#policy}'}
            </AnchoredHeading>
            <Toaster />
          </>,
        );
        expect(screen.queryByText(copyFailed)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: copyLink }));
        expect(await screen.findByText(copyFailed)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: linkCopied })).toBeNull();
      },
    );

    it.each([false, true])(
      'says so when the clipboard refuses the code with hideHeader=%s',
      async (hideHeader) => {
        await i18n.changeLanguage(locale);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: vi
              .fn()
              .mockRejectedValue(
                new DOMException('Write permission denied.', 'NotAllowedError'),
              ),
          },
        });
        render(
          <>
            <CodeBlock
              code={'bun install\n'}
              language="bash"
              hideHeader={hideHeader}
            />
            <Toaster />
          </>,
        );
        expect(screen.queryByText(copyFailed)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: copyCode }));
        expect(await screen.findByText(copyFailed)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: copyCode })).toBeEnabled();
      },
    );
  },
);
