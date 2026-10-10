import { JsonViewer } from '@tale/ui/json-viewer';

const RUN = {
  runId: 'run_7f3e2a',
  status: 'succeeded',
  input: { repository: 'tale-project/tale', limit: 20, labels: ['bug'] },
  output: { reviewed: 12, actionable: [{ title: 'Login fails on Safari' }] },
};

export default function JsonViewerDemo() {
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <JsonViewer
        data={RUN}
        collapsed={1}
        enableClipboard
        className="border-border rounded-lg border"
      />
      <JsonViewer data={null} className="border-border rounded-lg border" />
    </div>
  );
}
