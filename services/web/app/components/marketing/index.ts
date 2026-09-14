/**
 * The marketing primitives, bound to this site's route table.
 *
 * `@tale/marketing-ui` renders every internal link through the component
 * `MarketingRouterProvider` injects (see `app/routes/__root.tsx`) and types
 * `to` as a plain string. This binding layer re-exports the primitives and
 * narrows `to` to `LocalizedRoutePath` on the three that take one, so a typo
 * in a marketing path is still a compile error here, not a 404 in production.
 */

import {
  type MarketingCardProps as MarketingCardBaseProps,
  MarketingCard as MarketingCardBase,
} from '@tale/marketing-ui/card';
import {
  type CtaAction as CtaActionBase,
  CtaPair as CtaPairBase,
  type CtaPairProps as CtaPairBaseProps,
} from '@tale/marketing-ui/cta-group';
import {
  MarketingLink as MarketingLinkBase,
  type MarketingLinkProps as MarketingLinkBaseProps,
} from '@tale/marketing-ui/link';
import type { ComponentType } from 'react';

import type { LocalizedRoutePath } from '@/app/components/layout/localized-link';

export { MarketingButton } from '@tale/marketing-ui/button';
export { MarketingExternalLink } from '@tale/marketing-ui/external-link';
export {
  PageSection,
  type PageSectionProps,
} from '@tale/marketing-ui/page-section';
export { MarketingPanel } from '@tale/marketing-ui/panel';
export { Reveal } from '@tale/marketing-ui/reveal';
export { SectionHeading } from '@tale/marketing-ui/section-heading';
export { MarketingStack } from '@tale/marketing-ui/stack';

/** Narrows a package `to` from `string` to the registered marketing paths. */
type WithLocalizedTo<P extends { to?: string }> = Omit<P, 'to'> & {
  to: LocalizedRoutePath;
};

type WithOptionalLocalizedTo<P extends { to?: string }> = Omit<P, 'to'> & {
  to?: LocalizedRoutePath;
};

export type CtaAction = WithOptionalLocalizedTo<CtaActionBase>;

export const MarketingLink: ComponentType<
  WithLocalizedTo<MarketingLinkBaseProps>
> = MarketingLinkBase;

export const MarketingCard: ComponentType<
  WithOptionalLocalizedTo<MarketingCardBaseProps>
> = MarketingCardBase;

export const CtaPair: ComponentType<
  Omit<CtaPairBaseProps, 'primary' | 'secondary'> & {
    primary: CtaAction;
    secondary: CtaAction;
  }
> = CtaPairBase;
