import * as client from 'prom-client';
import { afterEach, describe, expect, test } from 'vitest';
import { parse } from 'yaml';

import {
  registerSlaTargetMetrics,
  renderSlaPrometheusRules,
  slaAlertName,
  slaRecordingRuleName,
  slaRulesResponse,
  SLA_TARGETS,
  type SlaTarget,
} from './sla-targets';

afterEach(() => {
  client.register.clear();
});

describe('SLA_TARGETS', () => {
  test('covers the dialog (1s) and long-operation (40s) budgets', () => {
    const byId = new Map(SLA_TARGETS.map((t) => [t.id, t]));
    expect(byId.get('dialog_ttft')?.targetSeconds).toBe(1);
    expect(byId.get('long_operation')?.targetSeconds).toBe(40);
  });

  test('every target is well-formed', () => {
    for (const t of SLA_TARGETS) {
      expect(t.targetSeconds).toBeGreaterThan(0);
      expect(t.metric).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(['mean', 'p95', 'p99']).toContain(t.statistic);
    }
  });

  test('ids are unique', () => {
    const ids = SLA_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('renderSlaPrometheusRules', () => {
  test('emits a parseable rules document with recording + alert groups', () => {
    const doc = parse(renderSlaPrometheusRules()) as {
      groups: { name: string; rules: Record<string, unknown>[] }[];
    };
    const names = doc.groups.map((g) => g.name);
    expect(names).toContain('tale-sla-recording');
    expect(names).toContain('tale-sla-alerts');
  });

  test('mean targets aggregate via rate(sum)/rate(count) and alert on the budget', () => {
    const doc = parse(renderSlaPrometheusRules()) as {
      groups: { name: string; rules: Record<string, string>[] }[];
    };
    const recording = doc.groups.find((g) => g.name === 'tale-sla-recording');
    const alerts = doc.groups.find((g) => g.name === 'tale-sla-alerts');

    const dialog = SLA_TARGETS.find((t) => t.id === 'dialog_ttft') as SlaTarget;
    const recordRule = recording?.rules.find(
      (r) => r.record === slaRecordingRuleName(dialog),
    );
    expect(recordRule?.expr).toBe(
      'rate(tale_dialog_ttft_seconds_sum[30m]) / rate(tale_dialog_ttft_seconds_count[30m])',
    );

    const alertRule = alerts?.rules.find(
      (r) => r.alert === slaAlertName(dialog),
    );
    expect(alertRule?.alert).toBe('TaleSlaDialogTtftBreached');
    expect(alertRule?.expr).toBe(`${slaRecordingRuleName(dialog)} > 1`);
    expect(alertRule?.for).toBe('15m');
  });

  test('percentile targets aggregate via histogram_quantile (edge case)', () => {
    const p95: SlaTarget = {
      id: 'p95_case',
      title: 'P95 case',
      description: 'A percentile budget.',
      statistic: 'p95',
      targetSeconds: 2,
      window: '5m',
      alertFor: '10m',
      severity: 'page',
      metric: 'tale_demo_seconds',
    };
    const doc = parse(renderSlaPrometheusRules([p95])) as {
      groups: { name: string; rules: Record<string, string>[] }[];
    };
    const recordRule = doc.groups[0].rules[0];
    expect(recordRule.expr).toBe(
      'histogram_quantile(0.95, sum by (le) (rate(tale_demo_seconds_bucket[5m])))',
    );
  });

  test('empty target list yields an empty document (edge case)', () => {
    const doc = parse(renderSlaPrometheusRules([])) as { groups: unknown[] };
    expect(doc.groups).toEqual([]);
  });

  test('duplicate ids are rejected (error case)', () => {
    const dup = SLA_TARGETS[0];
    expect(() => renderSlaPrometheusRules([dup, dup])).toThrow(/Duplicate/);
  });
});

describe('registerSlaTargetMetrics', () => {
  test('exposes tale_sla_target_seconds with the budget values', async () => {
    registerSlaTargetMetrics();
    const body = await client.register.metrics();
    expect(body).toContain('tale_sla_target_seconds');
    expect(body).toMatch(
      /tale_sla_target_seconds\{sla="dialog_ttft",statistic="mean"\} 1\b/,
    );
    expect(body).toMatch(
      /tale_sla_target_seconds\{sla="long_operation",statistic="mean"\} 40\b/,
    );
  });

  test('rejects duplicate ids (error case)', () => {
    const dup = SLA_TARGETS[0];
    expect(() => registerSlaTargetMetrics(client.register, [dup, dup])).toThrow(
      /Duplicate/,
    );
  });
});

describe('slaRulesResponse', () => {
  test('serves the rules as YAML', async () => {
    const res = slaRulesResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('yaml');
    const body = await res.text();
    expect(body).toContain('tale-sla-alerts');
  });
});
