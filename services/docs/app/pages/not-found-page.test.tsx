import { TooltipProvider } from '@tale/ui/tooltip';
import { render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/de/develop/mcp-endpont');
});

const { NotFoundPage } = await import('./not-found-page');

/**
 * A reader who mistypes an address lands on the 404 in their own language,
 * so the suggestions name pages the way the rail does — by their translated
 * title, not by an English rendering of the slug ("Develop / Mcp Endpoint").
 */
describe('NotFoundPage', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('names each suggestion by its title in the reader’s language', () => {
    render(
      <TooltipProvider>
        <NotFoundPage locale="de" />
      </TooltipProvider>,
    );
    const suggestions = screen.getByRole('navigation', {
      name: 'Meintest du',
    });
    expect(
      within(suggestions).getByRole('link', { name: 'MCP-Endpoint' }),
    ).toHaveAttribute('href', '/de/develop/mcp-endpoint');
  });
});
