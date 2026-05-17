'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { Link } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Switch } from '@/app/components/ui/forms/switch';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Text } from '@/app/components/ui/typography/text';
import { primeAudio } from '@/app/features/chat/utils/prime-audio';
import { useUpsertGovernancePolicy } from '@/app/features/settings/governance/hooks/mutations';
import { useGovernancePolicy } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import { DEFAULT_DOCS_URL } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-guards';

import {
  useApprovePendingMemory,
  useDismissPendingMemory,
  useSetPersonalizationEnabled,
  useSoftDeleteMemory,
  useUpsertMyPreferences,
} from '../hooks/mutations';

const CUSTOM_INSTRUCTIONS_MAX_CHARS = 4000;

/**
 * Module-level capability-probe cache keyed by `organizationId`.
 *
 * `getCapability` is a Node `action` rate-limited at 12/min/user. The
 * settings page re-mounts on every navigation (route change, StrictMode
 * double-invoke) and the probe burns a token each time — a few quick
 * tab swaps and the limiter trips, the catch branch silently flips the
 * UI to "provider unavailable", and the user sees a false negative.
 *
 * Caching the in-flight promise per org collapses repeated mounts to
 * one network call. Result is also cached so a remount within the
 * same session reuses the resolved value without re-issuing the
 * action. Cache is in-memory only — page reload re-probes, which is
 * correct (admin may have wired up a provider in another tab).
 *
 * Phase 5 (deferred) converts `getCapability` to a Convex `query` so
 * this cache becomes unnecessary.
 */
type CapabilityProbe = (args: {
  organizationId: string;
}) => Promise<{ available: boolean }>;

const capabilityProbeCache = new Map<string, Promise<{ available: boolean }>>();

function isTransientProbeError(err: unknown): boolean {
  if (!(err instanceof ConvexError)) return false;
  const data: unknown = err.data;
  if (typeof data !== 'object' || data === null) return false;
  // `data` is `object`, which is narrower than `Record<string, unknown>`
  // for indexed access but TypeScript still permits the read. Bracket
  // access here would also satisfy the safety check; we use it to avoid
  // an assertion entirely.
  const code = (data as { code?: unknown }).code;
  return code === 'RATE_LIMITED' || code === 'CONTENTION';
}

function probeCapability(
  fn: CapabilityProbe,
  organizationId: string,
): Promise<{ available: boolean }> {
  const cached = capabilityProbeCache.get(organizationId);
  if (cached) return cached;
  const inflight = fn({ organizationId }).catch((err) => {
    // On failure, drop the entry so a subsequent mount can retry
    // rather than being stuck with a rejected promise forever.
    capabilityProbeCache.delete(organizationId);
    throw err;
  });
  capabilityProbeCache.set(organizationId, inflight);
  return inflight;
}

export function PersonalizationSettings() {
  const organizationId = useOrganizationId();
  if (!organizationId) {
    return null;
  }
  return <PersonalizationSettingsInner organizationId={organizationId} />;
}

function PersonalizationSettingsInner({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('personalization');

  const prefs = useQuery(api.user_preferences.queries.getMyPreferences, {
    organizationId,
  });
  const approvedMemories = useQuery(api.user_memories.queries.listMyMemories, {
    organizationId,
  });
  const pendingMemories = useQuery(
    api.user_memories.queries.listPendingMemories,
    {
      organizationId,
    },
  );

  return (
    <Stack>
      <header>
        <h2 className="text-2xl font-semibold">{t('page.title')}</h2>
        <Text variant="muted" className="mt-1">
          {t('page.description')}
        </Text>
        <a
          href={`${DEFAULT_DOCS_URL}/legal/personalization`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-sm underline"
        >
          {t('page.privacyLink')}
        </a>
      </header>

      <OrgDefaultSection organizationId={organizationId} />
      <EnableSection prefs={prefs ?? null} organizationId={organizationId} />
      <CustomInstructionsSection
        prefs={prefs ?? null}
        organizationId={organizationId}
      />
      <VoiceOutputSection prefs={prefs} organizationId={organizationId} />
      <SavedMemoriesSection memories={approvedMemories ?? []} />
      <PendingMemoriesSection memories={pendingMemories ?? []} />
    </Stack>
  );
}

function readPolicyEnabled(config: unknown): boolean {
  return isRecord(config) && config['enabled'] === true;
}

function OrgDefaultSection({ organizationId }: { organizationId: string }) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const ability = useAbility();
  const { data: policy } = useGovernancePolicy(
    organizationId,
    'personalization',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  if (ability.cannot('write', 'orgSettings')) return null;

  const enabled = readPolicyEnabled(policy?.config);

  return (
    <PageSection title={t('page.orgDefault.label')} titleSize="base">
      <Switch
        checked={enabled}
        description={t('page.orgDefault.description')}
        onCheckedChange={async (next) => {
          try {
            await upsertMutation.mutateAsync({
              organizationId,
              policyType: 'personalization',
              config: { enabled: next },
            });
            toast({ title: t('page.orgDefault.toastUpdated') });
          } catch (err) {
            toast({
              title: errorMessage(err, t('errors.saveFailed')),
              variant: 'destructive',
            });
          }
        }}
      />
    </PageSection>
  );
}

function EnableSection({
  prefs,
  organizationId,
}: {
  prefs: Doc<'userPreferences'> | null;
  organizationId: string;
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: setEnabled } = useSetPersonalizationEnabled();
  const orgDefault = useQuery(api.personalization.queries.getOrgDefault, {
    organizationId,
  });
  const orgDefaultOn = orgDefault === true;

  const userExplicit = prefs?.enabled;
  const isFollowingDefault = userExplicit === undefined;
  const effective = isFollowingDefault ? orgDefaultOn : userExplicit;

  const orgStateLabel = orgDefaultOn
    ? t('page.enable.orgStateOn')
    : t('page.enable.orgStateOff');
  const hint = isFollowingDefault
    ? t('page.enable.followingOrgDefault', { state: orgStateLabel })
    : t('page.enable.overridingOrgDefault', { state: orgStateLabel });

  return (
    <PageSection title={t('page.enable.label')} titleSize="base">
      <Switch
        checked={effective}
        description={t('page.enable.description')}
        onCheckedChange={async (next) => {
          try {
            await setEnabled({ organizationId, enabled: next });
            toast({ title: t('toasts.preferencesUpdated') });
          } catch (err) {
            toast({
              title: errorMessage(err, t('errors.saveFailed')),
              variant: 'destructive',
            });
          }
        }}
      />
      {orgDefault !== undefined && (
        <Text variant="muted" className="mt-2 text-xs">
          {hint}
        </Text>
      )}
    </PageSection>
  );
}

function CustomInstructionsSection({
  prefs,
  organizationId,
}: {
  prefs: Doc<'userPreferences'> | null;
  organizationId: string;
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: upsert } = useUpsertMyPreferences();
  const persisted = prefs?.customInstructions ?? '';
  const [value, setValue] = useState(persisted);

  // Resync when the underlying preferences row arrives or changes from
  // another tab; users editing locally still keep their unsaved input
  // because the comparison is against the persisted snapshot, not on
  // every keystroke.
  useEffect(() => {
    setValue(persisted);
  }, [persisted]);

  const dirty = value !== persisted;
  const tooLong = value.length > CUSTOM_INSTRUCTIONS_MAX_CHARS;

  const onSave = async () => {
    try {
      await upsert({ organizationId, customInstructions: value });
      toast({ title: t('toasts.saved') });
    } catch (err) {
      toast({
        title: errorMessage(err, t('errors.saveFailed')),
        variant: 'destructive',
      });
    }
  };

  return (
    <PageSection title={t('page.customInstructions.label')} titleSize="base">
      <Textarea
        description={t('page.customInstructions.description')}
        placeholder={t('page.customInstructions.placeholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
      />
      <div className="mt-2 flex items-center justify-between">
        <Text className="text-muted-foreground text-xs">
          {t('page.customInstructions.counter', {
            count: value.length,
          })}
        </Text>
        <Button variant="primary" onClick={onSave} disabled={!dirty || tooLong}>
          {t('page.customInstructions.save')}
        </Button>
      </div>
    </PageSection>
  );
}

function VoiceOutputSection({
  prefs,
  organizationId,
}: {
  // `undefined` is the convex `useQuery` loading state; `null` is the
  // explicit "no userPreferences row exists" answer; otherwise the doc.
  // Distinguishing the three matters because the previous collapse-to-null
  // rendered the Switch unchecked during the loading window — a user tap
  // in that window would write `false` to a row whose true value was
  // `true`, silently flipping their setting.
  prefs: Doc<'userPreferences'> | null | undefined;
  organizationId: string;
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const setVoiceOutput = useMutation(api.tts.mutations.setUserVoiceOutput);
  const getCapability = useAction(api.tts.synthesize.getCapability);
  const isLoading = prefs === undefined;
  const enabled = prefs?.voiceOutput === true;
  const [providerAvailable, setProviderAvailable] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void probeCapability(getCapability, organizationId)
      .then((r) => {
        if (!cancelled) setProviderAvailable(r.available);
      })
      .catch((err) => {
        // Distinguish transient probe failures (rate-limit, network blip)
        // from a genuine "no provider configured" so a momentary error
        // doesn't flip the page into its destructive "provider unavailable"
        // banner and re-trigger the destructive toast on the next toggle.
        // Leaving `providerAvailable` as `null` (unknown) keeps the UI in
        // its loading-equivalent state; the next mount/probe will resolve.
        if (isTransientProbeError(err)) {
          console.warn(
            '[tts] capability probe transient error; leaving unknown',
          );
          return;
        }
        console.warn('[tts] capability lookup failed', err);
        if (!cancelled) setProviderAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getCapability, organizationId]);

  return (
    <PageSection title={t('page.voiceOutput.label')} titleSize="base">
      <Switch
        // Disable the control until `prefs` resolves so a tap during the
        // loading window can't write `false` over a stored `true` (the
        // previous bug). The disabled window is brief — a single Convex
        // round-trip — and is preferable to a silent flip.
        disabled={isLoading}
        checked={enabled}
        // Pass `label` so the Radix Switch root receives an accessible
        // name — without it the screen reader announces just "switch,
        // off" (WCAG 4.1.2). The PageSection title alone is not enough
        // because it isn't programmatically associated with the control.
        label={t('page.voiceOutput.label')}
        description={t('page.voiceOutput.description')}
        // `disabled` above is gated only on `prefs` loading. The
        // capability-check state is surfaced as inline help below
        // rather than disabling the control — a slow / failing
        // capability check would otherwise leave the user unable to
        // turn voice off at all.
        aria-busy={isLoading || providerAvailable === null}
        onCheckedChange={async (next) => {
          // Prime synchronously inside the gesture — the gesture token does
          // not survive the awaited mutation below, so playback from the
          // next streamed reply would otherwise hit NotAllowedError.
          if (next) primeAudio();
          try {
            await setVoiceOutput({ organizationId, enabled: next });
            // Branch the success toast on `providerAvailable`. When the
            // user flips voice ON in an org with no TTS provider wired
            // up, a green "Preferences updated" toast falsely implies
            // voice will work — they then hear silence on the next
            // reply. Surface the gap as a destructive toast pointing
            // to the providers page.
            if (next && providerAvailable === false) {
              toast({
                title: t('toasts.voiceOutputEnabledButProviderMissing'),
                variant: 'destructive',
              });
            } else {
              toast({ title: t('toasts.preferencesUpdated') });
            }
          } catch (err) {
            toast({
              title: errorMessage(err, t('errors.saveFailed')),
              variant: 'destructive',
            });
          }
        }}
      />
      {/* Show the provider-unavailable hint whenever the org has no TTS
          provider configured — including when voice is currently OFF,
          so users can see the prerequisite before they opt in. */}
      {providerAvailable === false && (
        <Text variant="muted" className="mt-2 text-xs">
          {t('page.voiceOutput.providerUnavailable')}{' '}
          <Link
            to="/dashboard/$id/settings/providers"
            params={{ id: organizationId }}
            className="hover:text-foreground underline"
          >
            {t('page.voiceOutput.configureProvider')}
          </Link>
        </Text>
      )}
    </PageSection>
  );
}

function SavedMemoriesSection({
  memories,
}: {
  memories: Doc<'userMemories'>[];
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: softDelete } = useSoftDeleteMemory();

  return (
    <PageSection title={t('page.memories.title')} titleSize="base">
      {memories.length === 0 ? (
        <Text className="text-muted-foreground">
          {t('page.memories.empty')}
        </Text>
      ) : (
        <ul className="divide-border divide-y">
          {memories.map((m) => (
            <li
              key={m._id}
              className="flex items-start justify-between gap-3 py-2"
            >
              <Text className="flex-1">{m.content}</Text>
              <IconButton
                icon={Trash2}
                aria-label={t('page.memories.delete')}
                variant="ghost"
                onClick={async () => {
                  if (!window.confirm(t('page.memories.deleteConfirm'))) return;
                  try {
                    await softDelete({ memoryId: m._id });
                    toast({ title: t('toasts.deleted') });
                  } catch (err) {
                    toast({
                      title: errorMessage(err, t('errors.saveFailed')),
                      variant: 'destructive',
                    });
                  }
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}

function PendingMemoriesSection({
  memories,
}: {
  memories: Doc<'userMemories'>[];
}) {
  const { t } = useT('personalization');
  const { toast } = useToast();
  const { mutateAsync: approve } = useApprovePendingMemory();
  const { mutateAsync: dismiss } = useDismissPendingMemory();

  return (
    <PageSection title={t('page.pending.title')} titleSize="base">
      {memories.length === 0 ? (
        <Text className="text-muted-foreground">{t('page.pending.empty')}</Text>
      ) : (
        <ul className="divide-border divide-y">
          {memories.map((m) => (
            <li key={m._id} className="flex items-start gap-3 py-2">
              <Text className="flex-1">{m.content}</Text>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  try {
                    await approve({ memoryId: m._id });
                    toast({ title: t('toasts.saved') });
                  } catch (err) {
                    toast({
                      title: errorMessage(err, t('errors.saveFailed')),
                      variant: 'destructive',
                    });
                  }
                }}
              >
                {t('card.save')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await dismiss({ memoryId: m._id });
                    toast({ title: t('toasts.discarded') });
                  } catch (err) {
                    toast({
                      title: errorMessage(err, t('errors.saveFailed')),
                      variant: 'destructive',
                    });
                  }
                }}
              >
                {t('card.discard')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (
      data !== null &&
      typeof data === 'object' &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      return data.message;
    }
  }
  return fallback;
}
