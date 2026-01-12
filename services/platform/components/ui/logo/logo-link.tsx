'use client';

import Link from 'next/link';
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
      href={href}
      className="hover:opacity-70 transition-opacity w-fit inline-block"
    >
      <TaleLogoText />
    </Link>
  );
}
