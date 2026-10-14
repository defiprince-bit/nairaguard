'use client';

import { useCallback, useEffect, useState } from 'react';

export type EthProvider = {
  isMiniPay?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthProvider;
  }
}

export function isMiniPay(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum?.isMiniPay;
}

export function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [miniPay, setMiniPay] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!eth) {
      setError('No wallet found. Open this page inside MiniPay, or install a Celo wallet.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
      if (accounts?.[0]) setAddress(accounts[0]);
      else setError('No account returned.');
    } catch {
      setError('Wallet connection was cancelled.');
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!eth) return;
    const mp = !!eth.isMiniPay;
    setMiniPay(mp);
    eth
      .request({ method: mp ? 'eth_requestAccounts' : 'eth_accounts' })
      .then((accounts) => {
        const list = accounts as string[];
        if (list?.[0]) setAddress(list[0]);
      })
      .catch(() => {
        /* leave disconnected */
      });
  }, []);

  return { address, miniPay, connecting, error, connect, setError };
}
