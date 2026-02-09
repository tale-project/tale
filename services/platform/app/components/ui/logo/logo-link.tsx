'use client';

import { Link } from '@tanstack/react-router';

import { TaleLogoText } from './tale-logo-text';

interface LogoLinkProps {
  /** Target URL for the logo link */
  href: string;
}

/**
 * Logo with link and hover effect.
 * Used in headers across auth pages, error pages, and status pages.
 */
export function LogoLink({ href }: LogoLinkProps) {
  return (
    <Link
      to={href}
      className="inline-block w-fit transition-opacity hover:opacity-70"
    >
      <TaleLogoText />
    </Link>
  );
}
