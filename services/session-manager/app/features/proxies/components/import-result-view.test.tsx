import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import {
  proxy,
  importDuplicate,
  importError,
  importResult,
} from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderApp } from '@/tests/utils/render';

import { ImportResultView } from './import-result-view';

afterEach(resetLanguage);

const REPORT = importResult({
  added: [proxy({ id: 1 }), proxy({ id: 2 }), proxy({ id: 3 })],
  duplicates: [
    importDuplicate({ line: 4, display: 'http://198.51.100.4:8080' }),
    importDuplicate({
      line: 6,
      display: 'socks5://ada@gate.example.com:7000',
      existingId: 9,
    }),
  ],
  errors: [importError({ line: 5 })],
});

describe('ImportResultView', () => {
  it('counts what happened, in a line a screen reader reads out and that holds the focus', () => {
    renderApp(<ImportResultView result={REPORT} onShow={vi.fn()} />);

    const summary = screen.getByRole('status');
    expect(summary).toHaveTextContent('3 proxies added, 2 duplicates, 1 error');
    expect(summary).toHaveFocus();
  });

  it('opens the lines that could not be read and folds the duplicates away', () => {
    renderApp(<ImportResultView result={REPORT} onShow={vi.fn()} />);

    expect(screen.getByText("1 line couldn't be read")).toBeVisible();
    expect(screen.getByText('Line 5')).toBeVisible();
    expect(screen.getByText('1.2.3.4:99999:***:***')).toBeVisible();
    expect(
      screen.getByText('2 duplicates', { selector: 'summary' }),
    ).toBeVisible();
    expect(screen.getByText('Line 4')).not.toBeVisible();
  });

  it('shows a duplicate in the table by the host and port of the proxy it repeats', async () => {
    const onShow = vi.fn();
    const { user } = renderApp(
      <ImportResultView result={REPORT} onShow={onShow} />,
    );

    await user.click(screen.getByText('2 duplicates', { selector: 'summary' }));
    await user.click(
      screen.getByRole('button', {
        name: 'Show in list http://198.51.100.4:8080',
      }),
    );
    await user.click(
      screen.getByRole('button', {
        name: 'Show in list socks5://ada@gate.example.com:7000',
      }),
    );

    expect(onShow).toHaveBeenNthCalledWith(1, '198.51.100.4:8080');
    expect(onShow).toHaveBeenNthCalledWith(2, 'gate.example.com:7000');
  });

  it('lists the duplicates without a way to the table when it is shown away from it', async () => {
    const { user } = renderApp(<ImportResultView result={REPORT} />);

    await user.click(screen.getByText('2 duplicates', { selector: 'summary' }));

    expect(
      screen.getByText('http://198.51.100.4:8080', { selector: 'code' }),
    ).toBeVisible();
    expect(screen.getByText('Line 6')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Show in list/ }),
    ).not.toBeInTheDocument();
  });

  it('leaves out what is not there', () => {
    renderApp(
      <ImportResultView
        result={importResult({ added: [proxy()] })}
        onShow={vi.fn()}
      />,
    );

    // Only what happened is counted: no "0 duplicates, 0 errors" to read past.
    expect(screen.getByRole('status')).toHaveTextContent(/^1 proxy added$/);
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/duplicates?$/, { selector: 'summary' }),
    ).not.toBeInTheDocument();
  });

  it('says so when nothing was added, and still counts what was not', () => {
    renderApp(
      <ImportResultView
        result={importResult({ errors: [importError({ line: 1 })] })}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'No proxies added, 1 error',
    );
    expect(
      renderApp(<ImportResultView result={importResult()} />).container,
    ).toHaveTextContent('No proxies added');
  });

  it('shows an unreadable line by its text only when the server sent one, not for a mask', () => {
    renderApp(
      <ImportResultView
        result={importResult({
          errors: [
            importError({ line: 2, input: '***' }),
            importError({ line: 3, input: 'example.com' }),
          ],
        })}
      />,
    );

    // A screen reader would read three asterisks; the line number already says where.
    expect(screen.queryByText('***')).not.toBeInTheDocument();
    expect(screen.getByText('Line 2')).toBeVisible();
    expect(screen.getByText('Line 3')).toBeVisible();
    expect(screen.getByText('example.com')).toBeVisible();
    // The reason is there for both.
    expect(
      screen.getAllByText(
        'Invalid port 99999. A port is a number from 1 to 65535.',
      ),
    ).toHaveLength(2);
  });

  describe('a long report', () => {
    const errorsOf = (count: number) =>
      Array.from({ length: count }, (_unused, index) =>
        importError({ line: index + 1, input: '***' }),
      );
    const duplicatesOf = (count: number) =>
      Array.from({ length: count }, (_unused, index) =>
        importDuplicate({
          line: index + 1,
          display: `http://198.51.100.${index + 1}:8080`,
          existingId: index + 1,
        }),
      );
    const lines = () => screen.getAllByText(/^Line \d+$/);

    it('lists the first fifty unreadable lines and counts the rest, so the way back stays near', () => {
      renderApp(
        <ImportResultView result={importResult({ errors: errorsOf(300) })} />,
      );

      expect(screen.getByRole('status')).toHaveTextContent(
        'No proxies added, 300 errors',
      );
      expect(lines()).toHaveLength(50);
      expect(screen.getByText('Line 50')).toBeVisible();
      expect(screen.queryByText('Line 51')).not.toBeInTheDocument();
      expect(screen.getByText('…and 250 more')).toBeVisible();
      // The group still says how many there are in all.
      expect(screen.getByText("300 lines couldn't be read")).toBeVisible();
    });

    it('lists the first fifty duplicates and counts the rest', async () => {
      const { user } = renderApp(
        <ImportResultView
          result={importResult({ duplicates: duplicatesOf(120) })}
          onShow={vi.fn()}
        />,
      );
      await user.click(
        screen.getByText('120 duplicates', { selector: 'summary' }),
      );

      expect(lines()).toHaveLength(50);
      expect(
        screen.getAllByRole('button', { name: /^Show in list/ }),
      ).toHaveLength(50);
      expect(screen.getByText('…and 70 more')).toBeVisible();
    });

    it('says nothing of more when everything is listed', () => {
      renderApp(
        <ImportResultView result={importResult({ errors: errorsOf(50) })} />,
      );

      expect(lines()).toHaveLength(50);
      expect(screen.queryByText(/…and \d+ more/)).not.toBeInTheDocument();
    });

    it('counts a single line more in its own words', () => {
      renderApp(
        <ImportResultView result={importResult({ errors: errorsOf(51) })} />,
      );

      expect(lines()).toHaveLength(50);
      expect(screen.getByText('…and 1 more')).toBeVisible();
    });

    it('groups the digits of the rest as the language does', async () => {
      await showLanguage('de');
      renderApp(
        <ImportResultView result={importResult({ errors: errorsOf(1500) })} />,
      );

      expect(screen.getByText('… und 1.450 weitere')).toBeVisible();
    });

    it('has no accessibility violations', async () => {
      const view = renderApp(
        <ImportResultView
          result={importResult({
            errors: errorsOf(300),
            duplicates: duplicatesOf(60),
          })}
          onShow={vi.fn()}
        />,
      );
      await checkAccessibility(view);
    });
  });

  it('speaks French', async () => {
    await showLanguage('fr');
    renderApp(<ImportResultView result={REPORT} onShow={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      '3 proxys ajoutés, 2 doublons, 1 erreur',
    );
    expect(screen.getByText("1 ligne n'a pas pu être lue")).toBeVisible();
    expect(screen.getByText('Ligne 5')).toBeVisible();
    expect(
      screen.getByText(
        'Port 99999 non valide. Un port est un nombre de 1 à 65535.',
      ),
    ).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const { user, ...view } = renderApp(
      <ImportResultView result={REPORT} onShow={vi.fn()} />,
    );
    await user.click(screen.getByText('2 duplicates', { selector: 'summary' }));

    await checkAccessibility(view);
  });
});
