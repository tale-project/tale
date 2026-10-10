import { CodeDiff } from '@tale/ui/code-diff';

const V4 = `name: Triage issues
description: Sort new issues by priority
inputs:
  type: object
  properties:
    owner:
      type: string
    repo:
      type: string
    limit:
      type: number
nodes:
  - id: issues
    type: github.list_issues
    input:
      owner: "{{ input.owner }}"
      repo: "{{ input.repo }}"
      state: open
  - id: open_issues
    type: transform
    code: return nodes.issues.output.issues.slice(0, input.limit)
  - id: score
    type: llm
    model: claude-haiku-4-5
    each: "{{ nodes.open_issues.output }}"
    prompt: |
      Score this issue from 1 to 5.
      Say why in one sentence.
  - id: report
    type: transform
    code: return nodes.score.output
output: "{{ nodes.report.output }}"
`;

const V5 = `name: Triage issues
description: Sort and label new issues by priority
inputs:
  type: object
  properties:
    owner:
      type: string
    repo:
      type: string
    limit:
      type: number
nodes:
  - id: issues
    type: github.list_issues
    input:
      owner: "{{ input.owner }}"
      repo: "{{ input.repo }}"
      state: open
  - id: open_issues
    type: transform
    code: return nodes.issues.output.issues.slice(0, input.limit)
  - id: score
    type: llm
    model: claude-sonnet-4-5
    each: "{{ nodes.open_issues.output }}"
    prompt: |
      Score this issue from 1 to 5.
      Say why in one sentence.
      Suggest one label.
  - id: report
    type: transform
    code: return nodes.score.output
output: "{{ nodes.report.output }}"
`;

export default function CodeDiffYaml() {
  return (
    <div className="bg-card w-full rounded-lg border p-3">
      <CodeDiff
        before={V4}
        after={V5}
        language="yaml"
        templates
        beforeLabel="v4"
        afterLabel="v5"
        aria-label="Changes from v4 to v5"
      />
    </div>
  );
}
