import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileAttachment } from '@/app/features/shared/files/use-file-upload';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import { TaskModal } from './task-modal';

const seams = vi.hoisted(() => ({
  task: null as TaskDoc | null,
  update: vi.fn(),
  query: vi.fn(),
  metadata: vi.fn(),
}));

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string) => ({
    data:
      name === 'tasks/queries:getTask'
        ? { task: seams.task, canEdit: true, canCreate: true, canComment: true }
        : undefined,
    isLoading: false,
  }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: seams.query }),
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: (name: string) => ({
    mutateAsync:
      name === 'tasks/mutations:updateTask' ? seams.update : seams.metadata,
    isPending: false,
  }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({
    mutateAsync: vi.fn(async () => ({
      url: 'https://upload.test',
      method: 'POST',
    })),
    isPending: false,
  }),
}));
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useUploadPolicy: () => ({ policyEnabled: false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-1' } }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: () => ({
    members: [],
    agents: [],
    resolveActor: () => ({ name: 'Teammate' }),
  }),
  useAssignableActors: () => ({
    subjectEntries: [],
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
    members: [],
    automations: [],
    resolveActor: () => ({ name: 'Teammate' }),
  }),
}));
vi.mock('../hooks/use-task-subject-contract', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-task-subject-contract')
  >()),
  useTaskSubjectContract: () => null,
}));
vi.mock('./task-comments', () => ({
  TaskComments: () => null,
  TaskCommentComposer: () => null,
  TaskCommentComposerSkeleton: () => null,
}));
vi.mock('./task-timeline', () => ({ TaskTimeline: () => null }));
vi.mock('./task-dependencies', () => ({ TaskDependencies: () => null }));
vi.mock('./task-automation-badge', () => ({ TaskAutomationBadge: () => null }));
vi.mock('./task-subject-panel', () => ({ TaskSubjectPanel: () => null }));
vi.mock('@/app/features/shared/files/file-displays', () => ({
  FileAttachmentDisplay: ({
    attachment: value,
  }: {
    attachment: FileAttachment;
  }) => <span>{value.fileName}</span>,
}));

function attachment(name: string): FileAttachment {
  return {
    fileId: `${name}-ref`,
    fileName: `${name}.txt`,
    fileType: 'text/plain',
    fileSize: 1,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function openTask() {
  const body = () => (
    <TaskModal
      open
      taskId="task-1"
      organizationId="org-1"
      projectId="project-1"
      onOpenChange={vi.fn()}
    />
  );
  const view = render(body());
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error('Missing file input');
  return { ...view, input, readback: () => view.rerender(body()) };
}

async function finishUpload(
  pending: ReturnType<typeof deferred<Response>>,
  name: string,
) {
  await act(async () => {
    pending.resolve(Response.json({ storageId: `${name}-ref` }));
  });
}

function file(name: string) {
  return new File(['x'], `${name}.txt`, { type: 'text/plain' });
}

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  seams.task = {
    _id: 'task-1',
    _creationTime: 0,
    organizationId: 'org-1',
    projectId: 'project-1',
    title: 'Attachment concurrency',
    status: 'todo',
    rank: 'a0',
    number: 1,
    createdBy: 'user-1',
    createdByType: 'user',
    createdAt: 0,
    updatedAt: 0,
    attachments: [attachment('prior')],
  };
  seams.update.mockReset().mockImplementation(async (args) => {
    if (seams.task !== null) seams.task = { ...seams.task, ...args };
  });
  seams.query
    .mockReset()
    .mockImplementation(async () => ({ task: seams.task }));
  seams.metadata.mockReset().mockResolvedValue(undefined);
  vi.mocked(toast).mockClear();
});

describe('saved task attachment batches', () => {
  it('keeps both batches when the later upload response is ready first', async () => {
    const slow = deferred<Response>();
    const fast = deferred<Response>();
    const upload = vi.fn((_url: unknown, options?: RequestInit) =>
      options?.body instanceof File && options.body.name === 'slow.txt'
        ? slow.promise
        : fast.promise,
    );
    vi.stubGlobal('fetch', upload);
    const view = openTask();
    await view.user.upload(view.input, file('slow'));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await view.user.upload(view.input, file('fast'));
    await finishUpload(fast, 'fast');
    view.readback();
    await finishUpload(slow, 'slow');
    await waitFor(() => expect(seams.update).toHaveBeenCalledTimes(2));
    expect(
      seams.task?.attachments?.map((entry) => entry.fileId).sort(),
    ).toEqual(['fast-ref', 'prior-ref', 'slow-ref']);
    view.readback();
    expect(screen.getByText('prior.txt')).toBeInTheDocument();
    expect(screen.getByText('fast.txt')).toBeInTheDocument();
    expect(screen.getByText('slow.txt')).toBeInTheDocument();
  });

  it('does not resurrect an attachment removed while an upload waits', async () => {
    const slow = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => slow.promise),
    );
    const view = openTask();
    await view.user.upload(view.input, file('slow'));
    await view.user.click(
      screen.getByRole('button', { name: 'Remove attachment' }),
    );
    view.readback();
    await finishUpload(slow, 'slow');
    await waitFor(() => expect(seams.update).toHaveBeenCalledTimes(2));
    expect(seams.task?.attachments).toEqual([attachment('slow')]);
    view.readback();
    expect(screen.queryByText('prior.txt')).not.toBeInTheDocument();
    expect(screen.getByText('slow.txt')).toBeInTheDocument();
  });

  it('merges with accepted intervening changes even before UI readback', async () => {
    const slow = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => slow.promise),
    );
    const view = openTask();
    await view.user.upload(view.input, file('slow'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    if (seams.task !== null)
      seams.task = { ...seams.task, attachments: [attachment('fast')] };
    await finishUpload(slow, 'slow');
    await waitFor(() => expect(seams.update).toHaveBeenCalledTimes(1));
    expect(seams.task?.attachments).toEqual([
      attachment('fast'),
      attachment('slow'),
    ]);
  });

  it('does not start the next batch until the preceding save is accepted', async () => {
    const save = deferred<void>();
    seams.update.mockImplementationOnce(async (args) => {
      await save.promise;
      if (seams.task !== null) seams.task = { ...seams.task, ...args };
    });
    const upload = vi.fn(async (_url: unknown, options?: RequestInit) => {
      if (!(options?.body instanceof File))
        throw new Error('Missing upload file');
      return Response.json({
        storageId: `${options.body.name.split('.')[0]}-ref`,
      });
    });
    vi.stubGlobal('fetch', upload);
    const view = openTask();
    await view.user.upload(view.input, file('first'));
    await waitFor(() => expect(seams.update).toHaveBeenCalledTimes(1));
    await view.user.upload(view.input, file('second'));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(seams.update).toHaveBeenCalledTimes(1);
    await act(async () => save.resolve());
    await waitFor(() => expect(seams.update).toHaveBeenCalledTimes(2));
    expect(seams.task?.attachments).toEqual([
      attachment('prior'),
      attachment('first'),
      attachment('second'),
    ]);
  });

  it('rejects a file re-selected while its upload is in flight', async () => {
    const slow = deferred<Response>();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1;
        return calls === 1
          ? slow.promise
          : Promise.resolve(Response.json({ storageId: `slow-ref-${calls}` }));
      }),
    );
    const view = openTask();
    await view.user.upload(view.input, file('slow'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await view.user.upload(view.input, file('slow'));
    await act(async () => {
      slow.resolve(Response.json({ storageId: 'slow-ref-1' }));
    });
    await waitFor(() => expect(seams.update).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        seams.task?.attachments?.filter((entry) =>
          entry.fileId.startsWith('slow-ref'),
        ),
      ).toHaveLength(1),
    );
    expect(
      vi
        .mocked(toast)
        .mock.calls.some(
          ([arg]) =>
            typeof arg?.title === 'string' && /duplicate/i.test(arg.title),
        ),
    ).toBe(true);
  });

  it('shows an uploading row for a second selection right away', async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending.promise),
    );
    const view = openTask();
    await view.user.upload(view.input, file('slow'));
    await waitFor(() =>
      expect(screen.getAllByText('Uploading…')).toHaveLength(1),
    );
    await view.user.upload(view.input, file('other'));
    await waitFor(() =>
      expect(screen.getAllByText('Uploading…')).toHaveLength(2),
    );
  });

  it('sends a removal without waiting for an unrelated upload', async () => {
    const slow = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => slow.promise),
    );
    const view = openTask();
    await view.user.upload(view.input, file('slow'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await view.user.click(
      screen.getByRole('button', { name: 'Remove attachment' }),
    );
    await waitFor(() => expect(seams.update).toHaveBeenCalledTimes(1));
    expect(seams.task?.attachments).toEqual([]);
  });

  it('reports a failed save once and lets the next batch proceed', async () => {
    seams.update.mockRejectedValueOnce(new Error('Save refused'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, options?: RequestInit) => {
        if (!(options?.body instanceof File))
          throw new Error('Missing upload file');
        return Response.json({
          storageId: `${options.body.name.split('.')[0]}-ref`,
        });
      }),
    );
    const view = openTask();
    await view.user.upload(view.input, file('first'));
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    await view.user.upload(view.input, file('second'));
    await waitFor(() => expect(seams.update).toHaveBeenCalledTimes(2));
    expect(seams.task?.attachments).toEqual([
      attachment('prior'),
      attachment('second'),
    ]);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('keeps the sequential-upload control', async () => {
    const view = openTask();
    for (const name of ['first', 'second']) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ storageId: `${name}-ref` })),
      );
      await view.user.upload(view.input, file(name));
      await waitFor(() =>
        expect(seams.task?.attachments).toContainEqual(attachment(name)),
      );
      view.readback();
    }
    expect(seams.task?.attachments).toEqual([
      attachment('prior'),
      attachment('first'),
      attachment('second'),
    ]);
  });
});
