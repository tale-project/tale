'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { packageBaseName } from '@/convex/agent_tools/files/_shared';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/run-code-policy',
)({
  component: RunCodePolicyRoute,
});

type PolicyMode = 'allowlist' | 'denylist';

interface PolicyDraft {
  defaultMode: PolicyMode;
  pythonAllow: string[];
  pythonDeny: string[];
  nodeAllow: string[];
  nodeDeny: string[];
}

const EMPTY_DRAFT: PolicyDraft = {
  defaultMode: 'denylist',
  pythonAllow: [],
  pythonDeny: [],
  nodeAllow: [],
  nodeDeny: [],
};

// Parse a comma- or newline-separated list of package names into a deduped
// array. Blank lines / empty entries are dropped; matching is case-sensitive
// (pip and npm both treat names case-sensitively on disk).
function parseList(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[\n,]+/)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function listToString(value: string[]): string {
  return value.join('\n');
}

type Bucket = 'python' | 'node';

interface DecisionAllow {
  decision: 'allowed';
  reasonKey: 'reasonAllowlistMatch' | 'reasonDenylistNotMatched';
}

interface DecisionDeny {
  decision: 'denied';
  reasonKey: 'reasonAllowlistMiss' | 'reasonDenylistMatch';
}

type Decision = DecisionAllow | DecisionDeny;

function evaluateSpec(
  spec: string,
  bucket: Bucket,
  draft: PolicyDraft,
): Decision {
  const base = packageBaseName(spec);
  const allow = bucket === 'python' ? draft.pythonAllow : draft.nodeAllow;
  const deny = bucket === 'python' ? draft.pythonDeny : draft.nodeDeny;

  if (draft.defaultMode === 'allowlist') {
    return allow.includes(base)
      ? { decision: 'allowed', reasonKey: 'reasonAllowlistMatch' }
      : { decision: 'denied', reasonKey: 'reasonAllowlistMiss' };
  }
  // denylist mode: blocked iff base is on the deny list.
  return deny.includes(base)
    ? { decision: 'denied', reasonKey: 'reasonDenylistMatch' }
    : { decision: 'allowed', reasonKey: 'reasonDenylistNotMatched' };
}

interface TestRow {
  spec: string;
  bucket: Bucket;
  base: string;
  decision: Decision;
}

function RunCodePolicyRoute() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();
  const cannotManage = ability.cannot('write', 'orgSettings');

  const { data: policy, isLoading } = useConvexQuery(
    api.governance.run_code_policy.getRunCodePolicy,
    { organizationId },
  );
  const upsertMutation = useConvexMutation(
    api.governance.run_code_policy.upsertRunCodePolicy,
  );

  const savedDraft = useMemo<PolicyDraft>(() => {
    if (!policy) return EMPTY_DRAFT;
    return {
      defaultMode: policy.defaultMode,
      pythonAllow: policy.pythonAllow,
      pythonDeny: policy.pythonDeny,
      nodeAllow: policy.nodeAllow,
      nodeDeny: policy.nodeDeny,
    };
  }, [policy]);

  const [defaultMode, setDefaultMode] = useState<PolicyMode>('denylist');
  const [pythonAllowText, setPythonAllowText] = useState('');
  const [pythonDenyText, setPythonDenyText] = useState('');
  const [nodeAllowText, setNodeAllowText] = useState('');
  const [nodeDenyText, setNodeDenyText] = useState('');

  useEffect(() => {
    setDefaultMode(savedDraft.defaultMode);
    setPythonAllowText(listToString(savedDraft.pythonAllow));
    setPythonDenyText(listToString(savedDraft.pythonDeny));
    setNodeAllowText(listToString(savedDraft.nodeAllow));
    setNodeDenyText(listToString(savedDraft.nodeDeny));
  }, [savedDraft]);

  // Live draft fed to the tester widget.
  const liveDraft = useMemo<PolicyDraft>(
    () => ({
      defaultMode,
      pythonAllow: parseList(pythonAllowText),
      pythonDeny: parseList(pythonDenyText),
      nodeAllow: parseList(nodeAllowText),
      nodeDeny: parseList(nodeDenyText),
    }),
    [defaultMode, pythonAllowText, pythonDenyText, nodeAllowText, nodeDenyText],
  );

  const handleSave = useCallback(async () => {
    try {
      await upsertMutation.mutateAsync({
        organizationId,
        defaultMode: liveDraft.defaultMode,
        pythonAllow: liveDraft.pythonAllow,
        pythonDeny: liveDraft.pythonDeny,
        nodeAllow: liveDraft.nodeAllow,
        nodeDeny: liveDraft.nodeDeny,
      });
      toast({
        title: t('toastSavedTitle'),
        description: t('runCodePolicy.saved'),
        variant: 'success',
      });
    } catch (error) {
      console.error('[run_code_policy] save failed', error);
      toast({
        title: t('toastSaveFailedTitle'),
        description: t('runCodePolicy.saveFailed'),
        variant: 'destructive',
      });
    }
  }, [liveDraft, organizationId, upsertMutation, toast, t]);

  // -- Tester widget state -------------------------------------------------
  const [testBucket, setTestBucket] = useState<Bucket>('python');
  const [testInput, setTestInput] = useState('');
  const [testRows, setTestRows] = useState<TestRow[]>([]);

  const handleRunTest = useCallback(() => {
    const specs = parseList(testInput);
    const rows: TestRow[] = specs.map((spec) => ({
      spec,
      bucket: testBucket,
      base: packageBaseName(spec),
      decision: evaluateSpec(spec, testBucket, liveDraft),
    }));
    setTestRows(rows);
  }, [testInput, testBucket, liveDraft]);

  return (
    <SettingsPage>
      <Skeletonize
        loading={isLoading}
        label={t('runCodePolicy.title')}
        className="flex flex-col gap-8"
      >
        <SettingsSection
          title={t('runCodePolicy.modeSectionTitle')}
          description={t('runCodePolicy.modeSectionDescription')}
        >
          <RadioGroup
            value={defaultMode}
            onValueChange={(value) => {
              if (value === 'allowlist' || value === 'denylist') {
                setDefaultMode(value);
              }
            }}
            options={[
              {
                value: 'denylist',
                label: t('runCodePolicy.modeDenylistLabel'),
                description: t('runCodePolicy.modeDenylistDescription'),
                disabled: cannotManage,
              },
              {
                value: 'allowlist',
                label: t('runCodePolicy.modeAllowlistLabel'),
                description: t('runCodePolicy.modeAllowlistDescription'),
                disabled: cannotManage,
              },
            ]}
          />
        </SettingsSection>

        <SettingsSection
          title={t('runCodePolicy.pythonSectionTitle')}
          description={t('runCodePolicy.listsHint')}
        >
          <Stack gap={4} className="max-w-3xl">
            <Textarea
              label={t('runCodePolicy.pythonAllowLabel')}
              description={t('runCodePolicy.pythonAllowDescription')}
              placeholder={t('runCodePolicy.pythonPlaceholder')}
              value={pythonAllowText}
              onChange={(e) => setPythonAllowText(e.target.value)}
              disabled={cannotManage}
              rows={4}
            />
            <Textarea
              label={t('runCodePolicy.pythonDenyLabel')}
              description={t('runCodePolicy.pythonDenyDescription')}
              placeholder={t('runCodePolicy.pythonPlaceholder')}
              value={pythonDenyText}
              onChange={(e) => setPythonDenyText(e.target.value)}
              disabled={cannotManage}
              rows={4}
            />
          </Stack>
        </SettingsSection>

        <SettingsSection
          title={t('runCodePolicy.nodeSectionTitle')}
          description={t('runCodePolicy.listsHint')}
        >
          <Stack gap={4} className="max-w-3xl">
            <Textarea
              label={t('runCodePolicy.nodeAllowLabel')}
              description={t('runCodePolicy.nodeAllowDescription')}
              placeholder={t('runCodePolicy.nodePlaceholder')}
              value={nodeAllowText}
              onChange={(e) => setNodeAllowText(e.target.value)}
              disabled={cannotManage}
              rows={4}
            />
            <Textarea
              label={t('runCodePolicy.nodeDenyLabel')}
              description={t('runCodePolicy.nodeDenyDescription')}
              placeholder={t('runCodePolicy.nodePlaceholder')}
              value={nodeDenyText}
              onChange={(e) => setNodeDenyText(e.target.value)}
              disabled={cannotManage}
              rows={4}
            />
          </Stack>
        </SettingsSection>

        <Button
          onClick={handleSave}
          disabled={cannotManage || upsertMutation.isPending}
          className="self-start"
        >
          {upsertMutation.isPending
            ? t('runCodePolicy.saving')
            : t('runCodePolicy.save')}
        </Button>

        <SettingsSection
          title={t('runCodePolicy.testerTitle')}
          description={t('runCodePolicy.testerDescription')}
        >
          <Stack gap={3} className="max-w-3xl">
            <RadioGroup
              label={t('runCodePolicy.testerBucketLabel')}
              value={testBucket}
              onValueChange={(value) => {
                if (value === 'python' || value === 'node') {
                  setTestBucket(value);
                }
              }}
              columns={2}
              options={[
                { value: 'python', label: t('runCodePolicy.bucketPython') },
                { value: 'node', label: t('runCodePolicy.bucketNode') },
              ]}
            />
            <Input
              label={t('runCodePolicy.testerInputLabel')}
              placeholder={
                testBucket === 'python'
                  ? t('runCodePolicy.testerPlaceholderPython')
                  : t('runCodePolicy.testerPlaceholderNode')
              }
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleRunTest}
              className="self-start"
              disabled={testInput.trim().length === 0}
            >
              {t('runCodePolicy.testerButton')}
            </Button>

            {testRows.length > 0 && (
              <Stack
                role="list"
                as="ul"
                gap={0}
                className="border-border bg-card divide-border divide-y rounded-md border"
              >
                {testRows.map((row, idx) => {
                  const allowed = row.decision.decision === 'allowed';
                  const Icon = allowed ? CheckCircle2 : XCircle;
                  return (
                    <li
                      key={`${row.bucket}-${idx}-${row.spec}`}
                      className="flex items-start gap-3 px-3 py-2 text-sm"
                    >
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          allowed ? 'text-green-600' : 'text-red-600',
                        )}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-foreground font-mono text-xs">
                          {row.spec}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t('runCodePolicy.testerBaseLabel')}:{' '}
                          <span className="font-mono">{row.base}</span>
                        </span>
                        <span
                          className={cn(
                            'text-xs',
                            allowed ? 'text-green-700' : 'text-red-700',
                          )}
                        >
                          {allowed
                            ? t('runCodePolicy.testerAllowed')
                            : t('runCodePolicy.testerDenied')}
                          {' — '}
                          {t(`runCodePolicy.${row.decision.reasonKey}`)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </Stack>
            )}
          </Stack>
        </SettingsSection>
      </Skeletonize>
    </SettingsPage>
  );
}
