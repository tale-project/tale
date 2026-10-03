import { DemoShell } from '@tale/marketing-ui/demo-shell';
import { DemoStage } from '@tale/marketing-ui/demo-stage';
import { useReducedMotion } from '@tale/marketing-ui/entrance';
import { MARKETING_EASE } from '@tale/marketing-ui/reveal';
import { useDemoTimeline } from '@tale/marketing-ui/use-demo-timeline';
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { DataTable } from '@tale/ui/data-table/data-table';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { Switch } from '@tale/ui/switch';
import { Tabs } from '@tale/ui/tabs';
import type { ColumnDef } from '@tanstack/react-table';
import { motion, useInView } from 'framer-motion';
import { Check, Code2 } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useT } from '@/lib/i18n/client';

interface Member {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'invited';
}

const SHOWCASE_BEATS = [0, 180, 380, 620] as const;
const COMPONENT_NAMES = [
  'Input',
  'Select',
  'Switch',
  'Tabs',
  'DataTable',
  'Badge',
] as const;

/**
 * A single assembly sequence reveals the shipped controls without moving the
 * surrounding page. The shared timeline owns reduced motion, SSR and revisit
 * behavior. DemoShell keeps every control inert and the illustration labelled.
 */
export function HomeShowcase() {
  const { t } = useT('home');
  const stageRef = useRef<HTMLDivElement>(null);
  const inView = useInView(stageRef, { once: true, amount: 0.25 });
  const reducedMotion = useReducedMotion();
  const beat = useDemoTimeline({ beats: SHOWCASE_BEATS, start: inView });
  const transition = {
    duration: reducedMotion ? 0 : 0.5,
    ease: MARKETING_EASE,
  };

  const members = useMemo<Member[]>(
    () => [
      {
        id: '1',
        name: 'Ada Okafor',
        role: t('showcaseRoleAdmin'),
        status: 'active',
      },
      {
        id: '2',
        name: 'Jonas Meier',
        role: t('showcaseRoleEditor'),
        status: 'active',
      },
      {
        id: '3',
        name: 'Lena Fischer',
        role: t('showcaseRoleMember'),
        status: 'invited',
      },
    ],
    [t],
  );

  const columns = useMemo<ColumnDef<Member>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('showcaseColumnName'),
        meta: { flex: true },
        size: 150,
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: 'role',
        header: t('showcaseColumnRole'),
        size: 80,
      },
      {
        accessorKey: 'status',
        header: t('showcaseColumnStatus'),
        size: 100,
        cell: ({ row }) => (
          <Badge
            dot
            variant={row.original.status === 'active' ? 'green' : 'slate'}
          >
            {row.original.status === 'active'
              ? t('showcaseStatusActive')
              : t('showcaseStatusInvited')}
          </Badge>
        ),
      },
    ],
    [t],
  );

  const membersPanel = (
    <DataTable
      columns={columns}
      data={members}
      caption={t('showcaseTableCaption')}
    />
  );

  const generalPanel = (
    <div className="grid gap-6 py-5 sm:py-7 lg:grid-cols-[0.9fr_1.1fr] lg:gap-10">
      <motion.div
        initial={false}
        animate={{ opacity: beat >= 1 ? 1 : 0 }}
        transition={transition}
        className="flex min-w-0 flex-col gap-5"
      >
        <Input
          label={t('showcaseNameLabel')}
          defaultValue={t('showcaseNameValue')}
          variant="default"
          readOnly
          wideControl
        />
        <Select
          label={t('showcaseRegionLabel')}
          value="ch"
          options={[
            { value: 'ch', label: t('showcaseRegionSwitzerland') },
            { value: 'de', label: t('showcaseRegionGermany') },
            { value: 'ie', label: t('showcaseRegionIreland') },
          ]}
        />
        <Switch
          checked
          label={t('showcaseDigestLabel')}
          description={t('showcaseDigestDescription')}
        />
      </motion.div>
      <motion.div
        initial={false}
        animate={{ opacity: beat >= 2 ? 1 : 0 }}
        transition={transition}
        className="hidden min-w-0 lg:block"
      >
        <Card
          padding="none"
          radius="xl"
          className="bg-surface-site-raised overflow-hidden"
        >
          <div className="border-border-base flex items-center justify-between gap-4 border-b px-4 py-3">
            <span className="text-sm font-medium">
              {t('showcaseTabMembers')}
            </span>
            <span className="text-fg-subtle font-mono text-xs">
              {String(members.length).padStart(2, '0')}
            </span>
          </div>
          {membersPanel}
        </Card>
      </motion.div>
    </div>
  );

  return (
    <div ref={stageRef}>
      <DemoStage variant="hero" className="py-8 sm:py-12 md:py-16">
        <DemoShell
          label={t('showcaseTitle')}
          title={t('showcaseWindowTitle')}
          activeNav="settings"
          elevation="hero"
        >
          <div className="px-3 pt-5 sm:px-6 sm:pt-6 lg:px-9 lg:pt-8">
            <Tabs
              variant="underline"
              defaultValue="general"
              listAriaLabel={t('showcaseFormLegend')}
              items={[
                {
                  value: 'general',
                  label: t('showcaseTabGeneral'),
                  content: generalPanel,
                },
                {
                  value: 'members',
                  label: t('showcaseTabMembers'),
                  content: membersPanel,
                },
              ]}
            />
          </div>
          <motion.div
            initial={false}
            animate={{ opacity: beat >= 3 ? 1 : 0 }}
            transition={transition}
            className="border-border-base bg-surface-site-inset/60 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3 border-t px-3 py-4 sm:px-6 lg:px-9"
          >
            <span className="text-fg-muted flex items-center gap-2 font-mono text-[11px]">
              <Code2 aria-hidden className="size-3.5" />
              @tale/ui
            </span>
            <span className="hidden flex-1 sm:block" />
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {COMPONENT_NAMES.map((name) => (
                <span
                  key={name}
                  className="text-fg-muted flex items-center gap-1 font-mono text-[10px]"
                >
                  <Check
                    aria-hidden
                    className="text-brand-base size-3"
                    strokeWidth={1.75}
                  />
                  {name}
                </span>
              ))}
            </div>
          </motion.div>
        </DemoShell>
      </DemoStage>
    </div>
  );
}
