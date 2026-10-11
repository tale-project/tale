import type { FlowRunOverlay } from '@tale/ui/flow/playback';
import type { FlowGraph } from '@tale/ui/flow/types';
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { Braces, Mail, Send } from 'lucide-react';
import { useState } from 'react';

const GRAPH: FlowGraph = {
  nodes: [
    {
      id: '__start',
      kind: 'entry',
      triggers: [],
      inputs: [
        { id: 'order', label: 'order', detail: 'an object', code: true },
      ],
    },
    {
      id: 'fetch',
      kind: 'step',
      label: 'Fetch customer',
      icon: Send,
      typeLabel: 'HTTP · Get',
    },
    {
      id: 'price',
      kind: 'step',
      label: 'Price the order',
      icon: Braces,
      typeLabel: 'Transform',
      reads: [{ id: 'fetch', label: 'Fetch customer' }],
    },
    {
      id: 'receipt',
      kind: 'step',
      label: 'Send receipt',
      icon: Mail,
      typeLabel: 'Gmail · Send message',
      reads: [{ id: 'price', label: 'Price the order' }],
    },
    {
      id: 'log',
      kind: 'step',
      label: 'Log',
      icon: Braces,
      typeLabel: 'Transform',
      reads: [{ id: 'receipt', label: 'Send receipt' }],
    },
    {
      id: '__end',
      kind: 'exit',
      outputs: [{ id: 'price', label: 'The output of Price the order' }],
    },
  ],
  edges: [
    { id: 's>fetch', source: '__start', target: 'fetch', kind: 'entry' },
    { id: 'fetch>price', source: 'fetch', target: 'price', kind: 'data' },
    { id: 'price>receipt', source: 'price', target: 'receipt', kind: 'data' },
    { id: 'receipt>log', source: 'receipt', target: 'log', kind: 'data' },
    { id: 'log>end', source: 'log', target: '__end', kind: 'exit' },
  ],
};

// A test's run: the customer comes from the test, the price from an
// earlier run, the receipt fails on purpose, and the log is left out.
const TEST_RUN: FlowRunOverlay = {
  finished: true,
  nodes: {
    __start: { state: 'succeeded', detail: 'Test · Big order' },
    fetch: {
      state: 'succeeded',
      detail: '2 ms',
      substitute: { kind: 'simulated', label: 'Simulated output' },
    },
    price: {
      state: 'succeeded',
      detail: '1 ms',
      substitute: { kind: 'pinned', label: 'Pinned output' },
    },
    receipt: {
      state: 'failed',
      reason: 'The mail server refused the message',
      substitute: { kind: 'failure', label: 'Simulated failure' },
    },
    log: {
      state: 'not-run',
      substitute: { kind: 'left-out', label: 'Left out of this test' },
    },
    __end: { state: 'failed', detail: 'Failed at Send receipt' },
  },
};

// A preview reads for real and holds back what it would write.
const PREVIEW: FlowRunOverlay = {
  finished: true,
  nodes: {
    __start: { state: 'succeeded', detail: 'Preview with real data' },
    fetch: { state: 'succeeded', detail: '0.4 s' },
    price: { state: 'succeeded', detail: '3 ms' },
    receipt: {
      state: 'succeeded',
      detail: '1 ms',
      substitute: { kind: 'held', label: 'Not sent — preview' },
    },
    log: { state: 'succeeded', detail: '2 ms' },
    __end: { state: 'succeeded', detail: 'Succeeded in 0.4 s' },
  },
};

export default function FlowStandInsDemo() {
  const [run, setRun] = useState('test');
  return (
    <div className="flex w-full flex-col gap-3">
      <SegmentedControl
        aria-label="Run"
        value={run}
        onValueChange={setRun}
        options={[
          { value: 'test', label: 'A test' },
          { value: 'preview', label: 'A preview' },
        ]}
      />
      <div className="h-[34rem]">
        <WorkflowCanvas
          graph={GRAPH}
          aria-label={
            run === 'test'
              ? 'Send a receipt, test run'
              : 'Send a receipt, preview'
          }
          layoutKey="stand-ins"
          framed
          overlay={run === 'test' ? TEST_RUN : PREVIEW}
          focusFailure={false}
        />
      </div>
    </div>
  );
}
