import '@testing-library/jest-dom/vitest';
import { EditorView } from '@codemirror/view';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { act, render, screen, waitFor } from '@/tests/utils/render';

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '../../overlays/responsive-dialog';
import { Field } from '../field';
import {
  IssueFocusProvider,
  useRequestIssueFocus,
  type IssueFocusRange,
} from '../issue-focus';
import {
  CodeEditor,
  preloadCodeEditor,
  type CodeEditorHandle,
  type CodeEditorProps,
} from './code-editor';

import '../../../globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  vi.restoreAllMocks();
});

/** The editable text of the editor the test rendered. */
async function content(name?: string | RegExp): Promise<HTMLElement> {
  return screen.findByRole('textbox', name === undefined ? {} : { name }, {
    timeout: 10_000,
  });
}

/** A controlled editor with its value on screen, like a host form. */
function Controlled(
  props: Partial<CodeEditorProps> & {
    initial?: string;
    reformat?: (value: string) => string;
    onValue?: (value: string) => void;
  },
) {
  const { initial = '', reformat, onValue, ...rest } = props;
  const [value, setValue] = useState(initial);
  return (
    <>
      <CodeEditor
        aria-label="Code"
        language="javascript"
        {...rest}
        value={value}
        onChange={(next) => {
          const shown = reformat ? reformat(next) : next;
          onValue?.(shown);
          setValue(shown);
        }}
      />
      <output data-testid="value">{value}</output>
      <button type="button">After</button>
    </>
  );
}

function viewOf(element: HTMLElement): EditorView {
  const view = EditorView.findFromDOM(element);
  if (view === null) throw new Error('no editor view');
  return view;
}

function selection(element: HTMLElement): [number, number] {
  const { from, to } = viewOf(element).state.selection.main;
  return [from, to];
}

describe('CodeEditor typing', () => {
  it('round-trips a controlled value', async () => {
    render(<Controlled initial="return 1;" />);
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{End} // ok');
    expect(screen.getByTestId('value')).toHaveTextContent('return 1; // ok');
    expect(box).toHaveTextContent('return 1; // ok');
  });

  // REGRESSION (the JSON caret jump): a host that rewrites the text on every
  // keystroke must not move the caret off what the reader typed.
  it('keeps the caret when the host rewrites the value', async () => {
    render(
      <Controlled
        language="json"
        initial='{"a":1}'
        reformat={(value) => value.replace(/\s+$/, '').replace('"a":', '"a": ')}
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{End}{ArrowLeft}');
    await userEvent.keyboard('2');
    // "a": now holds 12, the host added the space, the caret is after the 2.
    expect(screen.getByTestId('value')).toHaveTextContent('{"a": 12}');
    const [from, to] = selection(box);
    expect(from).toBe(to);
    expect(box.textContent?.slice(0, from)).toBe('{"a": 12');
  });

  it('applies an outside change without echoing it to onChange', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CodeEditor
        aria-label="Code"
        language="text"
        value="hello"
        onChange={onChange}
      />,
    );
    await content('Code');
    rerender(
      <CodeEditor
        aria-label="Code"
        language="text"
        value="hello world"
        onChange={onChange}
      />,
    );
    await waitFor(async () =>
      expect(await content('Code')).toHaveTextContent('hello world'),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('waits for an input method to finish before applying an outside change', async () => {
    const { rerender } = render(
      <CodeEditor
        aria-label="Code"
        language="text"
        value="abc"
        onChange={() => {}}
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    box.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    rerender(
      <CodeEditor
        aria-label="Code"
        language="text"
        value="abc def"
        onChange={() => {}}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(box).toHaveTextContent(/^abc$/);
    box.dispatchEvent(new CompositionEvent('compositionend', { data: '' }));
    await waitFor(() => expect(box).toHaveTextContent('abc def'));
  });
});

const MOD = navigator.platform.toLowerCase().includes('mac')
  ? 'Meta'
  : 'Control';

function announced(element: HTMLElement): string {
  return (
    element.closest('.cm-editor')?.querySelector('.cm-announced')
      ?.textContent ?? ''
  );
}

describe('CodeEditor keyboard', () => {
  it('indents with Tab, then leaves with Esc and Tab', async () => {
    render(<Controlled initial="a" />);
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{End}{Enter}{Tab}b');
    expect(screen.getByTestId('value').textContent).toBe('a\n  b');
    await userEvent.keyboard('{Escape}');
    expect(announced(box)).toBe('Press Tab to move on.');
    await userEvent.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(screen.getByTestId('value').textContent).toBe('a\n  b');
  });

  it('describes the way out to assistive technology', async () => {
    render(<Controlled initial="a" />);
    const box = await content('Code');
    const ids = (box.getAttribute('aria-describedby') ?? '').split(' ');
    const hint = ids
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ');
    expect(hint).toContain('To leave the editor, press Esc, then Tab.');
  });

  it('never takes Tab in one line and submits on Enter', async () => {
    const onSubmit = vi.fn();
    render(
      <Controlled
        singleLine
        language="expression"
        initial="a > 1"
        onSubmit={onSubmit}
        submitLabel="Run"
      />,
    );
    const box = await content('Code');
    expect(box).toHaveAttribute('aria-multiline', 'false');
    await userEvent.click(box);
    await userEvent.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('a > 1');
    expect(screen.getByTestId('value').textContent).toBe('a > 1');
    await userEvent.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('turns pasted line breaks into spaces in one line', async () => {
    render(<Controlled singleLine language="template" initial="" />);
    const box = await content('Code');
    act(() => {
      viewOf(box).dispatch({
        changes: { from: 0, insert: 'one\ntwo\nthree' },
        userEvent: 'input.paste',
      });
    });
    expect(screen.getByTestId('value').textContent).toBe('one two three');
  });

  it('submits with Mod-Enter from several lines', async () => {
    const onSubmit = vi.fn();
    render(
      <Controlled
        language="json"
        initial={'{\n  "a": 1\n}'}
        onSubmit={onSubmit}
        submitLabel="Run"
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard(`{${MOD}>}{Enter}{/${MOD}}`);
    expect(onSubmit).toHaveBeenCalledWith('{\n  "a": 1\n}');
    expect(screen.getByTestId('value').textContent).toBe('{\n  "a": 1\n}');
  });

  it('shows the shortcut legend after keyboard focus only', async () => {
    render(
      <>
        <button type="button">Before</button>
        <Controlled initial="a" onSubmit={() => {}} submitLabel="Run" />
      </>,
    );
    const box = await content('Code');
    await userEvent.click(box);
    expect(
      document.querySelector('[data-code-editor-legend]'),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Before' }));
    await userEvent.keyboard('{Tab}');
    expect(box).toHaveFocus();
    const legend = document.querySelector('[data-code-editor-legend]');
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveAttribute('aria-hidden', 'true');
    expect(legend?.textContent).toContain('Esc, then Tab to leave');
    expect(legend?.textContent).toContain('Run');
  });
});

describe('CodeEditor in a sheet', () => {
  function SheetHost() {
    const [open, setOpen] = useState(true);
    const [value, setValue] = useState('const a = 1;');
    return (
      <>
        <p>{open ? 'sheet open' : 'sheet closed'}</p>
        <ResponsiveDialog open={open} onOpenChange={setOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogTitle>Edit node</ResponsiveDialogTitle>
            <CodeEditor
              aria-label="Code"
              language="javascript"
              value={value}
              onChange={setValue}
            />
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </>
    );
  }

  // Escape is the editor's while it needs it: the first arms leave and the
  // sheet stays; once armed, the next closes the sheet.
  it('keeps the sheet open until leave is armed, at phone width', async () => {
    await page.viewport(375, 800);
    try {
      render(<SheetHost />);
      const box = await content('Code');
      await new Promise((resolve) => setTimeout(resolve, 600));
      await userEvent.click(box);
      await userEvent.keyboard('{Escape}');
      expect(screen.getByText('sheet open')).toBeInTheDocument();
      expect(announced(box)).toBe('Press Tab to move on.');
      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.getByText('sheet closed')).toBeInTheDocument(),
      );
    } finally {
      await page.viewport(1280, 800);
    }
  });

  it('never lets a text selection drag the sheet', async () => {
    await page.viewport(375, 800);
    try {
      render(<SheetHost />);
      const box = await content('Code');
      const frame = box.closest('[data-code-editor]');
      expect(frame).toHaveAttribute('data-vaul-no-drag');
      const sheet = box.closest('[role="dialog"]') as HTMLElement;
      // Let the sheet finish sliding in.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const before = sheet.getBoundingClientRect().top;
      const { left, top } = box.getBoundingClientRect();
      const at = (y: number) => ({
        bubbles: true,
        pointerId: 1,
        pointerType: 'touch',
        clientX: left + 10,
        clientY: y,
      });
      box.dispatchEvent(new PointerEvent('pointerdown', at(top + 5)));
      for (const step of [30, 60, 120]) {
        box.dispatchEvent(new PointerEvent('pointermove', at(top + step)));
      }
      box.dispatchEvent(new PointerEvent('pointerup', at(top + 120)));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(screen.getByText('sheet open')).toBeInTheDocument();
      expect(sheet.getBoundingClientRect().top).toBe(before);
    } finally {
      await page.viewport(1280, 800);
    }
  });
});

describe('CodeEditor in a field', () => {
  type Request = (anchor: string, range?: IssueFocusRange) => void;
  const requester: { current: Request } = { current: () => {} };
  function Requester() {
    const request = useRequestIssueFocus();
    requester.current = request;
    return null;
  }

  function FieldHost({ value }: { value: string }) {
    return (
      <IssueFocusProvider>
        <Requester />
        <Field
          label="Input"
          htmlFor="node-input"
          issues={[
            { id: 'to', severity: 'error', message: 'Reads a missing field.' },
          ]}
        >
          <CodeEditor
            id="node-input"
            language="json"
            templates
            value={value}
            onChange={() => {}}
            issueAnchor="/nodes/0/input"
            describeDiagnostics={false}
          />
        </Field>
      </IssueFocusProvider>
    );
  }

  it('is named by its label and described by its problems', async () => {
    render(<FieldHost value='{"to": "ada"}' />);
    const box = await content('Input');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    const described = (box.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain('Reads a missing field.');
    expect(box.closest('[data-code-editor]')?.className).toContain(
      'border-destructive',
    );
  });

  it('takes focus from a click on its label', async () => {
    render(<FieldHost value='{"to": "ada"}' />);
    const box = await content('Input');
    await userEvent.click(screen.getByText('Input'));
    expect(box).toHaveFocus();
  });

  it('selects the range a problem names', async () => {
    render(<FieldHost value='{"to": "ada"}' />);
    const box = await content('Input');
    act(() => requester.current('/nodes/0/input', [1, 5]));
    expect(box).toHaveFocus();
    expect(selection(box)).toEqual([1, 5]);
  });

  // A problem with a key inside the JSON value lands on that key's text.
  it('finds the part of the value a deeper problem names', async () => {
    render(<FieldHost value='{"to": "ada", "cc": "bob"}' />);
    const box = await content('Input');
    act(() => requester.current('/nodes/0/input/cc', [0, 3]));
    expect(box).toHaveFocus();
    const [from, to] = selection(box);
    expect(box.textContent?.slice(from, to)).toBe('bob');
  });
});

describe('CodeEditor states', () => {
  it('reads but never edits when read-only', async () => {
    render(<Controlled readOnly initial="return 1;" />);
    const box = await content('Code');
    expect(box).toHaveAttribute('aria-readonly', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'After' }));
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(box).toHaveFocus();
    await userEvent.keyboard('{End}x');
    expect(screen.getByTestId('value').textContent).toBe('return 1;');
  });

  it('says why it is disabled, on focus', async () => {
    render(
      <Controlled
        disabled
        disabledReason="Only an author can change this."
        initial="return 1;"
      />,
    );
    const box = await content('Code');
    expect(box).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'After' }));
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(box).toHaveFocus();
    expect(
      await screen.findAllByText('Only an author can change this.'),
    ).not.toHaveLength(0);
  });

  it('grows with its text up to maxRows, then scrolls', async () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
    const { rerender } = render(
      <CodeEditor
        aria-label="Code"
        language="text"
        value={lines(1)}
        minRows={2}
        maxRows={5}
      />,
    );
    const box = await content('Code');
    const scroller = box.closest('.cm-scroller') as HTMLElement;
    const height = () => scroller.getBoundingClientRect().height;
    const small = height();
    rerender(
      <CodeEditor
        aria-label="Code"
        language="text"
        value={lines(4)}
        minRows={2}
        maxRows={5}
      />,
    );
    await waitFor(() => expect(height()).toBeGreaterThan(small));
    const grown = height();
    rerender(
      <CodeEditor
        aria-label="Code"
        language="text"
        value={lines(20)}
        minRows={2}
        maxRows={5}
      />,
    );
    await waitFor(() =>
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight),
    );
    expect(height()).toBeGreaterThan(grown);
    const capped = height();
    rerender(
      <CodeEditor
        aria-label="Code"
        language="text"
        value={lines(40)}
        minRows={2}
        maxRows={5}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(height()).toBe(capped);
  });

  it('shows the placeholder in the muted colour', async () => {
    render(
      <CodeEditor
        aria-label="Code"
        language="text"
        value=""
        placeholder="Write a prompt"
      />,
    );
    await content('Code');
    const placeholder = document.querySelector('.cm-placeholder');
    expect(placeholder).toHaveTextContent('Write a prompt');
  });
});

describe('CodeEditor templates', () => {
  it('turns {{ into a pair with the caret inside', async () => {
    render(<Controlled language="markdown" templates initial="Hi " />);
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{End}{{{{');
    expect(screen.getByTestId('value').textContent).toBe('Hi {{  }}');
    await userEvent.keyboard('name');
    expect(screen.getByTestId('value').textContent).toBe('Hi {{ name }}');
    await userEvent.keyboard('}}!');
    expect(screen.getByTestId('value').textContent).toBe('Hi {{ name }}!');
  });

  it('removes an empty pair with one Backspace', async () => {
    render(<Controlled language="template" initial="a " />);
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{End}{{{{');
    expect(screen.getByTestId('value').textContent).toBe('a {{  }}');
    await userEvent.keyboard('{Backspace}');
    expect(screen.getByTestId('value').textContent).toBe('a ');
  });

  it('draws each template as one chip, in JSON strings too', async () => {
    render(
      <CodeEditor
        aria-label="Code"
        language="json"
        templates
        value={'{"to": "{{ input.email }}", "n": 1}'}
      />,
    );
    await content('Code');
    const chips = [...document.querySelectorAll('.cm-template')];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      '{{ input.email }}',
    ]);
  });
});

describe('CodeEditor colours', () => {
  it('reads the keyword colour from the palette in dark mode', async () => {
    document.documentElement.classList.add('dark');
    render(
      <div className="bg-background p-4">
        <CodeEditor
          aria-label="Code"
          language="javascript"
          value="const a = 1;"
        />
      </div>,
    );
    const box = await content('Code');
    const keyword = [...box.querySelectorAll('span')].find(
      (span) => span.textContent === 'const',
    );
    expect(keyword).toBeDefined();
    expect(getComputedStyle(keyword as HTMLElement).color).toBe(
      'rgb(249, 117, 131)',
    );
  });

  it.each(['light', 'dark'])(
    'keeps every language readable on each surface (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const samples: Array<Partial<CodeEditorProps> & { value: string }> = [
        {
          language: 'javascript',
          value: 'const a = nodes.b.output; // why\nreturn { a, n: 1 };',
        },
        { language: 'expression', value: 'input.n > 2 && input.ok === true' },
        {
          language: 'json',
          templates: true,
          value: '{"to": "{{ input.email }}", "n": 1}',
        },
        {
          language: 'yaml',
          templates: true,
          value: 'name: x\nprompt: Rate {{ item.title }}\n',
        },
        {
          language: 'markdown',
          templates: true,
          value: '# Title\n\n**Bold** {{ nodes.a.output }} and `code`',
        },
        { language: 'template', value: 'Hi {{ "}}" }} and {{ open' },
      ];
      const { container } = render(
        <div className="flex flex-col gap-4">
          {['bg-background', 'bg-card', 'bg-bg-elevated'].map((surface) => (
            <div key={surface} className={`${surface} flex flex-col gap-2 p-4`}>
              {samples.map(({ value, ...sample }) => (
                <CodeEditor
                  key={`${surface}-${sample.language}`}
                  aria-label={`${sample.language} on ${surface}`}
                  language="text"
                  {...sample}
                  value={value}
                />
              ))}
            </div>
          ))}
        </div>,
      );
      await screen.findAllByRole('textbox', {}, { timeout: 10_000 });
      await waitFor(() =>
        expect(
          container.querySelectorAll('[data-code-editor-view] .cm-editor'),
        ).toHaveLength(18),
      );
      const result = await axe.run(container, {
        runOnly: [
          'color-contrast',
          'aria-allowed-attr',
          'aria-valid-attr-value',
          'aria-roledescription',
          'label',
        ],
      });
      expect(result.violations).toEqual([]);
      expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
        true,
      );
    },
  );

  it('keeps a steady caret under reduced motion', async () => {
    const original = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      const list = original(query);
      if (query === '(prefers-reduced-motion: reduce)') {
        Object.defineProperty(list, 'matches', { value: true });
      }
      return list;
    });
    render(<Controlled initial="a" />);
    const box = await content('Code');
    await userEvent.click(box);
    const layer = box
      .closest('.cm-editor')
      ?.querySelector<HTMLElement>('.cm-cursorLayer');
    expect(layer?.style.animationDuration).toBe('0ms');
  });
});

it('exposes a handle that focuses, selects and reports the selection', async () => {
  function WithHandle() {
    const ref = useRef<CodeEditorHandle>(null);
    return (
      <>
        <CodeEditor
          ref={ref}
          aria-label="Code"
          language="text"
          value="abcdef"
        />
        <button type="button" onClick={() => ref.current?.focus([2, 4])}>
          Select
        </button>
        <output data-testid="selection">
          {JSON.stringify(ref.current?.getSelection() ?? null)}
        </output>
      </>
    );
  }
  render(<WithHandle />);
  const box = await content('Code');
  await userEvent.click(screen.getByRole('button', { name: 'Select' }));
  expect(box).toHaveFocus();
  expect(selection(box)).toEqual([2, 4]);
});

it('preloads without rendering', async () => {
  expect(() => preloadCodeEditor()).not.toThrow();
});
