'use client';

import { useEffect, useState } from 'react';
import { getProvider } from '../../../lib/wallet';
import { readPendingOwner, sendAcceptOwnership, waitMainnet } from '../../../lib/ownership';

type S = { k: 'idle' } | { k: 'pending'; hash?: string } | { k: 'done'; hash: string } | { k: 'error'; msg: string };

/** Hidden owner-only page: renders nothing unless the connected wallet is the factory's pendingOwner on Celo mainnet. */
export default function OwnerPage() {
  const [me, setMe] = useState<`0x${string}` | null>(null);
  const [ok, setOk] = useState(false);
  const [s, setS] = useState<S>({ k: 'idle' });

  useEffect(() => {
    const eth = getProvider();
    if (!eth) return;
    (async () => {
      try {
        const accs = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
        const a = accs?.[0] as `0x${string}` | undefined;
        if (!a) return;
        const pending = await readPendingOwner();
        setMe(a);
        setOk(pending.toLowerCase() === a.toLowerCase());
      } catch { /* render nothing */ }
    })();
  }, []);

  if (!me || !ok) return null;

  async function accept() {
    const eth = getProvider();
    if (!eth || !me) return;
    setS({ k: 'pending' });
    try {
      try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa4ec' }] }); } catch { /* MiniPay is already on Celo */ }
      const hash = await sendAcceptOwnership(eth, me);
      setS({ k: 'pending', hash });
      const success = await waitMainnet(hash);
      setS(success ? { k: 'done', hash } : { k: 'error', msg: 'Transaction failed on-chain.' });
    } catch (e) {
      setS({ k: 'error', msg: (e as Error)?.message?.split('\n')[0] || 'Something went wrong.' });
    }
  }

  const link = (h: string) => <a href={`https://celoscan.io/tx/${h}`} target="_blank" rel="noreferrer">View on Celoscan</a>;
  return (
    <main style={{ maxWidth: 420, margin: '48px auto', padding: 16, fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 20 }}>Accept factory ownership</h1>
      <p>Make this wallet the owner of the NairaGuard VaultFactory on Celo.</p>
      {s.k === 'done' ? (
        <p>✅ You are now the owner. {link(s.hash)}</p>
      ) : (
        <button onClick={accept} disabled={s.k === 'pending'} style={{ padding: '12px 20px', fontSize: 16, borderRadius: 12 }}>
          {s.k === 'pending' ? 'Confirming…' : 'Accept ownership'}
        </button>
      )}
      {s.k === 'pending' && s.hash && <p>Sent. {link(s.hash)}</p>}
      {s.k === 'error' && <p style={{ color: '#c0392b' }}>{s.msg}</p>}
    </main>
  );
}
