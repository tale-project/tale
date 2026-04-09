import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import {
  Stack,
  HStack,
  VStack,
  Grid,
  Center,
  Spacer,
  NarrowContainer,
} from './layout';

describe('Stack', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Stack>
          <p>Item 1</p>
          <p>Item 2</p>
        </Stack>,
      );
      await checkAccessibility(container);
    });
  });
});

describe('HStack', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <HStack>
          <p>Left</p>
          <p>Right</p>
        </HStack>,
      );
      await checkAccessibility(container);
    });
  });
});

describe('VStack', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <VStack>
          <p>Top</p>
          <p>Bottom</p>
        </VStack>,
      );
      await checkAccessibility(container);
    });
  });
});

describe('Grid', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Grid cols={2}>
          <p>Cell 1</p>
          <p>Cell 2</p>
        </Grid>,
      );
      await checkAccessibility(container);
    });
  });
});

describe('Center', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Center>
          <p>Centered content</p>
        </Center>,
      );
      await checkAccessibility(container);
    });
  });
});

describe('Spacer', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <HStack>
          <p>Left</p>
          <Spacer />
          <p>Right</p>
        </HStack>,
      );
      await checkAccessibility(container);
    });
  });
});

describe('NarrowContainer', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <NarrowContainer>
          <p>Narrow content</p>
        </NarrowContainer>,
      );
      await checkAccessibility(container);
    });
  });
});
