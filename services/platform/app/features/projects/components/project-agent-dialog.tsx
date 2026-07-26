'use client';

/**
 * Create/edit form for a project agent: a name, the harness it runs on, the
 * skills/connectors it comes pre-equipped with, and an instructions addendum
 * the run lane delivers through the harness's system-prompt channel. One
 * dialog serves both modes — `agent` present means edit, absent means create.
 */

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { useEffect, useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useCreateProjectAgent,
  useUpdateProjectAgent,
} from '../hooks/mutations';
import type { ProjectAgentRow } from '../hooks/queries';
import {
  type AgentCapabilityBinding,
  type CapabilityOption,
  ProjectAgentCapabilityMenu,
} from './project-agent-capability-menu';

/** One harness the agent can run on (the composer's managed roster entry). */
export interface HarnessOption {
  harness: string;
  label: string;
  iconUrl?: string;
}

interface ProjectAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: Id<'projects'>;
  harnesses: readonly HarnessOption[];
  skills: readonly CapabilityOption[];
  connectors: readonly CapabilityOption[];
  /** The row being edited; absent = create. */
  agent?: ProjectAgentRow;
}

/** Mirrors the mutation's `PROJECT_AGENT_INSTRUCTIONS_MAX`. */
const INSTRUCTIONS_MAX = 20_000;

const EMPTY_BINDING: AgentCapabilityBinding = { skills: [], connectors: [] };

export function ProjectAgentDialog({
  open,
  onOpenChange,
  projectId,
  harnesses,
  skills,
  connectors,
  agent,
}: ProjectAgentDialogProps) {
  const { t } = useT('projects');
  const { mutateAsync: createAgent } = useCreateProjectAgent();
  const { mutateAsync: updateAgent } = useUpdateProjectAgent();

  const [name, setName] = useState('');
  const [harness, setHarness] = useState('');
  const [binding, setBinding] = useState(EMPTY_BINDING);
  const [instructions, setInstructions] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Re-seed from the row each time the dialog opens; create mode seeds blank.
  useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? '');
    setHarness(agent?.harness ?? '');
    setBinding(
      agent
        ? { skills: agent.skills, connectors: agent.connectors }
        : EMPTY_BINDING,
    );
    setInstructions(agent?.instructions ?? '');
    setNameError(undefined);
  }, [open, agent]);

  const canSubmit = name.trim().length > 0 && harness !== '';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        harness,
        skills: [...binding.skills],
        connectors: [...binding.connectors],
        ...(instructions.trim() !== ''
          ? { instructions: instructions.trim() }
          : {}),
      };
      if (agent) {
        await updateAgent({ agentId: agent._id, ...payload });
      } else {
        await createAgent({ projectId, ...payload });
      }
      toast({
        title: t(agent ? 'agents.editSuccess' : 'agents.createSuccess'),
        variant: 'success',
      });
      onOpenChange(false);
    } catch (error) {
      const code = error instanceof ConvexError ? error.data?.code : undefined;
      if (
        code === 'PROJECT_AGENT_NAME_INVALID' ||
        code === 'PROJECT_AGENT_NAME_TAKEN'
      ) {
        setNameError(t(`errors.${code}`));
      } else if (
        code === 'PROJECT_AGENT_HARNESS_INVALID' ||
        code === 'PROJECT_AGENT_INSTRUCTIONS_TOO_LONG' ||
        code === 'PROJECT_AGENT_LIMIT' ||
        code === 'RBAC_FORBIDDEN'
      ) {
        toast({ title: t(`errors.${code}`), variant: 'destructive' });
      } else {
        console.error('saveProjectAgent failed', error);
        toast({ title: t('agents.mutationError'), variant: 'destructive' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(agent ? 'agents.dialogEditTitle' : 'agents.dialogCreateTitle')}
      submitText={t(agent ? 'agents.editSubmit' : 'agents.createSubmit')}
      submittingText={t(
        agent ? 'agents.editSubmitting' : 'agents.createSubmitting',
      )}
      isSubmitting={isSubmitting}
      isValid={canSubmit}
      onSubmit={(e) => void onSubmit(e)}
    >
      <Input
        id="project-agent-name"
        label={t('agents.nameLabel')}
        placeholder={t('agents.namePlaceholder')}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setNameError(undefined);
        }}
        errorMessage={nameError}
      />
      <Select
        id="project-agent-harness"
        label={t('agents.harnessLabel')}
        placeholder={t('agents.harnessPlaceholder')}
        options={harnesses.map((option) => ({
          value: option.harness,
          label: option.label,
          ...(option.iconUrl !== undefined
            ? {
                icon: (
                  <img
                    src={option.iconUrl}
                    alt=""
                    className="size-4 rounded-sm"
                  />
                ),
              }
            : {}),
        }))}
        value={harness}
        // Radix fires a spurious '' on unmount/re-select races — never let it
        // clear a real choice.
        onValueChange={(value) => {
          if (value !== '') setHarness(value);
        }}
      />
      <Stack gap={1}>
        <Text variant="caption" className="font-medium">
          {t('agents.equipmentLabel')}
        </Text>
        <ProjectAgentCapabilityMenu
          skills={skills}
          connectors={connectors}
          value={binding}
          onChange={setBinding}
        />
      </Stack>
      <Textarea
        id="project-agent-instructions"
        label={t('agents.instructionsLabel')}
        placeholder={t('agents.instructionsPlaceholder')}
        description={t('agents.instructionsHint')}
        rows={6}
        maxLength={INSTRUCTIONS_MAX}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
      />
    </FormDialog>
  );
}
