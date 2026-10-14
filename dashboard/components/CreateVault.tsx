'use client';

import { useState } from 'react';
import { parseUnits } from 'viem';
import { Button } from './Button';
import { ErrorBanner } from './ErrorBanner';
import {
  PRESETS, type PresetId, buildApprove, buildCreateVault, buildDeposit, factoryTokens, lookupVault,
  presetLimits, sendTx, waitForReceipt,
} from '../lib/vault';

type Eth = NonNullable<Window['ethereum']>;

async function sendAndWait(eth: Eth, from: `0x${string}`, tx: Parameters<typeof sendTx>[2]) {
  const hash = await sendTx(eth, from, tx);
  const rc = await waitForReceipt(eth, hash);
  if (rc.status !== '0x1') throw new Error('Transaction failed on-chain.');
  return hash;
}

/** Onboarding step 2: one tap "Create my vault" with a preset and target mix. */
export function CreateVaultStep({
  owner, factory, onCreated,
}: { owner: `0x${string}`; factory: `0x${string}`; onCreated: (vault: `0x${string}`) => void }) {
  const [preset, setPreset] = useState<PresetId>('balanced');
  const [target, setTarget] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const eth = window.ethereum;
    if (!eth) return setError('No wallet found.');
    setBusy(true);
    setError(null);
    try {
      await sendAndWait(eth, owner, buildCreateVault(factory, presetLimits(preset, target)));
      const v = await lookupVault(eth, factory, owner);
      if (!v) throw new Error('Vault not found after creation.');
      onCreated(v);
    } catch (e) {
      setError((e as Error).message || 'Could not create your vault.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="h1" style={{ margin: 0 }}>Create my vault</h1>
      <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
        Your own vault. Only you can withdraw, and the agent can only trade within your limits.
      </p>
      <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(Object.keys(PRESETS) as PresetId[]).map((id) => (
          <Button key={id} variant={preset === id ? 'primary' : 'secondary'} fullWidth onClick={() => setPreset(id)}
            aria-checked={preset === id} role="radio">
            {PRESETS[id].label} · {PRESETS[id].blurb}
          </Button>
        ))}
      </div>
      <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        Target mix: {target}% cNGN / {100 - target}% USD₮
        <input type="range" min={0} max={100} step={5} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
      </label>
      {error ? <ErrorBanner message={error} onRetry={() => setError(null)} /> : null}
      <Button fullWidth onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create my vault'}</Button>
    </div>
  );
}

/** Onboarding step 3: deposit cNGN or USD₮ from the user's own wallet (approve + tagged deposit). */
export function DepositStep({
  owner, factory, vault, onDone,
}: { owner: `0x${string}`; factory: `0x${string}`; vault: `0x${string}`; onDone: () => void }) {
  const [token, setToken] = useState<'cngn' | 'usdt'>('cngn');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deposit() {
    const eth = window.ethereum;
    if (!eth) return setError('No wallet found.');
    let units: bigint;
    try {
      units = parseUnits(amount || '0', 18);
    } catch {
      return setError('Enter a valid amount.');
    }
    if (units <= 0n) return setError('Enter an amount above zero.');
    setBusy(true);
    setError(null);
    try {
      const tokens = await factoryTokens(eth, factory);
      const addr = tokens[token];
      await sendAndWait(eth, owner, buildApprove(addr, vault, units));
      await sendAndWait(eth, owner, buildDeposit(vault, addr, units));
      onDone();
    } catch (e) {
      setError((e as Error).message || 'Deposit failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="h1" style={{ margin: 0 }}>Make your first deposit</h1>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant={token === 'cngn' ? 'primary' : 'secondary'} onClick={() => setToken('cngn')}>cNGN</Button>
        <Button variant={token === 'usdt' ? 'primary' : 'secondary'} onClick={() => setToken('usdt')}>USD₮</Button>
      </div>
      <input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)}
        style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border)', fontSize: 16 }} />
      {error ? <ErrorBanner message={error} onRetry={() => setError(null)} /> : null}
      <Button fullWidth onClick={deposit} disabled={busy}>{busy ? 'Depositing…' : 'Deposit'}</Button>
      <Button variant="ghost" fullWidth onClick={onDone}>Skip for now</Button>
    </div>
  );
}
