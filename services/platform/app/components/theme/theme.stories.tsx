import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = {
  title: 'Theme/Overview',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Tale UI theming overview.

## Theme Setup
The application uses a custom theme provider with system preference detection.

\`\`\`tsx
import { ThemeProvider } from '@/app/components/theme/theme-provider';

<ThemeProvider>
  <App />
</ThemeProvider>
\`\`\`

## Theme Colors
Colors are defined using CSS custom properties in \`globals.css\` and support both light and dark modes.
        `,
      },
    },
  },
};

export default meta;

const colorGroups = [
  {
    name: 'Background & Foreground',
    colors: [
      {
        name: 'background',
        variable: 'bg-background',
        text: 'text-foreground',
      },
      {
        name: 'foreground',
        variable: 'bg-foreground',
        text: 'text-background',
      },
    ],
  },
  {
    name: 'Card',
    colors: [
      { name: 'card', variable: 'bg-card', text: 'text-card-foreground' },
      {
        name: 'card-foreground',
        variable: 'bg-card-foreground',
        text: 'text-card',
      },
    ],
  },
  {
    name: 'Primary',
    colors: [
      {
        name: 'primary',
        variable: 'bg-primary',
        text: 'text-primary-foreground',
      },
      {
        name: 'primary-foreground',
        variable: 'bg-primary-foreground',
        text: 'text-primary',
      },
    ],
  },
  {
    name: 'Secondary',
    colors: [
      {
        name: 'secondary',
        variable: 'bg-secondary',
        text: 'text-secondary-foreground',
      },
      {
        name: 'secondary-foreground',
        variable: 'bg-secondary-foreground',
        text: 'text-secondary',
      },
    ],
  },
  {
    name: 'Muted',
    colors: [
      { name: 'muted', variable: 'bg-muted', text: 'text-muted-foreground' },
      {
        name: 'muted-foreground',
        variable: 'bg-muted-foreground',
        text: 'text-muted',
      },
    ],
  },
  {
    name: 'Accent',
    colors: [
      { name: 'accent', variable: 'bg-accent', text: 'text-accent-foreground' },
      {
        name: 'accent-foreground',
        variable: 'bg-accent-foreground',
        text: 'text-accent',
      },
    ],
  },
  {
    name: 'Destructive',
    colors: [
      {
        name: 'destructive',
        variable: 'bg-destructive',
        text: 'text-destructive-foreground',
      },
      {
        name: 'destructive-foreground',
        variable: 'bg-destructive-foreground',
        text: 'text-destructive',
      },
    ],
  },
];

const semanticColors = [
  {
    name: 'border',
    class: 'border-border bg-transparent border-4',
    description: 'Default border color',
  },
  {
    name: 'input',
    class: 'border-input bg-transparent border-4',
    description: 'Input border color',
  },
  {
    name: 'ring',
    class: 'ring-2 ring-ring bg-transparent',
    description: 'Focus ring color',
  },
];

export const ColorPalette: StoryObj = {
  render: () => (
    <div className="space-y-8">
      {colorGroups.map((group) => (
        <div key={group.name}>
          <h3 className="text-sm font-medium mb-3">{group.name}</h3>
          <div className="grid grid-cols-2 gap-4">
            {group.colors.map((color) => (
              <div
                key={color.name}
                className={`${color.variable} ${color.text} p-4 rounded-lg border`}
              >
                <p className="font-medium">{color.name}</p>
                <p className="text-xs opacity-80">{color.variable}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
};

export const SemanticColors: StoryObj = {
  render: () => (
    <div className="space-y-4">
      <h3 className="text-sm font-medium mb-3">Semantic Colors</h3>
      {semanticColors.map((color) => (
        <div key={color.name} className="flex items-center gap-4">
          <div className={`size-12 rounded-lg ${color.class}`} />
          <div>
            <p className="font-medium">{color.name}</p>
            <p className="text-xs text-muted-foreground">{color.description}</p>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const Typography: StoryObj = {
  render: () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          Headings
        </h3>
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Heading 1</h1>
          <h2 className="text-3xl font-semibold">Heading 2</h2>
          <h3 className="text-2xl font-semibold">Heading 3</h3>
          <h4 className="text-xl font-medium">Heading 4</h4>
          <h5 className="text-lg font-medium">Heading 5</h5>
          <h6 className="text-base font-medium">Heading 6</h6>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          Body Text
        </h3>
        <div className="space-y-2">
          <p className="text-lg">Large body text (text-lg)</p>
          <p className="text-base">Default body text (text-base)</p>
          <p className="text-sm">Small body text (text-sm)</p>
          <p className="text-xs">Extra small text (text-xs)</p>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">
          Text Colors
        </h3>
        <div className="space-y-2">
          <p className="text-foreground">text-foreground (default)</p>
          <p className="text-muted-foreground">
            text-muted-foreground (secondary)
          </p>
          <p className="text-primary">text-primary</p>
          <p className="text-destructive">text-destructive</p>
        </div>
      </div>
    </div>
  ),
};

export const Spacing: StoryObj = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">
        Spacing Scale
      </h3>
      <div className="space-y-4">
        {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((size) => (
          <div key={size} className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground w-12">
              gap-{size}
            </span>
            <div
              className={`h-4 bg-primary rounded`}
              style={{ width: `${size * 4}px` }}
            />
            <span className="text-xs text-muted-foreground">{size * 4}px</span>
          </div>
        ))}
      </div>
    </div>
  ),
};

export const BorderRadius: StoryObj = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">
        Border Radius
      </h3>
      <div className="flex flex-wrap gap-4">
        {[
          { name: 'rounded-none', class: 'rounded-none' },
          { name: 'rounded-sm', class: 'rounded-sm' },
          { name: 'rounded', class: 'rounded' },
          { name: 'rounded-md', class: 'rounded-md' },
          { name: 'rounded-lg', class: 'rounded-lg' },
          { name: 'rounded-xl', class: 'rounded-xl' },
          { name: 'rounded-2xl', class: 'rounded-2xl' },
          { name: 'rounded-full', class: 'rounded-full' },
        ].map((radius) => (
          <div key={radius.name} className="text-center">
            <div className={`size-16 bg-primary ${radius.class}`} />
            <p className="text-xs text-muted-foreground mt-2">{radius.name}</p>
          </div>
        ))}
      </div>
    </div>
  ),
};

export const Shadows: StoryObj = {
  render: () => (
    <div className="space-y-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-2">
        Shadows
      </h3>
      <div className="flex flex-wrap gap-6">
        {[
          { name: 'shadow-sm', class: 'shadow-sm' },
          { name: 'shadow', class: 'shadow' },
          { name: 'shadow-md', class: 'shadow-md' },
          { name: 'shadow-lg', class: 'shadow-lg' },
          { name: 'shadow-xl', class: 'shadow-xl' },
        ].map((shadow) => (
          <div key={shadow.name} className="text-center">
            <div className={`size-20 bg-card rounded-lg ${shadow.class}`} />
            <p className="text-xs text-muted-foreground mt-2">{shadow.name}</p>
          </div>
        ))}
      </div>
    </div>
  ),
};
