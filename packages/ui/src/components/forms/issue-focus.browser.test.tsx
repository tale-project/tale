import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor } from '@/tests/utils/render';

import {
  IssueFocusProvider,
  useIssueFocusTarget,
  useRequestIssueFocus,
  type IssueFocusRange,
} from './issue-focus';

import '../../globals.css';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Request = (anchor: string, range?: IssueFocusRange) => void;

/** The request function of the provider the test rendered last. */
const requester: { current: Request } = { current: () => {} };
const request: Request = (anchor, range) => requester.current(anchor, range);

/** Hands the test the provider's request function. */
function Requester() {
  const requestFocus = useRequestIssueFocus();
  useEffect(() => {
    requester.current = requestFocus;
  }, [requestFocus]);
  return null;
}

function TextField({
  anchor,
  label,
  value,
  multiline = false,
}: {
  anchor: string | null;
  label: string;
  value: string;
  multiline?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useIssueFocusTarget(anchor, ref);
  return multiline ? (
    <textarea ref={ref} aria-label={label} defaultValue={value} />
  ) : (
    <input ref={ref} aria-label={label} defaultValue={value} />
  );
}

function Surface({ children }: { children: ReactNode }) {
  return (
    <IssueFocusProvider>
      <Requester />
      {children}
    </IssueFocusProvider>
  );
}

function selectionOf(element: HTMLElement) {
  const control = element as HTMLInputElement;
  return [control.selectionStart, control.selectionEnd];
}

describe('useRequestIssueFocus', () => {
  it('focuses a registered field and selects the range in it', () => {
    render(
      <Surface>
        <TextField
          anchor="/nodes/0/prompt"
          label="Prompt"
          value="Summarize {{ nodes.nope.output }}"
          multiline
        />
      </Surface>,
    );
    act(() => request('/nodes/0/prompt', [13, 23]));
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    expect(prompt).toHaveFocus();
    expect(selectionOf(prompt)).toEqual([13, 23]);
  });

  it('clamps a range that runs past the text', () => {
    render(
      <Surface>
        <TextField anchor="/name" label="Name" value="triage" />
      </Surface>,
    );
    act(() => request('/name', [4, 99]));
    expect(selectionOf(screen.getByRole('textbox'))).toEqual([4, 6]);
  });

  it('waits for a field that mounts after the request', async () => {
    function Inspector() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open node
          </button>
          {open && (
            <TextField anchor="/nodes/1/prompt" label="Prompt" value="Hello" />
          )}
        </>
      );
    }
    render(
      <Surface>
        <Inspector />
      </Surface>,
    );
    act(() => request('/nodes/1/prompt', [0, 5]));
    act(() => screen.getByRole('button', { name: 'Open node' }).click());
    const prompt = await screen.findByRole('textbox', { name: 'Prompt' });
    await waitFor(() => expect(prompt).toHaveFocus());
    expect(selectionOf(prompt)).toEqual([0, 5]);
  });

  it('gives up on a request whose target never comes within two seconds', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    function Late() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open late
          </button>
          {open && <TextField anchor="/late" label="Late" value="x" />}
        </>
      );
    }
    render(
      <Surface>
        <Late />
      </Surface>,
    );
    act(() => request('/late'));
    act(() => {
      vi.advanceTimersByTime(2001);
    });
    vi.useRealTimers();
    act(() => screen.getByRole('button', { name: 'Open late' }).click());
    expect(screen.getByRole('textbox', { name: 'Late' })).not.toHaveFocus();
  });

  it('goes to the longest anchor that names the request, without its range', () => {
    render(
      <Surface>
        <TextField anchor="/nodes/0" label="Node" value="heading" />
        <TextField anchor="/nodes/0/input" label="Input" value='{"to":"a"}' />
      </Surface>,
    );
    act(() => request('/nodes/0/input/to', [7, 8]));
    const input = screen.getByRole('textbox', { name: 'Input' });
    expect(input).toHaveFocus();
    // The range points into the `to` value, not into this JSON text.
    expect(selectionOf(input)).not.toEqual([7, 8]);
  });

  it('matches whole path segments only', () => {
    render(
      <Surface>
        <TextField anchor="/nodes/1" label="Node one" value="one" />
        <TextField anchor="/nodes/10" label="Node ten" value="ten" />
      </Surface>,
    );
    act(() => request('/nodes/10/prompt'));
    expect(screen.getByRole('textbox', { name: 'Node ten' })).toHaveFocus();
  });

  it('prefers the most specific of the targets that mount together', async () => {
    function Panel() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open panel
          </button>
          {open && (
            <>
              <TextField anchor="/nodes/2" label="Heading" value="Fetch" />
              <TextField anchor="/nodes/2/when" label="Condition" value="x" />
            </>
          )}
        </>
      );
    }
    render(
      <Surface>
        <Panel />
      </Surface>,
    );
    act(() => request('/nodes/2/when'));
    act(() => screen.getByRole('button', { name: 'Open panel' }).click());
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Condition' })).toHaveFocus(),
    );
  });

  it('opens a closed details element around the target', () => {
    render(
      <Surface>
        <details>
          <summary>Control flow</summary>
          <TextField anchor="/nodes/0/when" label="Condition" value="x" />
        </details>
      </Surface>,
    );
    const details = screen.getByText('Control flow').closest('details');
    expect(details).not.toHaveAttribute('open');
    act(() => request('/nodes/0/when'));
    expect(details).toHaveAttribute('open');
    expect(screen.getByRole('textbox', { name: 'Condition' })).toHaveFocus();
  });

  it('calls a reveal first, then focuses once it has rendered', async () => {
    function Tabbed() {
      const [tab, setTab] = useState<'general' | 'advanced'>('general');
      const ref = useRef<HTMLInputElement>(null);
      useIssueFocusTarget('/advanced/retries', ref, {
        reveal: () => setTab('advanced'),
      });
      return (
        <div hidden={tab !== 'advanced'}>
          <input ref={ref} aria-label="Retries" defaultValue="3" />
        </div>
      );
    }
    render(
      <Surface>
        <Tabbed />
      </Surface>,
    );
    act(() => request('/advanced/retries', [0, 1]));
    const retries = screen.getByRole('textbox', { name: 'Retries' });
    await waitFor(() => expect(retries).toHaveFocus());
    expect(retries).toBeVisible();
    expect(selectionOf(retries)).toEqual([0, 1]);
  });

  it('takes a custom target', () => {
    const focus = vi.fn();
    function Custom() {
      useIssueFocusTarget('/output', { focus });
      return null;
    }
    render(
      <Surface>
        <Custom />
      </Surface>,
    );
    act(() => request('/output', [1, 2]));
    expect(focus).toHaveBeenCalledWith([1, 2]);
  });

  it('forgets a target that unmounted', () => {
    function Toggle() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setShown(false)}>
            Hide
          </button>
          {shown && <TextField anchor="/gone" label="Gone" value="x" />}
          <TextField anchor="/" label="Root" value="root" />
        </>
      );
    }
    render(
      <Surface>
        <Toggle />
      </Surface>,
    );
    act(() => screen.getByRole('button', { name: 'Hide' }).click());
    act(() => request('/gone'));
    expect(screen.getByRole('textbox', { name: 'Root' })).toHaveFocus();
  });

  it('warns and does nothing outside a provider', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Requester />);
    act(() => request('/name'));
    expect(warn).toHaveBeenCalledOnce();
  });
});
