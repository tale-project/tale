// A `Manager` for tests of the HTTP routes: every method fails the test unless
// the test gives it, so a route that calls something it should not is caught.
//
//     const manager = strictManager({ session: vi.fn(() => session({ id: 4 })) });
//
// The objects of the API (`session`, `proxy`, …) are built by
// `tests/utils/fixtures.ts`, which the tests of the page use too.

import type { Manager } from '../domains/sessions/manager.ts';

function unexpected(name: string): () => never {
  return () => {
    throw new Error(`manager.${name} was called; this test did not expect it`);
  };
}

export function strictManager(overrides: Partial<Manager> = {}): Manager {
  return {
    meta: unexpected('meta'),
    settings: unexpected('settings'),
    updateSettings: unexpected('updateSettings'),
    listSecrets: unexpected('listSecrets'),
    getSecret: unexpected('getSecret'),
    createSecret: unexpected('createSecret'),
    updateSecret: unexpected('updateSecret'),
    deleteSecret: unexpected('deleteSecret'),
    listProxies: unexpected('listProxies'),
    countProxies: unexpected('countProxies'),
    proxy: unexpected('proxy'),
    addProxy: unexpected('addProxy'),
    importProxies: unexpected('importProxies'),
    deleteProxy: unexpected('deleteProxy'),
    checkProxy: unexpected('checkProxy'),
    checkAllProxies: unexpected('checkAllProxies'),
    listSessions: unexpected('listSessions'),
    countSessions: unexpected('countSessions'),
    session: unexpected('session'),
    exportProxies: unexpected('exportProxies'),
    remote: unexpected('remote'),
    showSession: unexpected('showSession'),
    typeIntoSession: unexpected('typeIntoSession'),
    createSession: unexpected('createSession'),
    renameSession: unexpected('renameSession'),
    startSession: unexpected('startSession'),
    stopSession: unexpected('stopSession'),
    rotateSession: unexpected('rotateSession'),
    restartSession: unexpected('restartSession'),
    checkSessionIp: unexpected('checkSessionIp'),
    deleteSession: unexpected('deleteSession'),
    recheckRunning: unexpected('recheckRunning'),
    watchExitIps: unexpected('watchExitIps'),
    close: unexpected('close'),
    ...overrides,
  };
}
