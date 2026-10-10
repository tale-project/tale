// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { memo } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../data/chat-backend', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../data/chat-backend')>();
  return {
    ...original,
    useThreadProjectMove: () => ({ available: true, move: vi.fn() }),
  };
});

const { ThreadDndProvider, useProjectDropZone, useThreadDraggable } =
  await import('./thread-dnd');

describe('ThreadDndProvider', () => {
  // dnd-kit memoises a sensor on its options' identity. Options written
  // inline were a new object each render, which gave DndContext new
  // activators and a new context, so every draggable row and every drop zone
  // re-rendered with each render of the panel around them.
  it('leaves its rows and drop zones alone when the panel re-renders', () => {
    const renders = { row: 0, zone: 0 };
    const Row = memo(function Row() {
      renders.row += 1;
      const { setNodeRef } = useThreadDraggable({
        id: 't1',
        projectId: null,
        title: 'Quarterly report',
      });
      return <li ref={setNodeRef}>Quarterly report</li>;
    });
    const Zone = memo(function Zone() {
      renders.zone += 1;
      const { setNodeRef } = useProjectDropZone('p1');
      return <li ref={setNodeRef}>Website relaunch</li>;
    });
    const tree = (revision: number) => (
      <ThreadDndProvider organizationId="org-1">
        <ul data-revision={revision}>
          <Row />
          <Zone />
        </ul>
      </ThreadDndProvider>
    );

    const view = render(tree(0));
    const settled = { ...renders };
    for (let revision = 1; revision <= 3; revision++) {
      view.rerender(tree(revision));
    }

    expect(renders).toEqual(settled);
  });
});
