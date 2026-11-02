import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseProxy } from '../domains/proxies/parsing.ts';
import { ExitIpError } from '../domains/proxies/types.ts';
import { FakeExitIpChecker, Gate } from './fake-exit-ip.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('FakeExitIpChecker', () => {
  it('exits through 203.0.113.<last octet> unless told otherwise', async () => {
    const checker = new FakeExitIpChecker();
    expect(await checker.check(parseProxy('10.1.2.77:8080'))).toEqual({
      ip: '203.0.113.77',
      country: 'US',
      latencyMs: 42,
    });
    // A host name still gets an address of that range.
    const named = await checker.check(parseProxy('gate.example.com:8080'));
    expect(named.ip).toMatch(
      /^203\.0\.113\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4])$/,
    );
    expect((await checker.check(parseProxy('gate.example.com:9090'))).ip).toBe(
      named.ip,
    );
  });

  it('answers per host:port with a scripted IP, country and latency', async () => {
    const checker = new FakeExitIpChecker();
    checker.setIp('1.2.3.4:8080', '198.51.100.7', 'DE');
    checker.setIp('1.2.3.4:9090', '198.51.100.8', null, 7);
    expect(await checker.check(parseProxy('http://u:p@1.2.3.4:8080'))).toEqual({
      ip: '198.51.100.7',
      country: 'DE',
      latencyMs: 42,
    });
    expect(await checker.check(parseProxy('1.2.3.4:9090'))).toEqual({
      ip: '198.51.100.8',
      country: null,
      latencyMs: 7,
    });
    expect((await checker.check(parseProxy('1.2.3.4:7070'))).ip).toBe(
      '203.0.113.4',
    );
  });

  it('rejects with the scripted ExitIpError', async () => {
    const checker = new FakeExitIpChecker();
    checker.setError('[::1]:80', 'the proxy rejected the credentials');
    const failure = checker.check(parseProxy('[::1]:80'));
    await expect(failure).rejects.toBeInstanceOf(ExitIpError);
    await expect(failure).rejects.toThrow('the proxy rejected the credentials');
  });

  it('logs every call, in order', async () => {
    const checker = new FakeExitIpChecker();
    const a = parseProxy('1.2.3.4:80');
    const b = parseProxy('5.6.7.8:80');
    await checker.check(a);
    await checker.check(b);
    await checker.check(a);
    expect(checker.calls).toEqual([a, b, a]);
  });

  it('holds checks until the gate is released, and reads the script then', async () => {
    const checker = new FakeExitIpChecker();
    const gate = checker.hold();
    const first = checker.check(parseProxy('1.2.3.4:80'));
    const second = checker.check(parseProxy('5.6.7.8:80'));
    await checker.waitForCalls(2);
    expect(checker.inFlight).toBe(2);
    checker.setIp('1.2.3.4:80', '198.51.100.1');
    gate.release();
    expect((await first).ip).toBe('198.51.100.1');
    expect((await second).ip).toBe('203.0.113.8');
    expect(checker.inFlight).toBe(0);
    expect(checker.maxInFlight).toBe(2);
    // A released gate stays open.
    expect((await checker.check(parseProxy('9.9.9.9:80'))).ip).toBe(
      '203.0.113.9',
    );
  });

  it('takes delayMs per check', async () => {
    vi.useFakeTimers();
    const checker = new FakeExitIpChecker();
    checker.delayMs = 5000;
    let done = false;
    const check = (async () => {
      await checker.check(parseProxy('1.2.3.4:80'));
      done = true;
    })();
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await check;
    expect(done).toBe(true);
  });

  it('fails waitForCalls when the checks do not come', async () => {
    vi.useFakeTimers();
    const checker = new FakeExitIpChecker();
    const waiting = expect(checker.waitForCalls(1, 1000)).rejects.toThrow(
      'only 0 of 1 checks started',
    );
    await vi.advanceTimersByTimeAsync(1000);
    await waiting;
  });

  it('counts a check that throws as finished', async () => {
    const checker = new FakeExitIpChecker();
    checker.setError('1.2.3.4:80', 'boom');
    await expect(checker.check(parseProxy('1.2.3.4:80'))).rejects.toThrow(
      'boom',
    );
    expect(checker.inFlight).toBe(0);
  });
});

describe('Gate', () => {
  it('opens for every waiter, now and later', async () => {
    const gate = new Gate();
    expect(gate.isReleased).toBe(false);
    const waiting = [gate.wait(), gate.wait()];
    gate.release();
    await Promise.all(waiting);
    await gate.wait();
    expect(gate.isReleased).toBe(true);
  });
});
