import type { Meta, StoryObj } from '@storybook/react';
import { Stack, HStack, VStack, Grid, Center, Spacer, NarrowContainer } from './layout';

const meta: Meta = {
  title: 'Layout/Primitives',
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: `
Layout primitive components for building consistent layouts.

## Usage
\`\`\`tsx
import { Stack, HStack, Grid } from '@/app/components/ui/layout/layout';

<Stack gap={4}>
  <div>Item 1</div>
  <div>Item 2</div>
</Stack>

<HStack gap={2} align="center">
  <div>Left</div>
  <Spacer />
  <div>Right</div>
</HStack>

<Grid cols={3} gap={4}>
  {items.map(item => <Card key={item.id} />)}
</Grid>
\`\`\`
        `,
      },
    },
  },
};

export default meta;

const Box = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
  <div className={`bg-primary/10 border border-primary/20 rounded-md p-3 text-sm ${className}`}>
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
  parameters: {
    docs: {
      description: {
        story: 'Stack arranges children vertically with consistent spacing.',
      },
    },
  },
};

export const StackGaps: StoryObj = {
  render: () => (
    <div className="flex gap-8">
      {([1, 2, 4, 6, 8] as const).map((gap) => (
        <div key={gap}>
          <p className="text-xs text-muted-foreground mb-2">gap={gap}</p>
          <Stack gap={gap}>
            <Box className="h-8 w-16" />
            <Box className="h-8 w-16" />
            <Box className="h-8 w-16" />
          </Stack>
        </div>
      ))}
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
  parameters: {
    docs: {
      description: {
        story: 'HStack arranges children horizontally with consistent spacing.',
      },
    },
  },
};

export const HStackAlignment: StoryObj = {
  render: () => (
    <Stack gap={6}>
      {(['start', 'center', 'end', 'stretch', 'baseline'] as const).map((align) => (
        <div key={align}>
          <p className="text-xs text-muted-foreground mb-2">align="{align}"</p>
          <HStack gap={4} align={align} className="bg-muted/30 p-2 rounded h-20">
            <Box className="h-8">Short</Box>
            <Box className="h-12">Medium</Box>
            <Box className="h-16">Tall</Box>
          </HStack>
        </div>
      ))}
    </Stack>
  ),
};

export const HStackJustify: StoryObj = {
  render: () => (
    <Stack gap={6}>
      {(['start', 'center', 'end', 'between', 'around', 'evenly'] as const).map((justify) => (
        <div key={justify}>
          <p className="text-xs text-muted-foreground mb-2">justify="{justify}"</p>
          <HStack gap={4} justify={justify} className="bg-muted/30 p-2 rounded">
            <Box className="w-16">1</Box>
            <Box className="w-16">2</Box>
            <Box className="w-16">3</Box>
          </HStack>
        </div>
      ))}
    </Stack>
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
  parameters: {
    docs: {
      description: {
        story: 'VStack is a flex-column variant for vertical layouts.',
      },
    },
  },
};

export const GridComponent: StoryObj = {
  render: () => (
    <Grid cols={3} gap={4}>
      {Array.from({ length: 9 }).map((_, i) => (
        <Box key={i}>Item {i + 1}</Box>
      ))}
    </Grid>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Grid creates a responsive grid layout.',
      },
    },
  },
};

export const GridResponsive: StoryObj = {
  render: () => (
    <Grid cols={1} sm={2} lg={3} xl={4} gap={4}>
      {Array.from({ length: 8 }).map((_, i) => (
        <Box key={i}>Item {i + 1}</Box>
      ))}
    </Grid>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Grid supports responsive column counts at different breakpoints.',
      },
    },
  },
};

export const CenterComponent: StoryObj = {
  render: () => (
    <Center className="h-40 bg-muted/30 rounded-lg">
      <Box>Centered Content</Box>
    </Center>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Center centers content both horizontally and vertically.',
      },
    },
  },
};

export const SpacerComponent: StoryObj = {
  render: () => (
    <HStack gap={4} className="w-full">
      <Box>Left</Box>
      <Spacer />
      <Box>Right</Box>
    </HStack>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Spacer expands to fill available space.',
      },
    },
  },
};

export const NarrowContainerComponent: StoryObj = {
  render: () => (
    <div className="w-full bg-muted/30 py-8">
      <NarrowContainer>
        <Stack gap={4}>
          <Box>Form field 1</Box>
          <Box>Form field 2</Box>
          <Box>Form field 3</Box>
        </Stack>
      </NarrowContainer>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: 'NarrowContainer provides a max-width centered container for forms.',
      },
    },
  },
};

export const CombinedExample: StoryObj = {
  render: () => (
    <Stack gap={6}>
      <HStack justify="between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <HStack gap={2}>
          <Box className="h-9 w-20">Filter</Box>
          <Box className="h-9 w-24">+ Add New</Box>
        </HStack>
      </HStack>
      <Grid cols={1} sm={2} lg={3} gap={4}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Box key={i} className="p-4">
            <Stack gap={2}>
              <div className="h-4 w-3/4 bg-primary/20 rounded" />
              <div className="h-3 w-1/2 bg-primary/10 rounded" />
            </Stack>
          </Box>
        ))}
      </Grid>
    </Stack>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Example combining Stack, HStack, and Grid for a typical dashboard layout.',
      },
    },
  },
};
