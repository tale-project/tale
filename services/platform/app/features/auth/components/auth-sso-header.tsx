'use client';

import { Grid } from '@tale/ui/layout';
import { Link } from '@tanstack/react-router';

import { TaleLogo } from '@/app/components/ui/logo/tale-logo';

import { AuthSsoBackButton } from './auth-sso-back-button';

/** Auth chrome for the SSO org-picker step — back on the left, mark centered. */
export function AuthSsoHeader() {
  return (
    <Grid
      as="header"
      cols={3}
      gap={0}
      className="w-full items-center px-4 pt-[calc(0.75rem+var(--safe-top))] pr-[calc(1rem+var(--safe-right))] pb-4 pl-[calc(1rem+var(--safe-left))] sm:pr-[calc(2rem+var(--safe-right))] sm:pl-[calc(2rem+var(--safe-left))]"
    >
      <div className="justify-self-start">
        <AuthSsoBackButton />
      </div>
      <div className="justify-self-center">
        <Link
          to="/"
          className="inline-flex transition-opacity hover:opacity-70"
        >
          <TaleLogo />
        </Link>
      </div>
      <div aria-hidden="true" />
    </Grid>
  );
}
