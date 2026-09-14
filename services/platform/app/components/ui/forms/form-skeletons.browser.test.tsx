import '@testing-library/jest-dom/vitest';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { render, screen, waitFor } from '@/tests/utils/render';

import { Checkbox } from './checkbox';
import { DatePickerWithRange } from './date-range-picker';
import { FileUpload } from './file-upload';
import { Input } from './input';
import { ModelSelector } from './model-selector';
import { MultiSelect } from './multi-select';
import { RadioGroup } from './radio-group';
import { SearchableSelect } from './searchable-select';
import { Select } from './select';
import { Switch } from './switch';
import { Textarea } from './textarea';

import '@/app/globals.css';

afterEach(cleanup);

const options = [
  { value: 'one', label: 'First option' },
  { value: 'two', label: 'Second option' },
];

const fields: { name: string; control: ReactNode; selector: string }[] = [
  {
    name: 'checkbox',
    control: (
      <Checkbox
        label="Keep this choice enabled"
        description="A description that wraps in narrow forms."
      />
    ),
    selector: '[role="checkbox"]',
  },
  {
    name: 'switch',
    control: (
      <Switch
        label="Keep this choice enabled"
        description="A description that wraps in narrow forms."
      />
    ),
    selector: '[role="switch"]',
  },
  {
    name: 'input',
    control: (
      <Input
        label="Name"
        description="A description that wraps in narrow forms."
        defaultValue="Example"
      />
    ),
    selector: 'input',
  },
  {
    name: 'password input',
    control: (
      <Input
        label="Password"
        type="password"
        passwordToggle
        defaultValue="Example"
      />
    ),
    selector: 'input',
  },
  {
    name: 'input with suffix',
    control: (
      <Input label="Address" suffix="@example.test" defaultValue="Example" />
    ),
    selector: 'input',
  },
  {
    name: 'textarea',
    control: <Textarea label="Notes" rows={4} defaultValue="Example" />,
    selector: 'textarea',
  },
  {
    name: 'select',
    control: <Select label="Choice" options={options} defaultValue="one" />,
    selector: '[role="combobox"]',
  },
  {
    name: 'searchable select',
    control: (
      <SearchableSelect
        label="Choice"
        options={options}
        value="one"
        onValueChange={() => {}}
      />
    ),
    selector: 'button[aria-haspopup="dialog"]',
  },
  {
    name: 'multi select',
    control: (
      <MultiSelect
        label="Choices"
        options={options}
        value={['one']}
        onValueChange={() => {}}
      />
    ),
    selector: '[role="combobox"]',
  },
  {
    name: 'radio group',
    control: <RadioGroup label="Choice" options={options} defaultValue="one" />,
    selector: '[role="radio"]',
  },
  {
    name: 'date range',
    control: <DatePickerWithRange label="Dates" onChange={() => {}} />,
    selector: 'button',
  },
  {
    name: 'file upload',
    control: (
      <FileUpload.Root label="Files">
        <FileUpload.DropZone
          onFilesSelected={() => {}}
          className="rounded-lg border p-6"
        >
          Drop files here
        </FileUpload.DropZone>
      </FileUpload.Root>
    ),
    selector: '[role="button"]',
  },
  {
    name: 'model selector',
    control: (
      <ModelSelector
        models={['one', 'two']}
        onChange={() => {}}
        availableOptions={options}
        getDisplayName={(id) => `Model ${id}`}
        getProviderName={() => 'Example provider'}
      />
    ),
    selector: 'button',
  },
  {
    name: 'copyable field',
    control: <CopyableField label="Identifier" value="example-identifier" />,
    selector: 'button',
  },
];

function geometry(element: Element) {
  const { width, height, x, y } = element.getBoundingClientRect();
  return { width, height, x, y };
}

describe('form skeleton geometry', () => {
  for (const width of [280, 760]) {
    it.each(fields)(
      `preserves $name layout and control identity at ${width}px`,
      ({ control, selector }) => {
        const fixture = (loading: boolean) => (
          <div style={{ width }}>
            <Skeletonize loading={loading}>
              <div
                data-field-layout={width >= 640 ? 'row' : undefined}
                data-testid="field"
              >
                {control}
              </div>
            </Skeletonize>
            <div data-testid="after">Following content</div>
          </div>
        );
        const { rerender } = render(fixture(false));
        const field = screen.getByTestId('field');
        const liveControl = field.querySelector(selector);
        expect(liveControl).not.toBeNull();
        if (!liveControl) throw new Error(`Missing ${selector}`);
        const fieldBounds = geometry(field);
        const controlBounds = geometry(liveControl);
        const followingBounds = geometry(screen.getByTestId('after'));
        const label = field.querySelector('label');

        rerender(fixture(true));

        const maskedControl = field.querySelector(selector);
        expect(maskedControl).not.toBeNull();
        if (!maskedControl) throw new Error(`Missing masked ${selector}`);
        expect(geometry(field)).toEqual(fieldBounds);
        expect(geometry(maskedControl)).toEqual(controlBounds);
        expect(geometry(screen.getByTestId('after'))).toEqual(followingBounds);
        expect(maskedControl).toBe(liveControl);
        if (label) {
          expect(field.querySelector('label')).toBe(label);
          expect(label).toBeVisible();
        }

        rerender(fixture(false));
        expect(field.querySelector(selector)).toBe(liveControl);
        expect(geometry(field)).toEqual(fieldBounds);
      },
    );
  }
});

describe('open select menus during loading', () => {
  it.each([
    {
      name: 'select',
      control: <Select label="Choice" options={options} open />,
    },
    {
      name: 'searchable select',
      control: (
        <SearchableSelect
          label="Choice"
          options={options}
          value="one"
          onValueChange={() => {}}
          open
        />
      ),
    },
    {
      name: 'multi select',
      control: (
        <MultiSelect
          label="Choices"
          options={options}
          value={['one']}
          onValueChange={() => {}}
          open
        />
      ),
    },
  ])(
    'masks and makes an already-open $name menu inert',
    async ({ control }) => {
      const fixture = (loading: boolean) => (
        <Skeletonize loading={loading}>{control}</Skeletonize>
      );
      const { rerender } = render(fixture(false));
      const option = await screen.findByRole('option', {
        name: 'First option',
      });

      rerender(fixture(true));

      expect(option.closest('[inert][data-skeleton-mask]')).not.toBeNull();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();

      rerender(fixture(false));
      await waitFor(() => expect(option).toBeVisible());
      expect(option.closest('[inert]')).toBeNull();
    },
  );
});

describe('open date pickers during loading', () => {
  it.each([
    { name: 'calendar', triggerIndex: 0, selector: '.react-datepicker' },
    { name: 'preset menu', triggerIndex: 1, selector: '[role="menu"]' },
  ])(
    'closes an already-open $name while masked',
    async ({ triggerIndex, selector }) => {
      const fixture = (loading: boolean) => (
        <Skeletonize loading={loading}>
          <DatePickerWithRange label="Dates" onChange={() => {}} />
        </Skeletonize>
      );
      const { container, rerender, user } = render(fixture(false));
      const trigger = screen.getAllByRole('button')[triggerIndex];
      if (!trigger) throw new Error('Missing date picker trigger');
      await user.click(trigger);
      await waitFor(() =>
        expect(document.querySelector(selector)).toBeVisible(),
      );

      rerender(fixture(true));

      await waitFor(() =>
        expect(document.querySelector(selector)).not.toBeInTheDocument(),
      );
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveAttribute('data-skeleton-mask');

      rerender(fixture(false));
      expect(container.querySelectorAll('button')[triggerIndex]).toBe(trigger);
      expect(trigger).not.toHaveAttribute('data-skeleton-mask');
      expect(trigger).not.toBeDisabled();
    },
  );
});
