import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { proxyCheck } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderApp } from '@/tests/utils/render';

import { ProxyExit, ProxyPing } from './proxy-exit';

afterEach(resetLanguage);

/** A table cell: where a person meets the value, and where a screen reader names it. */
function inCell(ui: ReactElement) {
  return renderApp(
    <table>
      <tbody>
        <tr>
          <td>{ui}</td>
        </tr>
      </tbody>
    </table>,
  );
}

describe('ProxyExit', () => {
  it('shows the exit IP with its country, as a code and a name', () => {
    renderApp(
      <ProxyExit
        check={proxyCheck({ exitIp: '203.0.113.7', country: 'DE' })}
      />,
    );
    expect(screen.getByText('203.0.113.7')).toBeVisible();
    expect(screen.getByText('DE · Germany')).toBeVisible();
  });

  it('names the country in the language of the person', async () => {
    await showLanguage('de');
    renderApp(<ProxyExit check={proxyCheck({ country: 'DE' })} />);
    expect(screen.getByText('DE · Deutschland')).toBeVisible();
  });

  it('shows the IP alone when the country is not known', () => {
    renderApp(<ProxyExit check={proxyCheck({ country: null })} />);
    expect(screen.getByText('203.0.113.7')).toBeVisible();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it('writes a long country name and an IPv6 exit IP out in full, with no tooltip to hold the rest', async () => {
    await showLanguage('de');
    renderApp(
      <ProxyExit
        check={proxyCheck({
          exitIp: '2001:db8:85a3:0:0:8a2e:370:7334',
          country: 'AE',
        })}
      />,
    );
    expect(screen.getByText('2001:db8:85a3:0:0:8a2e:370:7334')).toBeVisible();
    expect(screen.getByText('AE · Vereinigte Arabische Emirate')).toBeVisible();
    expect(
      screen.queryByTitle('AE · Vereinigte Arabische Emirate'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTitle('2001:db8:85a3:0:0:8a2e:370:7334'),
    ).not.toBeInTheDocument();
  });

  it('shows an unknown IP as a dash a screen reader reads as unknown', () => {
    inCell(
      <ProxyExit
        check={proxyCheck({ exitIp: null, country: null, status: 'unchecked' })}
      />,
    );
    // Heard as the word, never as a dash or punctuation.
    expect(screen.getByRole('cell')).toHaveTextContent('—');
    expect(screen.getByRole('cell', { name: 'Unknown' })).toBeVisible();
  });

  it.each([
    ['de', 'Unbekannt'],
    ['fr', 'Inconnu'],
  ] as const)('says an unknown IP in %s', async (language, word) => {
    await showLanguage(language);
    inCell(
      <ProxyExit
        check={proxyCheck({ exitIp: null, country: null, status: 'unchecked' })}
      />,
    );
    expect(screen.getByRole('cell', { name: word })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(<ProxyExit check={proxyCheck()} />);
    await checkAccessibility(view);
  });
});

describe('ProxyPing', () => {
  it('shows the latency of the last check in milliseconds', () => {
    renderApp(<ProxyPing check={proxyCheck({ latencyMs: 1240 })} />);
    expect(screen.getByText('1,240 ms')).toBeVisible();
  });

  it('groups the digits as the language does', async () => {
    await showLanguage('de');
    renderApp(<ProxyPing check={proxyCheck({ latencyMs: 1240 })} />);
    expect(screen.getByText('1.240 ms')).toBeVisible();
  });

  it('shows no latency as unknown', () => {
    inCell(<ProxyPing check={proxyCheck({ latencyMs: null })} />);
    expect(screen.getByRole('cell', { name: 'Unknown' })).toBeVisible();
  });
});
