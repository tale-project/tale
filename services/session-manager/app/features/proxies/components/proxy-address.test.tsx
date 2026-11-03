import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { proxy } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

import { ProxyAddress } from './proxy-address';

describe('ProxyAddress', () => {
  it('shows scheme, host and port, whole: nothing is left to a tooltip', () => {
    renderApp(<ProxyAddress proxy={proxy({ scheme: 'socks5' })} />);
    expect(screen.getByText('socks5://')).toBeVisible();
    expect(screen.getByText('198.51.100.4:8080')).toBeVisible();
    // A touch screen and a keyboard have no hover: the address is the text.
    expect(
      screen.queryByTitle('socks5://198.51.100.4:8080'),
    ).not.toBeInTheDocument();
  });

  it('writes a long host name out in full, the port with it', () => {
    const host = 'proxy-eu-frankfurt-01.residential.example-provider.com';
    renderApp(<ProxyAddress proxy={proxy({ host, port: 8443 })} />);
    expect(screen.getByText(`${host}:8443`)).toBeVisible();
  });

  it('shows the user name, and never a password', () => {
    renderApp(
      <ProxyAddress proxy={proxy({ username: 'ada', hasPassword: true })} />,
    );
    expect(screen.getByText('http://ada@')).toBeVisible();
    expect(document.body.textContent).not.toMatch(/secret|pass/i);
  });

  it('writes an IPv6 host in brackets', () => {
    renderApp(
      <ProxyAddress proxy={proxy({ host: '2001:db8::1', port: 3128 })} />,
    );
    expect(screen.getByText('[2001:db8::1]:3128')).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(<ProxyAddress proxy={proxy()} />);
    await checkAccessibility(view);
  });
});
