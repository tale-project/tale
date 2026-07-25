'use client';

import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Check, ChevronDown, Signpost, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Label } from '@/app/components/ui/forms/label';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { AssigneeAvatar } from '@/app/features/tasks/components/assignee-avatar';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  conversationRoutingConfigSchema,
  type ConversationRoutingRule,
} from '@/lib/shared/schemas/governance';

import { createConfigParser } from '../config-parser';
import { mapGovernanceSaveError } from '../governance-save-errors';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { RulesTableEmptyState } from './rules-table-empty-state';

// One sectioned picker carries both target dimensions (like the conversation
// assignee selector): the prefixes route a pick to the team or the person, and
// the sentinels drive the per-dimension clears.
const USER_PREFIX = 'user:';
const TEAM_PREFIX = 'team:';
const PEOPLE_HEADER = '__routing_people__';
const TEAM_HEADER = '__routing_team__';
const REMOVE_USER = '__routing_remove_user__';
const REMOVE_TEAM = '__routing_remove_team__';
const PLACEHOLDER_ROW_COUNT = 2;
// Loose client-side email check — the backend Zod schema (`z.string().email()`)
// is the authority; this only gates the dialog's submit button.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseConfig = createConfigParser(conversationRoutingConfigSchema, () => ({
  rules: [],
}));

function emptyRule(): ConversationRoutingRule {
  return { address: '' };
}

interface Option {
  value: string;
  label: string;
}

interface RuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: ConversationRoutingRule;
  onSave: (rule: ConversationRoutingRule) => void;
  title: string;
  cannotManage: boolean;
  teamOptions: Option[];
  memberOptions: Option[];
}

function RuleDialog({
  open,
  onOpenChange,
  rule: initialRule,
  onSave,
  title,
  cannotManage,
  teamOptions,
  memberOptions,
}: RuleDialogProps) {
  const { t } = useT('governance');
  const [draft, setDraft] = useState(initialRule);

  useEffect(() => {
    if (open) setDraft(initialRule);
  }, [open, initialRule]);

  // People + Teams in one sectioned list — sections render only when non-empty.
  const selectOptions = useMemo<SearchableSelectOption[]>(() => {
    const opts: SearchableSelectOption[] = [];
    if (memberOptions.length > 0) {
      opts.push({
        value: PEOPLE_HEADER,
        label: t('conversationRouting.peopleSection'),
        isSectionHeader: true,
      });
      for (const m of memberOptions) {
        opts.push({ value: `${USER_PREFIX}${m.value}`, label: m.label });
      }
    }
    if (teamOptions.length > 0) {
      opts.push({
        value: TEAM_HEADER,
        label: t('conversationRouting.teamsSection'),
        isSectionHeader: true,
      });
      for (const tm of teamOptions) {
        opts.push({ value: `${TEAM_PREFIX}${tm.value}`, label: tm.label });
      }
    }
    return opts;
  }, [memberOptions, teamOptions, t]);

  const teamName = teamOptions.find((o) => o.value === draft.teamId)?.label;
  const personName = memberOptions.find((o) => o.value === draft.userId)?.label;

  // Pick from either section to set that dimension; the sentinels clear one.
  const handleSelect = useCallback((value: string) => {
    if (value === REMOVE_USER) {
      setDraft((d) => ({ ...d, userId: undefined }));
      return;
    }
    if (value === REMOVE_TEAM) {
      setDraft((d) => ({ ...d, teamId: undefined }));
      return;
    }
    if (value.startsWith(USER_PREFIX)) {
      setDraft((d) => ({ ...d, userId: value.slice(USER_PREFIX.length) }));
      return;
    }
    if (value.startsWith(TEAM_PREFIX)) {
      setDraft((d) => ({ ...d, teamId: value.slice(TEAM_PREFIX.length) }));
    }
  }, []);

  const addressValid = EMAIL_RE.test(draft.address.trim());
  const hasTarget = Boolean(draft.teamId || draft.userId);
  const isValid = addressValid && hasTarget;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid) return;
      onSave({
        address: draft.address.trim(),
        ...(draft.teamId ? { teamId: draft.teamId } : {}),
        ...(draft.userId ? { userId: draft.userId } : {}),
      });
      onOpenChange(false);
    },
    [draft, isValid, onSave, onOpenChange],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      onSubmit={handleSubmit}
      submitText={t('conversationRouting.confirm')}
      isValid={isValid}
    >
      <Stack gap={4}>
        <Input
          label={t('conversationRouting.address')}
          type="email"
          placeholder={t('conversationRouting.addressPlaceholder')}
          value={draft.address}
          onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
          disabled={cannotManage}
          isInvalid={draft.address.trim() !== '' && !addressValid}
          errorMessage={
            draft.address.trim() !== '' && !addressValid
              ? t('conversationRouting.invalidAddress')
              : undefined
          }
        />
        <Stack gap={2}>
          <Label>{t('conversationRouting.routeTo')}</Label>
          <SearchableSelect
            value={null}
            onValueChange={handleSelect}
            options={selectOptions}
            disabled={cannotManage}
            modal
            align="start"
            searchPlaceholder={t('conversationRouting.searchAssignees')}
            emptyText={t('conversationRouting.noAssignees')}
            aria-label={t('conversationRouting.routeTo')}
            trigger={
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-between"
                disabled={cannotManage}
                aria-label={t('conversationRouting.routeTo')}
              >
                {draft.teamId || draft.userId ? (
                  <span className="flex items-center gap-2">
                    {draft.teamId ? (
                      <span className="flex items-center gap-1.5">
                        <Users className="text-muted-foreground size-4 shrink-0" />
                        <span className="max-w-[9rem] truncate text-sm">
                          {teamName ?? draft.teamId}
                        </span>
                      </span>
                    ) : null}
                    {draft.userId ? (
                      <span className="flex items-center gap-1.5">
                        <AssigneeAvatar
                          assigneeType="user"
                          assigneeId={draft.userId}
                          name={personName}
                          size="sm"
                        />
                        <span className="max-w-[9rem] truncate text-sm">
                          {personName ?? draft.userId}
                        </span>
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    {t('conversationRouting.routeToPlaceholder')}
                  </span>
                )}
                <ChevronDown className="text-muted-foreground size-4 shrink-0" />
              </Button>
            }
            optionAction={(opt) => {
              if (opt.value.startsWith(USER_PREFIX)) {
                return draft.userId === opt.value.slice(USER_PREFIX.length) ? (
                  <Check className="text-primary size-4 shrink-0" />
                ) : null;
              }
              if (opt.value.startsWith(TEAM_PREFIX)) {
                return draft.teamId === opt.value.slice(TEAM_PREFIX.length) ? (
                  <Check className="text-primary size-4 shrink-0" />
                ) : null;
              }
              return null;
            }}
            footer={
              draft.userId || draft.teamId ? (
                <div className="flex flex-col">
                  {draft.userId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => handleSelect(REMOVE_USER)}
                    >
                      {t('conversationRouting.removePerson')}
                    </Button>
                  ) : null}
                  {draft.teamId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      onClick={() => handleSelect(REMOVE_TEAM)}
                    >
                      {t('conversationRouting.removeTeam')}
                    </Button>
                  ) : null}
                </div>
              ) : undefined
            }
          />
        </Stack>
      </Stack>
    </FormDialog>
  );
}

interface ConversationRoutingPolicyEditorProps {
  organizationId: string;
}

/**
 * Editor for the `conversation_routing` policy — per-org rules mapping an
 * inbound recipient address to a team and/or a person. The built-in ingest
 * hook (`applyAddressRouting`) reads these to auto-assign new inbound
 * conversations. Mirrors the model-access editor's rules-table + dialog pattern;
 * the whole `rules` array is saved on every add/edit/remove.
 */
export function ConversationRoutingPolicyEditor({
  organizationId,
}: ConversationRoutingPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'conversation_routing',
  );
  const upsertMutation = useUpsertGovernancePolicy();
  const { members } = useMembers(organizationId);
  const { teams } = useOrgTeams();

  const teamOptions = useMemo<Option[]>(
    () => (teams ?? []).map((team) => ({ value: team.id, label: team.name })),
    [teams],
  );
  const memberOptions = useMemo<Option[]>(
    () =>
      (members ?? []).map((m) => ({
        value: m.userId,
        label: m.displayName || m.email || m.userId,
      })),
    [members],
  );

  const savedRules = useMemo(() => parseConfig(policy?.config).rules, [policy]);

  const initializedRef = useRef(false);
  const [rules, setRules] = useState<ConversationRoutingRule[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dialogRule, setDialogRule] = useState(emptyRule());
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  if (!isLoading && !initializedRef.current) {
    initializedRef.current = true;
    setRules(savedRules);
  }

  const cannotManage = ability.cannot('write', 'orgSettings');
  const loading = isLoading || !initializedRef.current;
  const isPending = upsertMutation.isPending;

  const saveRules = useCallback(
    (next: ConversationRoutingRule[], revert: () => void) => {
      setRules(next);
      upsertMutation.mutate(
        {
          organizationId,
          policyType: 'conversation_routing',
          config: { rules: next },
        },
        {
          onSuccess: () =>
            toast({
              title: t('toastSavedTitle'),
              description: t('conversationRouting.saved'),
              variant: 'success',
            }),
          onError: (error) => {
            revert();
            toast({
              title: t('toastSaveFailedTitle'),
              description: mapGovernanceSaveError(
                error,
                t,
                t('conversationRouting.saveFailed'),
              ),
              variant: 'destructive',
            });
          },
        },
      );
    },
    [organizationId, upsertMutation, toast, t],
  );

  const openAddDialog = useCallback(() => {
    setEditingIndex(null);
    setDialogRule(emptyRule());
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setDialogRule(rules[index]);
      setDialogOpen(true);
    },
    [rules],
  );

  const handleDialogSave = useCallback(
    (rule: ConversationRoutingRule) => {
      const prev = rules;
      const next =
        editingIndex === null
          ? [...rules, rule]
          : rules.map((r, i) => (i === editingIndex ? rule : r));
      saveRules(next, () => setRules(prev));
    },
    [editingIndex, rules, saveRules],
  );

  const confirmRemove = useCallback(() => {
    if (deletingIndex === null) return;
    const prev = rules;
    const next = rules.filter((_, i) => i !== deletingIndex);
    setDeletingIndex(null);
    saveRules(next, () => setRules(prev));
  }, [deletingIndex, rules, saveRules]);

  const resolveTargets = useCallback(
    (rule: ConversationRoutingRule): string => {
      const parts: string[] = [];
      if (rule.teamId) {
        parts.push(
          teamOptions.find((o) => o.value === rule.teamId)?.label ??
            rule.teamId,
        );
      }
      if (rule.userId) {
        parts.push(
          memberOptions.find((o) => o.value === rule.userId)?.label ??
            rule.userId,
        );
      }
      return parts.length > 0 ? parts.join(' · ') : '—';
    },
    [teamOptions, memberOptions],
  );

  return (
    <Skeletonize loading={loading} label={t('conversationRouting.title')}>
      <SettingsSection
        id="conversation-routing"
        title={t('conversationRouting.title')}
        description={t('conversationRouting.description')}
        action={
          <Button
            variant="primary"
            onClick={openAddDialog}
            disabled={cannotManage || isPending}
          >
            <Signpost className="mr-1.5 size-4" />
            {t('conversationRouting.addRule')}
          </Button>
        }
      >
        <Card padding="none" className="overflow-hidden">
          <Table aria-label={t('conversationRouting.title')}>
            <TableCaption className="sr-only">
              {t('conversationRouting.title')}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('conversationRouting.address')}</TableHead>
                <TableHead>{t('conversationRouting.assignedTo')}</TableHead>
                <TableHead className="text-right">
                  {t('conversationRouting.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: PLACEHOLDER_ROW_COUNT }, (_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell>
                      <SkeletonBox>
                        <div className="h-3.5 w-40" />
                      </SkeletonBox>
                    </TableCell>
                    <TableCell>
                      <SkeletonBox>
                        <div className="h-3.5 w-28" />
                      </SkeletonBox>
                    </TableCell>
                    <TableCell className="text-right">
                      <HStack gap={1} justify="end">
                        <SkeletonBox>
                          <div className="size-8 rounded-md" />
                        </SkeletonBox>
                      </HStack>
                    </TableCell>
                  </TableRow>
                ))
              ) : rules.length > 0 ? (
                rules.map((rule, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="hover:underline disabled:no-underline"
                        onClick={() => openEditDialog(index)}
                        disabled={cannotManage}
                      >
                        {rule.address}
                      </button>
                    </TableCell>
                    <TableCell>{resolveTargets(rule)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingIndex(index)}
                        disabled={cannotManage}
                        title={t('conversationRouting.deleteRule')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow data-no-hover>
                  <TableCell colSpan={3} className="p-0">
                    <RulesTableEmptyState
                      icon={Signpost}
                      title={t('conversationRouting.noRulesTitle')}
                      description={t('conversationRouting.noRulesDescription')}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>

        {dialogOpen && (
          <RuleDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            rule={dialogRule}
            onSave={handleDialogSave}
            title={
              editingIndex === null
                ? t('conversationRouting.addRule')
                : t('conversationRouting.editRule')
            }
            cannotManage={cannotManage}
            teamOptions={teamOptions}
            memberOptions={memberOptions}
          />
        )}

        <ConfirmDialog
          open={deletingIndex !== null}
          onOpenChange={(open) => {
            if (!open) setDeletingIndex(null);
          }}
          title={t('conversationRouting.removeRuleConfirmTitle')}
          description={t('conversationRouting.removeRuleConfirmDescription')}
          confirmText={t('conversationRouting.removeRuleConfirmAction')}
          variant="destructive"
          onConfirm={confirmRemove}
        />
      </SettingsSection>
    </Skeletonize>
  );
}
