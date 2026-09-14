import { DemoShell } from '@tale/marketing-ui/demo-shell';
import { DemoStage } from '@tale/marketing-ui/demo-stage';
import { Badge } from '@tale/ui/badge';
import { DataTable } from '@tale/ui/data-table/data-table';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { Switch } from '@tale/ui/switch';
import { Tabs } from '@tale/ui/tabs';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

interface Member {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'invited';
}

/**
 * The homepage's product window: a settings-shaped screen built from the
 * SHIPPED `@tale/ui` components — `Input`, `Select`, `Switch`, `Tabs`,
 * `DataTable`, `Badge` — inside the marketing `DemoShell`, on a `DemoStage`.
 *
 * `DemoShell` marks its payload `role="img"` + `inert`, so the window reads
 * to assistive technology as one labelled illustration and nothing inside it
 * is focusable. That is the right contract for a front-page picture: the
 * components are real (they read the real tokens, they follow the theme), but
 * the page's interactive examples live on the documentation pages.
 */
export function HomeShowcase() {
  const { t } = useT('home');

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
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      { accessorKey: 'role', header: t('showcaseColumnRole') },
      {
        accessorKey: 'status',
        header: t('showcaseColumnStatus'),
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

  const generalPanel = (
    <div className="flex flex-col gap-4 p-4">
      <Input
        label={t('showcaseNameLabel')}
        defaultValue={t('showcaseNameValue')}
        readOnly
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
    </div>
  );

  const membersPanel = (
    <div className="p-4">
      <DataTable
        columns={columns}
        data={members}
        caption={t('showcaseTableCaption')}
      />
    </div>
  );

  return (
    <DemoStage variant="hero">
      <DemoShell
        label={t('showcaseTitle')}
        title={t('showcaseWindowTitle')}
        activeNav="settings"
        elevation="hero"
      >
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
      </DemoShell>
    </DemoStage>
  );
}
