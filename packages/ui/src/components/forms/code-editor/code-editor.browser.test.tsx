import '@testing-library/jest-dom/vitest';
import { EditorView } from '@codemirror/view';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import type { i18n as I18n } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import { act, render, screen, waitFor, within } from '@/tests/utils/render';

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
  type CodeEditorDiagnostic,
  type CodeEditorHandle,
  type CodeEditorProps,
} from './code-editor';
import { PROSE_X_HEIGHT } from './extensions/theme';
import type { CodeEditorProviders } from './providers';

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

/** A host whose Discard puts the saved text back, as an editor's does. */
function WithDiscard({ saved }: { saved: string }) {
  const [value, setValue] = useState(saved);
  return (
    <>
      <CodeEditor
        aria-label="Code"
        language="javascript"
        value={value}
        onChange={setValue}
      />
      <button type="button" onClick={() => setValue(saved)}>
        Discard
      </button>
      <output data-testid="value">{value}</output>
    </>
  );
}

describe('CodeEditor typing', () => {
  // REGRESSION: undo after a discard replayed the discarded edit into the
  // text the discard put back, duplicating it.
  it('starts undo afresh when the text is replaced from outside', async () => {
    render(<WithDiscard saved="return total + tax;" />);
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard(
      '{End}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}',
    );
    expect(screen.getByTestId('value')).toHaveTextContent('return total +');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(box).toHaveTextContent('return total + tax;');
    await userEvent.click(box);
    await userEvent.keyboard('{ControlOrMeta>}z{/ControlOrMeta}');
    expect(box).toHaveTextContent('return total + tax;');
    expect(screen.getByTestId('value')).toHaveTextContent(
      /^return total \+ tax;$/,
    );
  });

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

  it('stands a chip’s code as tall as the prose round it', async () => {
    render(
      <CodeEditor
        aria-label="Code"
        language="markdown"
        font="prose"
        templates
        value="Summarize {{ nodes.issues.output.title }} for the team."
      />,
    );
    const box = await content('Code');
    const chip = box.querySelector<HTMLElement>('.cm-template');
    if (chip === null) throw new Error('no chip');
    const prose = getComputedStyle(box);
    const code = getComputedStyle(chip);
    await document.fonts.load(`400 ${prose.fontSize} Inter`);
    // Inter's own x-height, as the page draws it.
    const canvas = document.createElement('canvas').getContext('2d');
    if (canvas === null) throw new Error('no 2D canvas');
    canvas.font = `400 100px Inter`;
    const inter = canvas.measureText('x').actualBoundingBoxAscent / 100;
    expect(inter).toBeCloseTo(PROSE_X_HEIGHT, 2);
    // The chip keeps the prose's size and holds whatever monospace font
    // the system supplies to that x-height.
    expect(code.fontFamily).toContain('monospace');
    expect(code.fontSize).toBe(prose.fontSize);
    expect(Number(code.fontSizeAdjust)).toBeCloseTo(PROSE_X_HEIGHT, 3);
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

// REGRESSION: "go to" a problem selected the check's raw offsets, though
// the reader had typed since the check settled; the next keystroke then
// replaced the wrong characters.
it('maps a go-to range through the edits made since the check', async () => {
  function Checked() {
    const ref = useRef<CodeEditorHandle>(null);
    const [value, setValue] = useState('total + tax');
    return (
      <>
        <CodeEditor
          ref={ref}
          aria-label="Code"
          language="text"
          value={value}
          onChange={setValue}
          diagnosticsFor="total + tax"
          diagnostics={[]}
        />
        <button type="button" onClick={() => ref.current?.focus([8, 11])}>
          Go to tax
        </button>
        <button type="button" onClick={() => ref.current?.focus([0, 5])}>
          Go to total
        </button>
      </>
    );
  }
  render(<Checked />);
  const box = await content('Code');
  await userEvent.click(box);
  await userEvent.keyboard('{Home}net ');
  // "tax" sat at 8–11 in the checked text; four characters were typed
  // before it since.
  await userEvent.click(screen.getByRole('button', { name: 'Go to tax' }));
  expect(selection(box)).toEqual([12, 15]);
  // "total" is next to the edit: the range is stale, so nothing is selected
  // rather than the wrong characters.
  const [before] = selection(box);
  await userEvent.click(screen.getByRole('button', { name: 'Go to total' }));
  expect(selection(box)).toEqual([before, before + 3]);
});

it('preloads without rendering', async () => {
  expect(() => preloadCodeEditor()).not.toThrow();
});

/** A host that knows two nodes and their outputs, for completion and hover. */
const SHAPES: CodeEditorProviders = {
  completion: ({ path }) => {
    if (path === null) return null;
    if (path.length === 0) {
      return {
        items: [
          { label: 'nodes', kind: 'variable', valueType: 'object' },
          { label: 'input', kind: 'input', valueType: 'object' },
        ],
      };
    }
    if (path.length === 1 && path[0] === 'nodes') {
      return {
        items: [
          {
            label: 'score',
            kind: 'node',
            detail: 'Language model',
            section: 'Earlier nodes',
          },
          {
            label: 'open issues',
            kind: 'node',
            detail: 'Transform',
            section: 'Earlier nodes',
          },
        ],
      };
    }
    if (path.length === 2 && path[0] === 'nodes') {
      return {
        items: [
          {
            label: 'output',
            kind: 'property',
            valueType: 'object',
            info: {
              type: '{ total: number }',
              description: 'What the node returns.',
            },
          },
        ],
      };
    }
    return { items: [] };
  },
  hover: ({ path }) =>
    path !== null && path.join('.') === 'nodes.score'
      ? { title: 'nodes.score', type: '{ output: { total: number } }' }
      : null,
};

/**
 * The open completion list, once it takes keys: CodeMirror ignores keys for
 * its first 75 ms, so a list that opens under fast typing is not chosen from
 * by accident.
 */
async function listbox(): Promise<HTMLElement> {
  const list = await screen.findByRole('listbox', {}, { timeout: 5000 });
  await new Promise((resolve) => setTimeout(resolve, 120));
  return list;
}

describe('CodeEditor completion', () => {
  it('lists what can come after a dot, by keyboard', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        providers={SHAPES}
        initial=""
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('nodes.');
    const list = await listbox();
    expect(box).toHaveAttribute('aria-autocomplete', 'list');
    // The list opens on "nodes" while typing; on a loaded runner the
    // update after the dot can land a moment later.
    await waitFor(() =>
      expect(
        [...list.querySelectorAll('[role="option"]')].map(
          (option) => option.querySelector('.cm-completionLabel')?.textContent,
        ),
      ).toEqual(['score', 'open issues']),
    );
    const options = [...list.querySelectorAll('[role="option"]')];
    expect(box.getAttribute('aria-activedescendant')).toBe(options[0].id);
    await userEvent.keyboard('{ArrowDown}');
    expect(box.getAttribute('aria-activedescendant')).toBe(options[1].id);
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('nodes.score');
  });

  it('accepts with Tab, and quotes a name that is not an identifier', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        providers={SHAPES}
        initial=""
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('nodes.');
    await listbox();
    await userEvent.keyboard('{ArrowDown}{Tab}');
    expect(screen.getByTestId('value').textContent).toBe(
      'nodes["open issues"]',
    );
  });

  it('shows the type of an option in its info panel', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        providers={SHAPES}
        initial="nodes.score"
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{End}.');
    await listbox();
    const info = await screen.findByText('What the node returns.');
    expect(info.closest('.cm-completionInfo')?.textContent).toContain('total');
  });

  it('opens on Ctrl-Space where it would not open by itself', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        providers={SHAPES}
        initial=""
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{Control>} {/Control}');
    const list = await listbox();
    expect(list.textContent).toContain('nodes');
  });

  it('opens with the template roots after {{ in a prompt', async () => {
    render(
      <Controlled
        language="markdown"
        templates
        providers={SHAPES}
        initial="Hi "
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{End}{{{{');
    const list = await listbox();
    expect(list.textContent).toContain('input');
  });

  // Escape closes the list first; the sheet stays open.
  it('closes the list before the sheet, at phone width', async () => {
    await page.viewport(375, 800);
    try {
      function Host() {
        const [open, setOpen] = useState(true);
        const [value, setValue] = useState('');
        return (
          <>
            <p>{open ? 'sheet open' : 'sheet closed'}</p>
            <ResponsiveDialog open={open} onOpenChange={setOpen}>
              <ResponsiveDialogContent>
                <ResponsiveDialogTitle>Edit node</ResponsiveDialogTitle>
                <div style={{ height: 120 }} />
                <CodeEditor
                  aria-label="Code"
                  language="expression"
                  singleLine
                  value={value}
                  onChange={setValue}
                  providers={SHAPES}
                />
                <div style={{ height: 320 }} />
              </ResponsiveDialogContent>
            </ResponsiveDialog>
          </>
        );
      }
      render(<Host />);
      const box = await content('Code');
      await new Promise((resolve) => setTimeout(resolve, 600));
      await userEvent.click(box);
      await userEvent.keyboard('nodes.');
      const list = await listbox();
      // The list sits inside the sheet.
      const sheet = box.closest('[role="dialog"]') as HTMLElement;
      const listBox = list.getBoundingClientRect();
      const sheetBox = sheet.getBoundingClientRect();
      expect(listBox.top).toBeGreaterThanOrEqual(sheetBox.top);
      expect(listBox.bottom).toBeLessThanOrEqual(sheetBox.bottom + 1);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      expect(screen.getByText('sheet open')).toBeInTheDocument();
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
});

describe('CodeEditor completion in German', () => {
  const shared: { i18n?: I18n } = {};
  function CaptureI18n() {
    const { i18n } = useTranslation();
    useEffect(() => {
      shared.i18n = i18n;
    }, [i18n]);
    return null;
  }
  afterEach(async () => {
    cleanup();
    localStorage.removeItem('user-locale');
    await shared.i18n?.changeLanguage('en-US');
  });

  it("names the list in the reader's language", async () => {
    localStorage.setItem('user-locale', 'de');
    render(
      <>
        <CaptureI18n />
        <Controlled
          language="expression"
          singleLine
          providers={SHAPES}
          initial=""
        />
      </>,
    );
    const box = await content();
    await userEvent.click(box);
    await userEvent.keyboard('nodes.');
    const list = await listbox();
    expect(list).toHaveAttribute('aria-label', 'Vorschläge');
  });
});

describe('CodeEditor problems', () => {
  const unknown: CodeEditorDiagnostic = {
    id: 'ref',
    severity: 'error',
    message: 'Reads "nope", and there is no node with that id.',
    code: 'REF_UNKNOWN_NODE',
    range: [6, 10],
    fixes: [
      { label: 'Read "score"', changes: [{ range: [6, 10], insert: 'score' }] },
    ],
  };
  const note: CodeEditorDiagnostic = {
    id: 'note',
    severity: 'warning',
    message: 'May be empty.',
    range: [11, 17],
  };

  it('underlines each problem by severity and marks its line', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        initial="nodes.nope.output"
        diagnostics={[unknown, note]}
      />,
    );
    const box = await content('Code');
    const error = box.querySelector('.cm-diagnostic-error');
    const warning = box.querySelector('.cm-diagnostic-warning');
    expect(error?.textContent).toBe('nope');
    expect(warning?.textContent).toBe('output');
    expect(getComputedStyle(error as HTMLElement).textDecorationStyle).toBe(
      'wavy',
    );
    const gutter = box
      .closest('.cm-editor')
      ?.querySelector('.cm-diagnostic-gutter .cm-gutterElement svg');
    expect(gutter).not.toBeNull();
  });

  it('shows the problem, its code and its fix on hover', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        initial="nodes.nope.output"
        diagnostics={[unknown]}
      />,
    );
    const box = await content('Code');
    const error = box.querySelector('.cm-diagnostic-error') as HTMLElement;
    await userEvent.hover(error);
    expect(
      await screen.findByText(unknown.message, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('REF_UNKNOWN_NODE')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Read "score"' }),
    ).toBeInTheDocument();
  });

  it('walks the problems with F8 and reads each aloud', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        initial="nodes.nope.output"
        diagnostics={[unknown, note]}
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{Home}{F8}');
    expect(selection(box)).toEqual([6, 10]);
    expect(announced(box)).toBe(
      'Error on line 1: Reads "nope", and there is no node with that id. Fix available: press ' +
        (MOD === 'Meta' ? '⌘.' : 'Ctrl+.') +
        '.',
    );
    await userEvent.keyboard('{F8}');
    expect(selection(box)).toEqual([11, 17]);
    expect(announced(box)).toBe('Warning on line 1: May be empty.');
    await userEvent.keyboard('{Shift>}{F8}{/Shift}');
    expect(selection(box)).toEqual([6, 10]);
  });

  it('applies the one fix with Mod-. and says so', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        initial="nodes.nope.output"
        diagnostics={[unknown]}
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{Home}{F8}');
    await userEvent.keyboard(`{${MOD}>}.{/${MOD}}`);
    expect(screen.getByTestId('value').textContent).toBe('nodes.score.output');
    expect(announced(box)).toBe('Applied: Read "score"');
  });

  it('describes its problems, and only when asked to', async () => {
    const { rerender } = render(
      <CodeEditor
        aria-label="Code"
        language="expression"
        value="nodes.nope.output"
        diagnostics={[unknown]}
      />,
    );
    const box = await content('Code');
    const described = () =>
      (box.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
    expect(described()).toContain('1 error.');
    expect(described()).toContain('Line 1: Reads "nope"');
    rerender(
      <CodeEditor
        aria-label="Code"
        language="expression"
        value="nodes.nope.output"
        diagnostics={[unknown]}
        describeDiagnostics={false}
      />,
    );
    await waitFor(() => expect(described()).not.toContain('1 error.'));
  });

  // The host's own announcer says a check's result once; new problems
  // arriving as a prop must not make the editor speak.
  it('announces nothing when new problems arrive', async () => {
    const { rerender } = render(
      <CodeEditor aria-label="Code" language="expression" value="nodes.nope" />,
    );
    const box = await content('Code');
    rerender(
      <CodeEditor
        aria-label="Code"
        language="expression"
        value="nodes.nope"
        diagnostics={[unknown]}
      />,
    );
    await waitFor(() =>
      expect(box.querySelector('.cm-diagnostic-error')).not.toBeNull(),
    );
    expect(announced(box)).toBe('');
  });

  it('keeps a problem in place while the reader types before it', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        initial="nodes.nope"
        diagnostics={[{ ...unknown, fixes: [] }]}
        diagnosticsFor="nodes.nope"
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{Home}x');
    expect(box.querySelector('.cm-diagnostic-error')?.textContent).toBe('nope');
  });

  it('marks text that does not parse, after a pause and away from the cursor', async () => {
    render(<Controlled language="json" initial={'{"a": 1,, "b": 2}'} />);
    const box = await content('Code');
    await waitFor(
      () => expect(box.querySelector('.cm-diagnostic-error')).not.toBeNull(),
      { timeout: 3000 },
    );
    const mark = box.querySelector('.cm-diagnostic-error') as HTMLElement;
    await userEvent.hover(mark);
    expect(
      await screen.findByText(
        "This isn't valid JSON here.",
        {},
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it('marks a {{ that never closes', async () => {
    render(<Controlled language="template" initial="Hi {{ name" />);
    const box = await content('Code');
    await waitFor(
      () =>
        expect(box.querySelector('.cm-diagnostic-error')?.textContent).toBe(
          '{{',
        ),
      { timeout: 3000 },
    );
  });

  it('fades its underlines while a check runs', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        initial="nodes.nope"
        diagnostics={[unknown]}
        diagnosticsStatus="checking"
      />,
    );
    const box = await content('Code');
    expect(box.closest('.cm-editor')).toHaveClass('cm-diagnostics-pending');
    expect(box).toHaveAttribute('aria-busy', 'true');
  });
});

describe('CodeEditor types', () => {
  it('shows the type under the pointer', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        providers={SHAPES}
        initial="nodes.score.output"
      />,
    );
    const box = await content('Code');
    const word = [...box.querySelectorAll('span')].find(
      (span) => span.textContent === 'score',
    );
    await userEvent.hover(word as HTMLElement);
    const title = await screen.findByText('nodes.score', {}, { timeout: 3000 });
    expect(title.closest('.cm-tooltip')?.textContent).toContain('total');
  });

  it('reads the type at the cursor aloud on Mod-K Mod-I', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        providers={SHAPES}
        initial="nodes.score.output"
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    act(() => {
      viewOf(box).dispatch({ selection: { anchor: 8 } });
    });
    await userEvent.keyboard(`{${MOD}>}k{/${MOD}}{${MOD}>}i{/${MOD}}`);
    await waitFor(() =>
      expect(announced(box)).toBe('nodes.score: { output: { total: number } }'),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(document.querySelector('.cm-tooltip')).toBeNull(),
    );
  });
});

describe('CodeEditor expand', () => {
  it('edits in a large dialog and brings the caret back', async () => {
    render(
      <Controlled
        language="javascript"
        expandable
        initial={'const a = 1;\nreturn a;'}
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.click(
      screen.getByRole('button', { name: 'Expand editor' }),
    );
    const dialog = await screen.findByRole('dialog');
    const big = await within(dialog).findByRole(
      'textbox',
      {},
      { timeout: 5000 },
    );
    await waitFor(() => expect(big).toHaveFocus());
    await userEvent.keyboard('{End} // more');
    expect(screen.getByTestId('value').textContent).toBe(
      'const a = 1;\nreturn a; // more',
    );
    const caret = selection(big);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Back to the field' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(box).toHaveFocus());
    expect(box.textContent).toContain('return a; // more');
    expect(selection(box)).toEqual(caret);
  });
});

describe('CodeEditor problem tooltips by keyboard', () => {
  const two: CodeEditorDiagnostic = {
    id: 'two',
    severity: 'error',
    message: 'Reads a node that does not exist.',
    range: [6, 10],
    fixes: [
      { label: 'Read "score"', changes: [{ range: [6, 10], insert: 'score' }] },
      {
        label: 'Read "report"',
        changes: [{ range: [6, 10], insert: 'report' }],
      },
    ],
  };

  it('offers several fixes as buttons, chosen with the arrows', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        initial="nodes.nope"
        diagnostics={[two]}
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{Home}{F8}');
    await userEvent.keyboard(`{${MOD}>}.{/${MOD}}`);
    const first = await screen.findByRole('button', { name: 'Read "score"' });
    await waitFor(() => expect(first).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Read "report"' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('nodes.report');
    expect(box).toHaveFocus();
  });

  it('closes the tooltip with Escape before arming leave', async () => {
    render(
      <Controlled
        language="expression"
        singleLine
        initial="nodes.nope"
        diagnostics={[two]}
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('{Home}{F8}');
    expect(await screen.findByText(two.message)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText(two.message)).toBeNull());
    expect(announced(box)).not.toBe('Press Tab to move on.');
    await userEvent.keyboard('{Escape}');
    expect(announced(box)).toBe('Press Tab to move on.');
  });
});

describe.each(['light', 'dark'])('CodeEditor popups (%s)', (theme) => {
  it('keeps the open list and a problem tooltip accessible', async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const problem: CodeEditorDiagnostic = {
      id: 'p',
      severity: 'warning',
      message: 'May be empty.',
      code: 'MAYBE_NULL',
      range: [0, 5],
    };
    render(
      <div className="bg-background p-4">
        <Controlled
          language="expression"
          singleLine
          providers={SHAPES}
          initial="nodes"
          diagnostics={[problem]}
        />
      </div>,
    );
    const box = await content('Code');
    await userEvent.hover(
      box.querySelector('.cm-diagnostic-warning') as HTMLElement,
    );
    await screen.findByText('MAYBE_NULL', {}, { timeout: 3000 });
    await userEvent.click(box);
    await userEvent.keyboard('{End}.');
    await listbox();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const result = await axe.run(document.body, {
      runOnly: [
        'color-contrast',
        'aria-allowed-attr',
        'aria-valid-attr-value',
        'aria-required-children',
        'aria-required-parent',
        'button-name',
      ],
    });
    expect(result.violations).toEqual([]);
  });
});

describe('CodeEditor under reduced motion', () => {
  afterEach(async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [] });
  });

  it('opens the list without animation and keeps the caret steady', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    render(
      <Controlled
        language="expression"
        singleLine
        providers={SHAPES}
        initial=""
      />,
    );
    const box = await content('Code');
    await userEvent.click(box);
    await userEvent.keyboard('nodes.');
    await listbox();
    const tooltip = document.querySelector(
      '.cm-tooltip-autocomplete',
    ) as HTMLElement;
    expect(getComputedStyle(tooltip).animationName).toBe('none');
    const layer = box
      .closest('.cm-editor')
      ?.querySelector<HTMLElement>('.cm-cursorLayer');
    expect(layer?.style.animationDuration).toBe('0ms');
  });
});
