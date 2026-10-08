import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCheck,
  Code2,
  Cpu,
  FileText,
  GitBranch,
  Globe2,
  LifeBuoy,
  Mail,
  MessageSquare,
  Network,
  PackageCheck,
  Server,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

type PageIllustrationKind =
  | 'about'
  | 'contact'
  | 'demo'
  | 'pricing'
  | 'hardware'
  | 'changelog';

const ART = {
  about: CompanyArt,
  contact: ContactArt,
  demo: DemoArt,
  pricing: PricingArt,
  hardware: HardwareArt,
  changelog: ReleaseArt,
} as const;

/** Each public page depicts its own subject, rather than borrowing a product demo. */
export function PageIllustration({
  kind,
  className,
}: {
  kind: PageIllustrationKind;
  className?: string;
}) {
  const { t } = useT('pageIllustrations');
  const Art = ART[kind];
  return (
    <Card
      asChild
      padding="none"
      radius="xl"
      className={cn(
        'bg-surface-site-inset/60 w-full min-w-0 overflow-hidden',
        className,
      )}
    >
      <figure
        role="img"
        aria-label={t(`${kind}.label`)}
        data-page-illustration={kind}
      >
        <div aria-hidden="true" className="p-5 sm:p-7">
          <Art />
        </div>
      </figure>
    </Card>
  );
}

function Tile({
  icon: Icon,
  title,
  detail,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  detail?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      padding="md"
      radius="xl"
      className={cn('bg-surface-site-raised min-w-0', className)}
    >
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:gap-3">
        <Icon
          aria-hidden
          className="text-fg-muted mt-0.5 size-4 shrink-0"
          strokeWidth={1.5}
        />
        <div className="min-w-0">
          <p className="text-fg-base text-xs font-medium tracking-tight [overflow-wrap:anywhere] sm:text-sm">
            {title}
          </p>
          {detail ? (
            <p className="text-fg-muted mt-1 text-xs leading-relaxed [overflow-wrap:anywhere]">
              {detail}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </Card>
  );
}

function Connector({ horizontal = false }: { horizontal?: boolean }) {
  const Icon = horizontal ? ArrowRight : ArrowDown;
  return (
    <Icon
      aria-hidden
      className="text-fg-subtle mx-auto my-3 size-4"
      strokeWidth={1.5}
    />
  );
}

function CompanyArt() {
  const { t } = useT('pageIllustrations');
  return (
    <>
      <div className="flex items-center justify-between gap-3 pb-5">
        <span className="text-fg-muted font-mono text-[11px]">Spiez · CH</span>
        <span className="text-demo-mint flex items-center gap-1.5 text-xs">
          <Globe2 className="size-3.5" />
          MIT
        </span>
      </div>
      <Tile
        icon={Users}
        title="Ruler GmbH"
        detail={t('about.team')}
        className="border-demo-mint/30"
      />
      <div className="border-demo-mint/30 mx-auto h-5 w-px border-l" />
      <Tile icon={Code2} title="Tale" detail={t('about.product')}>
        <div className="border-border-base mt-4 flex items-center gap-2 border-t pt-3">
          {[Users, Cpu, FileText].map((Icon, index) => (
            <span
              key={index}
              className="bg-demo-mint-soft text-demo-mint rounded-md p-2"
            >
              <Icon className="size-4" />
            </span>
          ))}
          <span className="text-fg-muted ml-auto text-xs">
            {t('about.shared')}
          </span>
        </div>
      </Tile>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Tile icon={GitBranch} title={t('about.open')} detail="MIT" />
        <Tile
          icon={ShieldCheck}
          title={t('about.services')}
          detail="ISO 27001"
        />
      </div>
    </>
  );
}

function ContactArt() {
  const { t } = useT('pageIllustrations');
  return (
    <>
      <div className="text-fg-muted mb-5 flex items-center gap-2 text-xs">
        <Mail className="text-demo-sky size-4" />
        {t('contact.heading')}
      </div>
      <Tile
        icon={MessageSquare}
        title={t('contact.question')}
        detail={t('contact.context')}
      >
        <div className="mt-4 space-y-2">
          <div className="bg-demo-sky/15 h-1.5 w-4/5 rounded" />
          <div className="bg-demo-sky/10 h-1.5 w-3/5 rounded" />
        </div>
      </Tile>
      <Connector />
      <div className="grid grid-cols-2 gap-3">
        <Tile icon={Server} title={t('contact.deployment')} />
        <Tile icon={LifeBuoy} title={t('contact.support')} />
      </div>
      <Connector />
      <Tile
        icon={Users}
        title={t('contact.team')}
        detail={t('contact.discuss')}
        className="border-demo-sky/30"
      />
    </>
  );
}

function DemoArt() {
  const { t } = useT('pageIllustrations');
  return (
    <>
      <div className="text-fg-muted mb-5 flex items-center justify-between text-xs">
        <span>{t('demo.heading')}</span>
        <span className="font-mono">01 → 03</span>
      </div>
      <Tile
        icon={FileText}
        title={t('demo.brief')}
        detail={t('demo.context')}
      />
      <Connector />
      <div className="border-demo-coral/25 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Tile icon={Users} title={t('demo.team')} />
        <ArrowRight className="text-demo-coral size-4" />
        <Tile icon={Cpu} title={t('demo.agent')} />
      </div>
      <Connector />
      <Tile
        icon={CheckCheck}
        title={t('demo.review')}
        detail={t('demo.result')}
        className="border-demo-coral/30"
      >
        <div className="border-border-base text-fg-muted mt-4 flex items-center gap-2 border-t pt-3 text-xs">
          <FileText className="size-3.5" />
          <span>{t('demo.deliverable')}</span>
          <Check className="text-demo-coral ml-auto size-3.5" />
        </div>
      </Tile>
    </>
  );
}

function PricingArt() {
  const { t } = useT('pageIllustrations');
  return (
    <>
      <Tile
        icon={Code2}
        title={t('pricing.product')}
        detail={t('pricing.features')}
      />
      <div className="border-demo-violet/30 mx-auto h-5 w-px border-l" />
      <div className="grid grid-cols-2 gap-3">
        <Tile
          icon={GitBranch}
          title="Community"
          detail={t('pricing.community')}
          className="border-demo-violet/25"
        />
        <Tile
          icon={LifeBuoy}
          title="Enterprise"
          detail={t('pricing.enterprise')}
          className="border-demo-violet/25"
        />
      </div>
      <div className="text-fg-muted mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px]">
        <Server className="size-3.5" />
        <span>{t('pricing.hosting')}</span>
        <span>·</span>
        <Cpu className="size-3.5" />
        <span>{t('pricing.models')}</span>
      </div>
    </>
  );
}

function HardwareArt() {
  const { t } = useT('pageIllustrations');
  return (
    <>
      <div className="text-fg-muted mb-5 flex items-center justify-between gap-3 text-xs">
        <span>{t('hardware.heading')}</span>
        <Network className="text-demo-sky size-4" />
      </div>
      <div className="grid grid-cols-3 items-end gap-3">
        {(
          [
            { units: 1, key: 'unit1' },
            { units: 2, key: 'unit2' },
            { units: 4, key: 'unit3' },
          ] as const
        ).map(({ units, key }) => (
          <div key={units} className="min-w-0">
            <Card
              padding="sm"
              radius="lg"
              className="bg-surface-site-raised space-y-2"
            >
              {Array.from({ length: units }, (_, slot) => (
                <div
                  key={slot}
                  className="bg-surface-site-deep flex h-7 items-center gap-1.5 rounded px-2"
                >
                  <span className="bg-demo-sky size-1.5 shrink-0 rounded-full" />
                  <span className="bg-fg-subtle/20 h-1 w-full rounded" />
                  <span className="bg-fg-subtle/20 h-3 w-1 shrink-0 rounded-sm" />
                </div>
              ))}
            </Card>
            <p className="text-fg-muted mt-3 text-center text-[11px] leading-snug">
              {t(`hardware.${key}`)}
            </p>
          </div>
        ))}
      </div>
      <Connector />
      <Tile
        icon={Cpu}
        title={t('hardware.inference')}
        detail={t('hardware.location')}
      >
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[3, 5, 4].map((count, index) => (
            <div key={index} className="flex h-8 items-end gap-1">
              {Array.from({ length: count }, (_, bar) => (
                <div
                  key={bar}
                  className="bg-demo-sky/20 flex-1 rounded-sm"
                  style={{ height: `${40 + ((bar + index) % 3) * 25}%` }}
                />
              ))}
            </div>
          ))}
        </div>
      </Tile>
    </>
  );
}

function ReleaseArt() {
  const { t } = useT('pageIllustrations');
  return (
    <>
      <div className="text-fg-muted mb-4 flex items-center gap-2 text-xs">
        <GitBranch className="text-demo-gold size-4" />
        {t('changelog.heading')}
      </div>
      <div className="relative space-y-3 pl-6">
        <div className="border-demo-gold/30 absolute top-4 bottom-4 left-1.5 border-l" />
        {(
          [
            { icon: Code2, key: 'build' },
            { icon: ShieldCheck, key: 'check' },
            { icon: PackageCheck, key: 'release' },
          ] as const
        ).map(({ icon, key }, index) => (
          <div key={key} className="relative">
            <span className="bg-demo-gold border-surface-site-inset absolute top-5 -left-6 size-3 rounded-full border-2" />
            <Tile
              icon={icon}
              title={t(`changelog.${key}`)}
              detail={t(`changelog.${key}Detail`)}
              className={index === 2 ? 'border-demo-gold/30' : undefined}
            />
          </div>
        ))}
      </div>
    </>
  );
}
