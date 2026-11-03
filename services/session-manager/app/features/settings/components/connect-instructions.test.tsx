// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://127.0.0.1:8000/settings/ai-access"}
import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const { recordToasts } = await import('@/tests/utils/toast-recorder');
  return recordToasts(
    await importOriginal<typeof import('@tale/ui/use-toast')>(),
  );
});

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { renderApp } from '@/tests/utils/render';
import { failureToasts, raised } from '@/tests/utils/toast-recorder';

import { ConnectInstructions } from './connect-instructions';

const URL = 'http://127.0.0.1:8000/mcp';
const COMMAND = `claude mcp add --transport http session-manager ${URL}`;
const CURSOR = JSON.stringify(
  { mcpServers: { 'session-manager': { url: URL } } },
  null,
  2,
);
const DESKTOP = JSON.stringify(
  {
    mcpServers: {
      'session-manager': {
        command: 'npx',
        args: ['-y', 'mcp-remote', URL, '--allow-http'],
      },
    },
  },
  null,
  2,
);

beforeEach(() => {
  raised.length = 0;
});

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

const clientTab = (name: string) => screen.getByRole('tab', { name });

describe('ConnectInstructions', () => {
  it('derives the address from the origin the page is served from', () => {
    renderApp(<ConnectInstructions />);
    expect(window.location.origin).toBe('http://127.0.0.1:8000');
    expect(
      screen.getByRole('button', {
        name: /Address\s*http:\/\/127\.0\.0\.1:8000\/mcp/,
      }),
    ).toBeInTheDocument();
  });

  it('says what the section is for, and that the address works on this computer only', () => {
    renderApp(<ConnectInstructions />);
    expect(
      screen.getByText(
        'Add Session Manager to your assistant as an MCP server.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'MCP over Streamable HTTP. It works on this computer only.',
      ),
    ).toBeInTheDocument();
  });

  it('copies the address and says so', async () => {
    const { user } = renderApp(<ConnectInstructions />);
    const write = vi.spyOn(navigator.clipboard, 'writeText');

    await user.click(screen.getByRole('button', { name: /Address/ }));

    expect(write).toHaveBeenCalledWith(URL);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('tells the person once when the browser refuses to copy the address', async () => {
    const { user } = renderApp(<ConnectInstructions />);
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
      new Error('denied'),
    );

    await user.click(screen.getByRole('button', { name: /Address/ }));

    await vi.waitFor(() => expect(failureToasts()).toHaveLength(1));
    expect(failureToasts()[0]).toMatchObject({
      title: "Couldn't copy to clipboard",
    });
  });
});

describe('ConnectInstructions: the assistants to choose from', () => {
  it('are a row of tabs, one for each, named as a group, with the first chosen', () => {
    renderApp(<ConnectInstructions />);

    const list = screen.getByRole('tablist', { name: 'Assistant' });
    expect(
      within(list)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Claude Code', 'Cursor and other assistants', 'Claude Desktop']);
    expect(clientTab('Claude Code')).toHaveAttribute('aria-selected', 'true');
    expect(clientTab('Cursor and other assistants')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('show the setup of one at a time, the first with its command', () => {
    renderApp(<ConnectInstructions />);

    const panel = screen.getByRole('tabpanel');
    expect(
      within(panel).getByText(
        'Add Session Manager to Claude Code. Run this in your terminal.',
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByText(COMMAND)).toBeInTheDocument();
    // Nothing of the others, not even hidden.
    expect(screen.queryByText(/mcpServers/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Add this server to the MCP configuration/),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('show the configuration for Cursor and other assistants once chosen, and no longer the command', async () => {
    const { user } = renderApp(<ConnectInstructions />);

    await user.click(clientTab('Cursor and other assistants'));

    const panel = screen.getByRole('tabpanel');
    expect(
      within(panel).getByText(
        'Add this server to the MCP configuration of Cursor, Windsurf and most other assistants.',
      ),
    ).toBeInTheDocument();
    expect(
      JSON.parse(within(panel).getByText(/mcpServers/).textContent ?? ''),
    ).toEqual({ mcpServers: { 'session-manager': { url: URL } } });
    expect(screen.queryByText(COMMAND)).not.toBeInTheDocument();
  });

  it('show the configuration for Claude Desktop, which goes through mcp-remote and says it needs Node.js', async () => {
    const { user } = renderApp(<ConnectInstructions />);

    await user.click(clientTab('Claude Desktop'));

    const panel = screen.getByRole('tabpanel');
    expect(
      within(panel).getByText(
        'Add this to the configuration of Claude Desktop. This setup needs Node.js.',
      ),
    ).toBeInTheDocument();
    expect(
      JSON.parse(within(panel).getByText(/mcp-remote/).textContent ?? ''),
    ).toEqual({
      mcpServers: {
        'session-manager': {
          command: 'npx',
          args: ['-y', 'mcp-remote', URL, '--allow-http'],
        },
      },
    });
  });

  it('are chosen with the arrow keys, as tabs are', async () => {
    const { user } = renderApp(<ConnectInstructions />);

    clientTab('Claude Code').focus();
    await user.keyboard('{ArrowRight}');
    expect(clientTab('Cursor and other assistants')).toHaveFocus();
    expect(clientTab('Cursor and other assistants')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(/mcp-remote/);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(COMMAND);
  });

  it('are reached from the address with Tab: the address, the chosen tab, its panel, then its copy button', async () => {
    const { user } = renderApp(<ConnectInstructions />);

    await user.tab();
    expect(screen.getByRole('button', { name: /^Address/ })).toHaveFocus();
    await user.tab();
    expect(clientTab('Claude Code')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copy command' })).toHaveFocus();
  });
});

describe('ConnectInstructions: copying', () => {
  it('copies the command of Claude Code, and says it is a command', async () => {
    const { user } = renderApp(<ConnectInstructions />);
    const write = vi.spyOn(navigator.clipboard, 'writeText');

    await user.click(screen.getByRole('button', { name: 'Copy command' }));

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(COMMAND);
    expect(await navigator.clipboard.readText()).toBe(COMMAND);
  });

  it.each([
    ['Cursor and other assistants', CURSOR],
    ['Claude Desktop', DESKTOP],
  ])(
    'copies exactly the configuration %s shows, and says it is a configuration',
    async (client, text) => {
      const { user } = renderApp(<ConnectInstructions />);
      const write = vi.spyOn(navigator.clipboard, 'writeText');

      await user.click(clientTab(client));
      expect(
        screen.queryByRole('button', { name: 'Copy command' }),
      ).not.toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Copy configuration' }),
      );

      expect(write).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(text);
      expect(await navigator.clipboard.readText()).toBe(text);
    },
  );

  it('gives every button on the page a name of its own', async () => {
    const { user } = renderApp(<ConnectInstructions />);
    for (const client of [
      'Claude Code',
      'Cursor and other assistants',
      'Claude Desktop',
    ]) {
      await user.click(clientTab(client));
      const names = screen
        .getAllByRole('button')
        .map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        );
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

describe('ConnectInstructions: accessibility', () => {
  it('has no violations, whichever assistant is chosen', async () => {
    const { user, ...view } = renderApp(<ConnectInstructions />);
    await checkAccessibility(view);

    await user.click(clientTab('Cursor and other assistants'));
    await checkAccessibility(view);

    await user.click(clientTab('Claude Desktop'));
    await checkAccessibility(view);
  });
});

describe('ConnectInstructions: in German and French', () => {
  it('words the assistants, the steps and the copy buttons in German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    const { user } = renderApp(<ConnectInstructions />);

    expect(
      await screen.findByRole('tablist', { name: 'Assistent' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Füge Session Manager zu Claude Code hinzu. Führe das in deinem Terminal aus.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Befehl kopieren' }),
    ).toBeInTheDocument();

    await user.click(clientTab('Cursor und andere Assistenten'));
    expect(
      screen.getByRole('button', { name: 'Konfiguration kopieren' }),
    ).toBeInTheDocument();
  });

  it('words the assistants, the steps and the copy buttons in French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    const { user } = renderApp(<ConnectInstructions />);

    expect(
      await screen.findByRole('tablist', { name: 'Assistant' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Copier la commande' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(
        'Ajoute Session Manager à Claude Code. Exécute ceci dans ton terminal.',
      ),
    ).toBeInTheDocument();

    await user.click(clientTab('Cursor et autres assistants'));
    expect(
      screen.getByRole('button', { name: 'Copier la configuration' }),
    ).toBeInTheDocument();
  });
});
