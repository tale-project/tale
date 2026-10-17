import type { Meta, StoryObj } from '@storybook/react-vite';

import { Center, Grid, NarrowContainer, Row, Spacer, Stack } from './layout';

const meta: Meta = {
  title: 'Layout/Primitives',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Layout primitives for composing pages without raw layout `<div>`s. ' +
          '`Stack` (vertical) and `Row` (horizontal) share one `gap` scale; ' +
          '`Grid` is responsive. `HStack`/`VStack` are deprecated aliases of ' +
          '`Row`/`Stack`.',
      },
    },
  },
};
export default meta;

const Box = ({
  children,
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`bg-primary/10 border-primary/20 flex items-center justify-center rounded-md border p-3 text-sm ${className}`}
  >
    {children || 'Box'}
  </div>
);

export const StackVertical: StoryObj = {
  render: () => (
    <div className="max-w-xs">
      <Stack gap={4}>
        <Box>Item 1</Box>
        <Box>Item 2</Box>
        <Box>Item 3</Box>
      </Stack>
    </div>
  ),
};

/** The recommended spacing rhythm: 2 (field groups), 4 (within a section), 6, 8 (between sections). */
export const StackGapRhythm: StoryObj = {
  render: () => (
    <Row gap={6} align="start" wrap>
      {([2, 4, 6, 8] as const).map((gap) => (
        <Stack key={gap} gap={1} className="max-w-48">
          <span className="text-muted-foreground text-xs">gap={gap}</span>
          <Stack gap={gap}>
            <Box>A</Box>
            <Box>B</Box>
            <Box>C</Box>
          </Stack>
        </Stack>
      ))}
    </Row>
  ),
};

export const RowHorizontal: StoryObj = {
  render: () => (
    <Row gap={4}>
      <Box>Item 1</Box>
      <Box>Item 2</Box>
      <Box>Item 3</Box>
    </Row>
  ),
};

export const RowJustify: StoryObj = {
  render: () => (
    <Stack gap={3} className="w-full">
      {(['start', 'center', 'end', 'between'] as const).map((justify) => (
        <Row
          key={justify}
          gap={2}
          justify={justify}
          className="bg-muted/30 w-full rounded-md p-2"
        >
          <Box>A</Box>
          <Box>B</Box>
        </Row>
      ))}
    </Stack>
  ),
};

export const GridResponsive: StoryObj = {
  render: () => (
    <Grid cols={1} sm={2} lg={3} xl={4} gap={4}>
      {Array.from({ length: 8 }).map((_, i) => (
        <Box key={i}>Item {i + 1}</Box>
      ))}
    </Grid>
  ),
};

/** Use `as` to render a semantic element (here a `<ul>`) instead of a raw list tag on the page. */
export const PolymorphicAs: StoryObj = {
  render: () => (
    <Stack as="ul" gap={2} className="max-w-xs">
      {['First', 'Second', 'Third'].map((label) => (
        <li
          key={label}
          className="bg-primary/10 border-primary/20 rounded-md border p-3 text-sm"
        >
          {label}
        </li>
      ))}
    </Stack>
  ),
};

export const CenterComponent: StoryObj = {
  render: () => (
    <Center className="bg-muted/30 h-40 rounded-lg">
      <Box>Centered content</Box>
    </Center>
  ),
};

export const SpacerComponent: StoryObj = {
  render: () => (
    <Row gap={4} className="w-full">
      <Box>Left</Box>
      <Spacer />
      <Box>Right</Box>
    </Row>
  ),
};

export const NarrowContainerComponent: StoryObj = {
  render: () => (
    <div className="bg-muted/30 w-full py-8">
      <NarrowContainer>
        <Stack gap={4}>
          <Box>Form field 1</Box>
          <Box>Form field 2</Box>
          <Box>Form field 3</Box>
        </Stack>
      </NarrowContainer>
    </div>
  ),
};
