'use client';

import { ReactNode, useState } from 'react';
import { Button } from './Button';
import { InlineMessage } from './InlineMessage';
import { type FriendlyError, friendlyError } from '../lib/errors';
import { DepositStep } from './CreateVault';
import { sendWithdraw } from '../lib/withdraw';
import s from './Overview.module.css';

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className={s.sheetBack} role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={s.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={s.row}>
          <span className={s.h3}>{title}</span>
          <button type="button" className={s.eye} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DepositSheet(p: { owner: `0x${string}`; factory: `0x${string}`; vault: `0x${string}`; onClose: () => void; onDone: () => void }) {
  return (
    <Sheet title="Deposit" onClose={p.onClose}>
      <DepositStep owner={p.owner} factory={p.factory} vault={p.vault} onDone={p.onDone} />
    </Sheet>
  );
}

export function WithdrawSheet(p: { owner: `0x${string}`; factory: `0x${string}`; vault: `0x${string}`; onClose: () => void; onDone: () => void }) {
  const [token, setToken] = useState<'cngn' | 'usdt'>('cngn');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await sendWithdraw(p.owner, p.factory, p.vault, token, amount.trim());
      p.onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Withdraw to your wallet" onClose={p.onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant={token === 'cngn' ? 'primary' : 'secondary'} onClick={() => setToken('cngn')}>cNGN</Button>
          <Button variant={token === 'usdt' ? 'primary' : 'secondary'} onClick={() => setToken('usdt')}>USD₮</Button>
        </div>
        <label className={s.lbl} htmlFor="wd-amt">Amount</label>
        <input id="wd-amt" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className={s.input} />
        {error ? <InlineMessage err={error} onDismiss={() => setError(null)} /> : null}
        <Button fullWidth onClick={go} disabled={busy || !amount}>{busy ? 'Waiting for wallet…' : 'Withdraw'}</Button>
      </div>
    </Sheet>
  );
}
