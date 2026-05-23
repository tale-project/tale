import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  Center,
  Grid,
  HStack,
  NarrowContainer,
  Spacer,
  Stack,
  VStack,
} from './layout';

const meta: Meta = {
  title: 'Layout/Primitives',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Layout primitive components for building consistent layouts.',
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

export const StackComponent: StoryObj = {
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

export const HStackComponent: StoryObj = {
  render: () => (
    <HStack gap={4}>
      <Box>Item 1</Box>
      <Box>Item 2</Box>
      <Box>Item 3</Box>
    </HStack>
  ),
};

export const VStackComponent: StoryObj = {
  render: () => (
    <div className="max-w-xs">
      <VStack gap={4}>
        <Box>Item 1</Box>
        <Box>Item 2</Box>
        <Box>Item 3</Box>
      </VStack>
    </div>
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

export const CenterComponent: StoryObj = {
  render: () => (
    <Center className="bg-muted/30 h-40 rounded-lg">
      <Box>Centered content</Box>
    </Center>
  ),
};

export const SpacerComponent: StoryObj = {
  render: () => (
    <HStack gap={4} className="w-full">
      <Box>Left</Box>
      <Spacer />
      <Box>Right</Box>
    </HStack>
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
