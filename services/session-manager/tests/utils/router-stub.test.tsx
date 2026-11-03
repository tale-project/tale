import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createLinkingRouterStub } from './router-stub';

describe('createLinkingRouterStub', () => {
  it('fills the parameters of the path of a link in, so a test reads where the link goes', () => {
    const { Link } = createLinkingRouterStub('/proxies');
    render(
      <Link to="/sessions/$sessionId" params={{ sessionId: '4' }}>
        Shop
      </Link>,
    );
    expect(screen.getByRole('link', { name: 'Shop' })).toHaveAttribute(
      'href',
      '/sessions/4',
    );
  });

  it('leaves a path without parameters as it is', () => {
    const { Link } = createLinkingRouterStub();
    render(<Link to="/secrets">Secrets</Link>);
    expect(screen.getByRole('link', { name: 'Secrets' })).toHaveAttribute(
      'href',
      '/secrets',
    );
  });

  it('says it is at the path it is given', () => {
    const stub = createLinkingRouterStub('/secrets');
    expect(stub.useLocation()).toEqual({ pathname: '/secrets' });
  });

  it('gives a page that keeps its view in the address an address with nothing in it', () => {
    const route = createLinkingRouterStub().getRouteApi();
    expect(route.useSearch()).toEqual({});
    expect(typeof route.useNavigate()).toBe('function');
  });
});
