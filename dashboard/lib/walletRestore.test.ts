import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStorage, writeSession } from './session';

const ADDR = '0x6ff7cdc54d057013010bb9e6984bcc9fcd44be22';

function mkProvider(accounts: string[] = [ADDR], extra: Record<string, unknown> = {}) {
  const request = vi.fn(async ({ method }: { method: string }): Promise<unknown> => {
    if (method === 'eth_accounts') return accounts;
    if (method === 'eth_requestAccounts') return accounts;
    if (method === 'eth_chainId') return '0xaa044c';
    if (method === 'personal_sign') throw Object.assign(new Error('no'), { code: 4001 });
    return null;
  });
  return { request, on: vi.fn(), removeListener: vi.fn(), ...extra };
}

let win: any;
async function load() {
  vi.resetModules();
  return import('./wallet');
}

beforeEach(() => {
  const et = new EventTarget();
  win = {
    addEventListener: et.addEventListener.bind(et),
    removeEventListener: et.removeEventListener.bind(et),
    dispatchEvent: et.dispatchEvent.bind(et),
    sessionStorage: memoryStorage(),
    location: { origin: 'https://nairaguard.space' },
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('localStorage', memoryStorage());
});
afterEach(() => vi.unstubAllGlobals());

function announce(rdns: string, provider: unknown) {
  win.addEventListener('eip6963:requestProvider', () => {
    win.dispatchEvent(Object.assign(new Event('eip6963:announceProvider'), { detail: { info: { uuid: rdns, name: rdns, icon: '', rdns }, provider } }));
  });
}
const signed = () => writeSession(win.sessionStorage, ADDR, 11142220);

describe('wallet restore after reload', () => {
  it('restores an EIP-6963 wallet (OKX) by stored rdns with eth_accounts only', async () => {
    const okx = mkProvider();
    announce('com.okex.wallet', okx);
    localStorage.setItem('ng.lastConnector', JSON.stringify({ kind: 'injected', label: 'OKX Wallet', rdns: 'com.okex.wallet' }));
    signed();
    const w = await load();
    await w.boot();
    expect(w.getProvider()).toBe(okx);
    expect(w.sessionReady()).toBe(true);
    const methods = okx.request.mock.calls.map((c) => c[0].method);
    expect(methods).toContain('eth_accounts');
    expect(methods).not.toContain('eth_requestAccounts');
    expect(methods).not.toContain('personal_sign');
  });

  it('falls back to window.okxwallet when OKX does not announce', async () => {
    const okx = mkProvider();
    win.okxwallet = okx;
    localStorage.setItem('ng.lastConnector', JSON.stringify({ kind: 'injected', label: 'OKX Wallet', rdns: 'com.okex.wallet' }));
    signed();
    const w = await load();
    expect(await w.findInjectedProvider('com.okex.wallet', 10)).toBe(okx);
    await w.boot();
    expect(w.getProvider()).toBe(okx);
  });

  it('does not restore without a signed session (sign gate kept)', async () => {
    const okx = mkProvider();
    announce('com.okex.wallet', okx);
    localStorage.setItem('ng.lastConnector', JSON.stringify({ kind: 'injected', label: 'OKX Wallet', rdns: 'com.okex.wallet' }));
    const w = await load();
    await w.boot();
    expect(w.sessionReady()).toBe(false);
    expect(okx.request.mock.calls.map((c) => c[0].method)).not.toContain('personal_sign');
  });

  it('does not silently log in after explicit disconnect', async () => {
    const okx = mkProvider();
    announce('com.okex.wallet', okx);
    signed();
    let w = await load();
    win.sessionStorage = memoryStorage();
    // connect then disconnect
    writeSession(win.sessionStorage, ADDR, 11142220);
    localStorage.setItem('ng.lastConnector', JSON.stringify({ kind: 'injected', label: 'OKX Wallet', rdns: 'com.okex.wallet' }));
    await w.boot();
    await w.disconnectWallet();
    expect(localStorage.getItem('ng.lastConnector')).toBeNull();
    w = await load();
    await w.boot();
    expect(w.sessionReady()).toBe(false);
  });

  it('legacy entries without rdns still restore via window.ethereum', async () => {
    const eth = mkProvider();
    win.ethereum = eth;
    localStorage.setItem('ng.lastConnector', JSON.stringify({ kind: 'injected', label: 'Browser wallet' }));
    signed();
    const w = await load();
    await w.boot();
    expect(w.getProvider()).toBe(eth);
    expect(w.sessionReady()).toBe(true);
  });

  it('MiniPay auto-connect is unchanged (no signature, ignores stored choice)', async () => {
    const mp = mkProvider([ADDR], { isMiniPay: true });
    win.ethereum = mp;
    localStorage.setItem('ng.lastConnector', JSON.stringify({ kind: 'injected', rdns: 'com.okex.wallet' }));
    const w = await load();
    await w.boot();
    expect(w.getProvider()).toBe(mp);
    expect(w.sessionReady()).toBe(true);
    expect(mp.request.mock.calls.map((c) => c[0].method)).toContain('eth_requestAccounts');
  });

  it('connectInjected persists the rdns', async () => {
    const okx = mkProvider();
    okx.request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'personal_sign') return '0x' + '1'.repeat(130);
      if (method === 'eth_chainId') return '0xaa044c';
      return [ADDR];
    });
    const w = await load();
    await w.connectInjected({ uuid: 'u', name: 'OKX Wallet', icon: '', rdns: 'com.okex.wallet', provider: okx });
    expect(JSON.parse(localStorage.getItem('ng.lastConnector')!).rdns).toBe('com.okex.wallet');
  });
});
