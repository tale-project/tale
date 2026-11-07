import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { LOCALE_STORAGE_KEY } from '../../i18n/detect-locale';
import { pageAsMarkdown } from '../../seo/builders/page-as-markdown';
import { Toaster } from '../feedback/toaster';
import { PageActions } from './page-actions';

const MARKDOWN_URL = 'https://docs.tale.dev/platform/chat/basics.md';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PageActions', () => {
  it('copies the page markdown and confirms in place', async () => {
    // `userEvent.setup()` (inside `render`) installs a clipboard stub, so the
    // copy is read back from it rather than spied on.
    const { user } = render(
      <PageActions markdownUrl={MARKDOWN_URL} markdown="# Chat" />,
    );
    await user.click(screen.getByRole('button', { name: 'Copy page' }));
    expect(await navigator.clipboard.readText()).toBe('# Chat');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Copied' }),
      ).toBeInTheDocument(),
    );
  });

  it('says so when the clipboard refuses the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = render(
      <>
        <PageActions markdownUrl={MARKDOWN_URL} markdown="# Chat" />
        <Toaster />
      </>,
    );
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new DOMException('Write permission denied.', 'NotAllowedError'),
    );
    await user.click(screen.getByRole('button', { name: 'Copy page' }));
    expect(
      await screen.findByText("Couldn't copy to clipboard"),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy page' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('hides Copy page when there is no markdown to copy', () => {
    render(<PageActions markdownUrl={MARKDOWN_URL} markdown={null} />);
    expect(screen.queryByRole('button', { name: 'Copy page' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open in' })).toBeInTheDocument();
  });

  it('prepares normalized source-page links only when Copy page is clicked', async () => {
    const markdown = vi.fn(() =>
      pageAsMarkdown({
        frontmatter: null,
        body: 'See [settings](./settings#scope).\n\n`[sample](/unchanged)`',
        siteUrl: 'https://docs.example.test',
        pageUrl: 'https://docs.example.test/platform/chat/basics',
      }),
    );
    const { user } = render(
      <PageActions markdownUrl={MARKDOWN_URL} markdown={markdown} />,
    );
    expect(markdown).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Copy page' }));
    expect(markdown).toHaveBeenCalledTimes(1);
    expect(await navigator.clipboard.readText()).toBe(
      'See [settings](https://docs.example.test/platform/chat/settings#scope).\n\n`[sample](/unchanged)`\n',
    );
  });

  it('hands the markdown twin to a model from the Open in menu', async () => {
    const { user } = render(
      <PageActions markdownUrl={MARKDOWN_URL} markdown="# Chat" />,
    );
    await user.click(screen.getByRole('button', { name: 'Open in' }));
    const markdown = await screen.findByRole('menuitem', {
      name: 'View as Markdown',
    });
    expect(markdown.closest('a')).toHaveAttribute('href', MARKDOWN_URL);
    const claude = screen.getByRole('menuitem', { name: 'Open in Claude' });
    expect(claude.closest('a')?.getAttribute('href')).toContain(
      encodeURIComponent(MARKDOWN_URL),
    );
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <PageActions markdownUrl={MARKDOWN_URL} markdown="# Chat" />,
    );
    await checkAccessibility(container);
  });
});

describe.each([
  [
    'en-US',
    'Open in',
    ['Open in ChatGPT', 'Open in Claude', 'Open in Cursor'],
    `Read ${MARKDOWN_URL} and answer my questions.`,
    `Use ${MARKDOWN_URL} as documentation context.`,
  ],
  [
    'de-DE',
    'Öffnen in',
    ['In ChatGPT öffnen', 'In Claude öffnen', 'In Cursor öffnen'],
    `Lies ${MARKDOWN_URL} und beantworte meine Fragen.`,
    `Nutze ${MARKDOWN_URL} als Dokumentationskontext.`,
  ],
  [
    'fr-FR',
    'Ouvrir dans',
    ['Ouvrir dans ChatGPT', 'Ouvrir dans Claude', 'Ouvrir dans Cursor'],
    `Lis ${MARKDOWN_URL} et réponds à mes questions.`,
    `Utilise ${MARKDOWN_URL} comme contexte de documentation.`,
  ],
] as const)(
  '%s PageActions hand-off',
  (locale, openIn, [chatGpt, claude, cursor], readPrompt, contextPrompt) => {
    afterEach(() => {
      localStorage.clear();
    });

    it("asks the model in the reader's language", async () => {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      const { user } = render(
        <PageActions markdownUrl={MARKDOWN_URL} markdown="# Chat" />,
      );
      await user.click(await screen.findByRole('button', { name: openIn }));
      const href = async (name: string) =>
        (await screen.findByRole('menuitem', { name }))
          .closest('a')
          ?.getAttribute('href');
      expect(await href(chatGpt)).toBe(
        `https://chatgpt.com/?hints=search&q=${encodeURIComponent(readPrompt)}`,
      );
      expect(await href(claude)).toBe(
        `https://claude.ai/new?q=${encodeURIComponent(readPrompt)}`,
      );
      expect(await href(cursor)).toBe(
        `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(contextPrompt)}`,
      );
    });
  },
);
