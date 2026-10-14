import { classifyCreateError, type CreateOutcome, MSG_TIMEOUT } from './errors';

type Hex = `0x${string}`;
export type CreateDeps = {
  lookup: () => Promise<Hex | null>;
  send: () => Promise<Hex>;
  wait: (hash: Hex) => Promise<{ status: Hex }>;
};
export type CreateResult =
  | { kind: 'created'; vault: Hex }
  | { kind: 'exists'; vault: Hex | null; message: string }
  | { kind: 'pending'; hash: Hex | null; message: string }
  | { kind: 'error' | 'cancelled'; message: string };

function fromOutcome(o: CreateOutcome, vault: Hex | null, hash: Hex | null): CreateResult {
  if (o.kind === 'exists') return { kind: 'exists', vault, message: o.message };
  if (o.kind === 'pending') return { kind: 'pending', hash, message: o.message };
  return o;
}

/** Send createVault once and wait. Never sends if a vault already exists. */
export async function runCreate(d: CreateDeps): Promise<CreateResult> {
  const existing = await d.lookup().catch(() => null);
  if (existing) return { kind: 'created', vault: existing };
  let hash: Hex | null = null;
  try {
    hash = await d.send();
    const rc = await d.wait(hash);
    if (rc.status !== '0x1') throw new Error('Transaction failed on-chain.');
    const v = await d.lookup();
    if (!v) throw new Error('Vault not found after creation.');
    return { kind: 'created', vault: v };
  } catch (e) {
    const v = await d.lookup().catch(() => null);
    const o = classifyCreateError(e);
    if (v) return o.kind === 'exists' ? { kind: 'exists', vault: v, message: o.message } : { kind: 'created', vault: v };
    return fromOutcome(o, null, hash);
  }
}

/** "Check again": re-reads vaultOf and the pending receipt. Never re-sends. */
export async function recheckCreate(d: Pick<CreateDeps, 'lookup' | 'wait'>, hash: Hex | null): Promise<CreateResult> {
  const v = await d.lookup().catch(() => null);
  if (v) return { kind: 'created', vault: v };
  if (hash) {
    try {
      const rc = await d.wait(hash);
      if (rc.status !== '0x1') return { kind: 'error', message: 'Something went wrong. Please try again.' };
      const v2 = await d.lookup().catch(() => null);
      if (v2) return { kind: 'created', vault: v2 };
    } catch { /* still not mined */ }
  }
  return { kind: 'pending', hash, message: MSG_TIMEOUT };
}
