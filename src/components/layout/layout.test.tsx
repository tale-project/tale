import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import {
  Center,
  Grid,
  HStack,
  NarrowContainer,
  Row,
  Spacer,
  Stack,
  VStack,
} from './layout';

describe('Stack', () => {
  it('renders a vertical flex container with the default gap', () => {
    const { container } = render(
      <Stack>
        <p>Item 1</p>
        <p>Item 2</p>
      </Stack>,
    );
    const el = container.firstElementChild;
    expect(el?.tagName).toBe('DIV');
    expect(el).toHaveClass('flex', 'flex-col', 'gap-4', 'items-stretch');
  });

  it('applies gap, align, justify and wrap from the shared scale', () => {
    const { container } = render(
      <Stack gap={2} align="center" justify="between" wrap>
        <p>Item</p>
      </Stack>,
    );
    expect(container.firstElementChild).toHaveClass(
      'gap-2',
      'items-center',
      'justify-between',
      'flex-wrap',
    );
  });

  it('renders a semantic element via `as`', () => {
    const { container } = render(
      <Stack as="ul">
        <li>One</li>
        <li>Two</li>
      </Stack>,
    );
    const el = container.firstElementChild;
    expect(el?.tagName).toBe('UL');
    expect(el).toHaveClass('flex', 'flex-col');
  });

  it('merges layout classes onto the child via `asChild`', () => {
    const { getByTestId } = render(
      <Stack gap={2} asChild>
        <section data-testid="merged">content</section>
      </Stack>,
    );
    const el = getByTestId('merged');
    expect(el.tagName).toBe('SECTION');
    expect(el).toHaveClass('flex', 'flex-col', 'gap-2');
  });

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

describe('Row', () => {
  it('renders a horizontal flex container centered by default', () => {
    const { container } = render(
      <Row>
        <p>Left</p>
        <p>Right</p>
      </Row>,
    );
    const el = container.firstElementChild;
    expect(el?.tagName).toBe('DIV');
    expect(el).toHaveClass('flex', 'flex-row', 'gap-4', 'items-center');
  });

  it('applies justify and wrap', () => {
    const { container } = render(
      <Row justify="between" wrap>
        <p>A</p>
      </Row>,
    );
    expect(container.firstElementChild).toHaveClass(
      'justify-between',
      'flex-wrap',
    );
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Row>
          <p>Left</p>
          <p>Right</p>
        </Row>,
      );
      await checkAccessibility(container);
    });
  });
});

describe('HStack (deprecated alias of Row)', () => {
  it('is the Row component', () => {
    expect(HStack).toBe(Row);
  });

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

describe('VStack (deprecated alias of Stack)', () => {
  it('is the Stack component', () => {
    expect(VStack).toBe(Stack);
  });

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
  it('applies columns and gap', () => {
    const { container } = render(
      <Grid cols={2} gap={6}>
        <p>Cell 1</p>
        <p>Cell 2</p>
      </Grid>,
    );
    expect(container.firstElementChild).toHaveClass(
      'grid',
      'grid-cols-2',
      'gap-6',
    );
  });

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
        <Row>
          <p>Left</p>
          <Spacer />
          <p>Right</p>
        </Row>,
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
