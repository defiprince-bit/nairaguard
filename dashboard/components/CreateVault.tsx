'use client';

import { useState } from 'react';
import { parseUnits } from 'viem';
import { Button } from './Button';
import { InlineMessage } from './InlineMessage';
import { type FriendlyError, friendlyError } from '../lib/errors';
import { type CreateResult, recheckCreate, runCreate } from '../lib/createVault';
import {
  DEFAULT_PRESET, PRESETS, type PresetId, buildApprove, buildCreateVault, buildDeposit, factoryTokens, lookupVault,
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
  const [stage, setStage] = useState<'target' | 'freedom'>('target');
  const [preset, setPreset] = useState<PresetId>(DEFAULT_PRESET);
  const [target, setTarget] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [note, setNote] = useState<{ kind: 'exists' | 'pending'; message: string } | null>(null);
  const [pendingHash, setPendingHash] = useState<`0x${string}` | null>(null);
  const pending = note?.kind === 'pending';

  function apply(r: CreateResult) {
    if (r.kind === 'created') { setNote(null); return onCreated(r.vault); }
    if (r.kind === 'exists') {
      setNote({ kind: 'exists', message: r.message });
      const go = (v: `0x${string}`) => setTimeout(() => onCreated(v), 1200);
      if (r.vault) go(r.vault);
      else lookupVault(factory, owner).then((v) => { if (v) go(v); }).catch(() => {});
      return;
    }
    if (r.kind === 'pending') { setPendingHash(r.hash); setNote({ kind: 'pending', message: r.message }); return; }
    setError(r);
  }

  async function checkAgain() {
    const eth = window.ethereum;
    if (!eth) return;
    setBusy(true);
    try {
      apply(await recheckCreate({ lookup: () => lookupVault(factory, owner), wait: (h) => waitForReceipt(eth, h, 5) }, pendingHash));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (pending) return; // never re-send while the first tx is still confirming
    const eth = window.ethereum;
    if (!eth) return setError({ kind: 'error', message: 'No wallet found.' });
    setBusy(true);
    setError(null);
    try {
      apply(await runCreate({
        lookup: () => lookupVault(factory, owner),
        send: () => sendTx(eth, owner, buildCreateVault(factory, presetLimits(preset, target))),
        wait: (h) => waitForReceipt(eth, h),
      }));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const wrap = { maxWidth: 480, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 } as const;

  if (stage === 'target') {
    return (
      <div style={wrap}>
        <h1 className="h1" style={{ margin: 0 }}>Create my vault</h1>
        <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
          Your own vault. Only you can withdraw, and the agent can only trade within your limits.
        </p>
        <label className="small" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          How much do you want to keep in naira? {target}% cNGN / {100 - target}% USD₮
          <input type="range" min={0} max={100} step={5} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
        </label>
        <Button fullWidth onClick={() => setStage('freedom')}>Next</Button>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <h1 className="h1" style={{ margin: 0 }}>How much freedom should the agent have?</h1>
      <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(Object.keys(PRESETS) as PresetId[]).map((id) => (
          <Button key={id} variant={preset === id ? 'primary' : 'secondary'} fullWidth onClick={() => setPreset(id)}
            aria-checked={preset === id} role="radio" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <strong style={{ display: 'block', fontWeight: 700 }}>{PRESETS[id].label}</strong>
            <span className="small" style={{ display: 'block', fontSize: 13, fontWeight: 400, color: preset === id ? 'rgba(255,255,255,0.8)' : 'var(--ink-muted)' }}>{PRESETS[id].blurb}</span>
          </Button>
        ))}
      </div>
      {note ? <InlineMessage err={note} /> : null}
      {error ? <InlineMessage err={error} onDismiss={() => setError(null)} /> : null}
      {pending ? (
        <Button fullWidth onClick={checkAgain} disabled={busy}>{busy ? 'Checking…' : 'Check again'}</Button>
      ) : (
        <Button fullWidth onClick={create} disabled={busy || note?.kind === 'exists'}>{busy ? 'Creating…' : 'Create my vault'}</Button>
      )}
      <Button variant="ghost" fullWidth onClick={() => setStage('target')} disabled={busy || pending}>Back</Button>
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
  const [error, setError] = useState<FriendlyError | null>(null);

  async function deposit() {
    const eth = window.ethereum;
    if (!eth) return setError({ kind: 'error', message: 'No wallet found.' });
    if (!(Number(amount) > 0)) return setError({ kind: 'error', message: 'Enter an amount above zero.' });
    setBusy(true);
    setError(null);
    try {
      const tokens = await factoryTokens(eth, factory);
      const addr = tokens[token];
      let units: bigint;
      try {
        units = parseUnits(amount, tokens.decimals[token]);
      } catch {
        return setError({ kind: 'error', message: 'Enter a valid amount.' });
      }
      await sendAndWait(eth, owner, buildApprove(addr, vault, units));
      await sendAndWait(eth, owner, buildDeposit(vault, addr, units));
      onDone();
    } catch (e) {
      setError(friendlyError(e));
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
      {error ? <InlineMessage err={error} onDismiss={() => setError(null)} /> : null}
      <Button fullWidth onClick={deposit} disabled={busy}>{busy ? 'Depositing…' : 'Deposit'}</Button>
      <Button variant="ghost" fullWidth onClick={onDone}>Skip for now</Button>
    </div>
  );
}
