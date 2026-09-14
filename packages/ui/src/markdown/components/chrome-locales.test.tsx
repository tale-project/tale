import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { initServiceI18n } from '../../i18n/init-service';
import { uiMessages } from '../../i18n/messages';
import { CodeBlock } from '../code-block';
import { Callout } from './callout';
import { CodeGroup } from './code-group';
import { Mermaid } from './mermaid';

const { renderDiagram } = vi.hoisted(() => ({ renderDiagram: vi.fn() }));
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: renderDiagram },
}));
vi.mock('../shiki', () => ({ highlightCode: async () => null }));

let i18n: ReturnType<typeof initServiceI18n>;
beforeAll(() => {
  i18n = initServiceI18n({
    bundles: { en: {}, de: {}, fr: {} },
    regional: {},
    packages: [uiMessages],
  });
});

const cases = [
  {
    locale: 'en',
    tones: ['Note', 'Tip', 'Info', 'Warning', 'Caution', 'Success'],
    examples: 'Code examples',
    tab: 'Tab 1',
    preparing: 'Preparing diagram…',
    failed: 'Diagram failed to render',
    source: 'Show source',
    zoom: 'Zoom in',
    fullscreen: 'Open fullscreen',
    exit: 'Exit fullscreen',
  },
  {
    locale: 'de',
    tones: ['Hinweis', 'Tipp', 'Info', 'Warnung', 'Vorsicht', 'Erfolg'],
    examples: 'Codebeispiele',
    tab: 'Tab 1',
    preparing: 'Diagramm wird vorbereitet…',
    failed: 'Diagramm konnte nicht dargestellt werden',
    source: 'Quelltext anzeigen',
    zoom: 'Vergrößern',
    fullscreen: 'Vollbild öffnen',
    exit: 'Vollbild beenden',
  },
  {
    locale: 'de-CH',
    tones: ['Hinweis', 'Tipp', 'Info', 'Warnung', 'Vorsicht', 'Erfolg'],
    examples: 'Codebeispiele',
    tab: 'Tab 1',
    preparing: 'Diagramm wird vorbereitet…',
    failed: 'Diagramm konnte nicht dargestellt werden',
    source: 'Quelltext anzeigen',
    zoom: 'Vergrössern',
    fullscreen: 'Vollbild öffnen',
    exit: 'Vollbild beenden',
  },
  {
    locale: 'fr',
    tones: [
      'Remarque',
      'Conseil',
      'Info',
      'Avertissement',
      'Attention',
      'Réussite',
    ],
    examples: 'Exemples de code',
    tab: 'Onglet 1',
    preparing: 'Préparation du diagramme…',
    failed: 'Impossible d’afficher le diagramme',
    source: 'Afficher le code source',
    zoom: 'Agrandir',
    fullscreen: 'Ouvrir en plein écran',
    exit: 'Quitter le plein écran',
  },
] as const;

const tones = ['note', 'tip', 'info', 'warning', 'danger', 'check'] as const;

describe.each(cases)('$locale Markdown chrome', (labels) => {
  it('names each callout and unnamed code tab in the selected locale', async () => {
    await i18n.changeLanguage(labels.locale);
    render(
      <>
        {tones.map((tone) => (
          <Callout key={tone} tone={tone}>
            Content
          </Callout>
        ))}
        <CodeGroup>
          <CodeBlock code="one" />
          <CodeBlock code="two" />
        </CodeGroup>
      </>,
    );
    for (const name of labels.tones)
      expect(screen.getByRole('note', { name })).toBeInTheDocument();
    expect(
      screen.getByRole('tablist', { name: labels.examples }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: labels.tab })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('translates the diagram placeholder', async () => {
    await i18n.changeLanguage(labels.locale);
    render(<Mermaid chart="flowchart LR; A-->B" streaming />);
    expect(screen.getByRole('status')).toHaveTextContent(labels.preparing);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('translates diagram failure recovery while preserving source and diagnostic details', async () => {
    await i18n.changeLanguage(labels.locale);
    renderDiagram.mockRejectedValueOnce(new Error('Parse error on line 1'));
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      render(<Mermaid chart="invalid diagram source" />);
      expect(await screen.findByText(labels.failed)).toBeInTheDocument();
      expect(screen.getByText(labels.source)).toBeInTheDocument();
      expect(screen.getByText('Parse error on line 1')).toBeInTheDocument();
      expect(screen.getByText('invalid diagram source')).toBeInTheDocument();
    } finally {
      warning.mockRestore();
    }
  });

  it('translates zoom and fullscreen actions without changing their behavior', async () => {
    await i18n.changeLanguage(labels.locale);
    renderDiagram.mockResolvedValueOnce({
      svg: '<svg viewBox="0 0 100 100"><text>Example</text></svg>',
    });
    render(<Mermaid chart="flowchart LR; A-->B" />);
    expect(await screen.findByText('Example')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: labels.zoom }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: labels.fullscreen }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: labels.exit }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
