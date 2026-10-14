'use client';

import { ClaudeIcon } from '@tale/ui/icons/claude-icon';
import { OpenAIIcon } from '@tale/ui/icons/openai-icon';
import { Tabs, type TabItem } from '@tale/ui/tabs';
import { CircleCheck } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';

import { useNewConnection } from '../hooks/use-new-connection';
import type { ConnectionWatch } from '../lib/connection-watch';
import { buildPrompt, type PromptContext } from '../lib/prompts';
import {
  SETUP_CLIENTS,
  type SetupClient,
  type SetupStep,
  type StepText,
  setupSteps,
} from '../lib/setup-steps';
import { CommandBlock } from './command-block';

/** The MCP endpoint, at the address people reach this deployment by. */
const MCP_PATH = '/api/v1/mcp';

/** A prompt asks the person to fill something in when it holds a bracketed
 * part. */
const HAS_PLACEHOLDER = /\[[^\]]+\]/;

/** Whether a tab's value is one of ours. */
function isSetupClient(value: string): value is SetupClient {
  return SETUP_CLIENTS.some((client) => client === value);
}

interface CodingAgentSetupProps {
  organizationId: string;
  /** What the first prompt is about. */
  promptContext: PromptContext;
  /** Anything the host adds under the prompt. */
  children?: ReactNode;
}

/**
 * Teaches a person to connect a coding agent: the commands for the agent they
 * use, and a line that says whether one has signed in yet, from the list of
 * connections itself rather than from a claim. The agent signs in by browser
 * (the consent page asks which organization and how much access); the
 * commands carry no key.
 */
export function CodingAgentSetup({
  organizationId,
  promptContext,
  children,
}: CodingAgentSetupProps) {
  const { t } = useT('codingAgent');
  const address = `${useSiteUrl()}${MCP_PATH}`;
  const [client, setClient] = useState<SetupClient>('claude-code');
  const watch = useNewConnection(organizationId);
  const prompt = buildPrompt(t, promptContext);

  const items: TabItem[] = SETUP_CLIENTS.map((id) => ({
    value: id,
    label: <ClientLabel client={id} />,
    content: (
      <div className="pt-4">
        <ClientSteps client={id} address={address} />
      </div>
    ),
  }));

  return (
    <div className="flex flex-col gap-5">
      <Tabs
        items={items}
        value={client}
        onValueChange={(value) => {
          if (isSetupClient(value)) setClient(value);
        }}
        listAriaLabel={t('clients.label')}
      />
      <ConnectionLine watch={watch} />
      <section
        aria-labelledby="coding-agent-prompt-label"
        className="flex flex-col gap-2"
      >
        <h3 id="coding-agent-prompt-label" className="text-sm font-medium">
          {watch.state === 'connected'
            ? t('prompt.labelConnected')
            : t('prompt.label')}
        </h3>
        <CommandBlock
          code={prompt}
          prose
          copyLabel={t('copy.prompt')}
          copiedLabel={t('copy.copied')}
        >
          <PromptText text={prompt} />
        </CommandBlock>
        {HAS_PLACEHOLDER.test(prompt) ? (
          <p className="text-muted-foreground text-xs">{t('prompt.replace')}</p>
        ) : null}
      </section>
      {children}
    </div>
  );
}

/** A client's tab: its mark and its name. The names are brands, so they are
 * not translated. */
function ClientLabel({ client }: { client: SetupClient }) {
  const { t } = useT('codingAgent');
  if (client === 'claude-code') {
    return (
      <span className="flex items-center gap-1.5">
        <ClaudeIcon className="size-4" />
        Claude Code
      </span>
    );
  }
  if (client === 'codex') {
    return (
      <span className="flex items-center gap-1.5">
        <OpenAIIcon className="size-4" />
        Codex
      </span>
    );
  }
  return <>{t('clients.other')}</>;
}

/** The sentence of a step. Each key is named in full, so the catalog's checks
 * can find it. */
function useStepText(): (text: StepText) => string {
  const { t } = useT('codingAgent');
  const words: Record<StepText, string> = {
    claudeCodeAdd: t('steps.claudeCodeAdd'),
    claudeCodeSignIn: t('steps.claudeCodeSignIn'),
    codexAdd: t('steps.codexAdd'),
    otherAddress: t('steps.otherAddress'),
    otherSignIn: t('steps.otherSignIn'),
  };
  return (text) => words[text];
}

function ClientSteps({
  client,
  address,
}: {
  client: SetupClient;
  address: string;
}) {
  const { t } = useT('codingAgent');
  const stepText = useStepText();
  // An address no terminal could take as it is gets the address alone.
  const steps: readonly SetupStep[] = setupSteps(client, address) ?? [
    { text: 'otherAddress', code: address },
    { text: 'otherSignIn' },
  ];
  return (
    <ol className="flex list-none flex-col gap-4">
      {steps.map((step, index) => (
        <li key={step.text} className="flex gap-3">
          <span
            aria-hidden
            className="bg-muted text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums"
          >
            {index + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm">{stepText(step.text)}</p>
            {step.code === undefined ? null : (
              <CommandBlock
                code={step.code}
                copyLabel={
                  step.text === 'otherAddress'
                    ? t('copy.address')
                    : t('copy.command')
                }
                copiedLabel={t('copy.copied')}
              />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Not connected yet, or the agent that just signed in. One polite live
 * region, so the arrival is announced once. */
function ConnectionLine({ watch }: { watch: ConnectionWatch }) {
  const { t } = useT('codingAgent');
  const connected = watch.state === 'connected';
  return (
    <div
      role="status"
      className="border-border flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm"
    >
      {connected ? (
        <CircleCheck className="size-4 shrink-0 text-green-600" aria-hidden />
      ) : (
        <span
          aria-hidden
          className="bg-muted-foreground/50 size-2 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
        />
      )}
      <span>
        {connected
          ? t('status.connected', { client: watch.clientName })
          : t('status.waiting')}
      </span>
    </div>
  );
}

/** A prompt with the part the person must replace marked, as the words say. */
function PromptText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]]+\])/).map((part, index) =>
        part.startsWith('[') && part.endsWith(']') ? (
          <mark
            key={index}
            className="bg-primary/10 text-foreground rounded px-1"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
