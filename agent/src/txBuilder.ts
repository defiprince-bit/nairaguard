/**
 * NairaGuard tx builder — the ONLY module that builds or sends transactions.
 *
 * Every transaction carries the Loops House ERC-8021 attribution tag
 * (ATTRIBUTION_TAG) appended to its calldata, using @celo/attribution-tags,
 * as required by .agents/skills/loops-agents-on-open-rails/SKILL.md
 * ("Celo mainnet attribution"). Untagged mainnet txs are never credited.
 *
 * Do not create wallet clients or call sendTransaction/writeContract anywhere else.
 */
import { fromDataSuffix, toDataSuffix, withAttribution } from '@celo/attribution-tags';
import {
  type Abi,
  type Account,
  type Chain,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
  type Transport,
  concatHex,
  createWalletClient,
  encodeFunctionData,
} from 'viem';
import { ATTRIBUTION_TAG } from './config.js';

/** ERC-8021 data suffix for our tag (bytes appended to calldata). */
export const ATTRIBUTION_SUFFIX: Hex = toDataSuffix(ATTRIBUTION_TAG);

/**
 * Pure helper (safe for the dashboard): append the attribution suffix to calldata.
 * Plain transfers (no data) become just the suffix. Idempotent.
 */
export function tagCalldata(data?: Hex): Hex {
  const base: Hex = data && data !== '0x' ? data : '0x';
  if (isTagged(base)) return base;
  return concatHex([base, ATTRIBUTION_SUFFIX]);
}

/** True when calldata ends with an ERC-8021 suffix that includes our tag. */
export function isTagged(data?: Hex): boolean {
  if (!data) return false;
  const decoded = fromDataSuffix(data);
  return decoded?.codes.includes(ATTRIBUTION_TAG) ?? false;
}

/** A transaction request whose data is already tagged. */
export type TaggedTx = { to: `0x${string}`; data: Hex; value?: bigint };

/** Pure: build a tagged contract call (for dashboard wallets or the agent). */
export function buildContractCall<
  const abi extends Abi,
  fn extends ContractFunctionName<abi, 'nonpayable' | 'payable'>,
>(args: {
  address: `0x${string}`;
  abi: abi;
  functionName: fn;
  args: ContractFunctionArgs<abi, 'nonpayable' | 'payable', fn>;
  value?: bigint;
}): TaggedTx {
  const data = encodeFunctionData({
    abi: args.abi,
    functionName: args.functionName,
    args: args.args,
  } as Parameters<typeof encodeFunctionData>[0]);
  return { to: args.address, data: tagCalldata(data), value: args.value };
}

/** Pure: build a tagged plain transfer. */
export function buildTransfer(to: `0x${string}`, value: bigint): TaggedTx {
  return { to, value, data: tagCalldata() };
}

/**
 * Agent-side sender. Wraps a viem wallet client extended with withAttribution,
 * and only exposes `send(tx)`. The raw client is never exported.
 */
export function createTxSender(opts: { account: Account; chain: Chain; transport: Transport }) {
  const client = createWalletClient(opts).extend(withAttribution(ATTRIBUTION_TAG));
  return {
    address: opts.account.address,
    /** Send a tx; calldata is (re)tagged here, so nothing can leave untagged. */
    async send(tx: TaggedTx & { gas?: bigint; nonce?: number }): Promise<Hex> {
      // withAttribution appends the suffix itself; pass untagged data to avoid a double suffix.
      const data = stripTag(tx.data);
      return client.sendTransaction({
        account: opts.account,
        chain: opts.chain,
        to: tx.to,
        data,
        value: tx.value,
        gas: tx.gas,
        nonce: tx.nonce,
      } as Parameters<typeof client.sendTransaction>[0]);
    },
  };
}

function stripTag(data: Hex): Hex {
  if (!isTagged(data)) return data;
  const suffixLen = (ATTRIBUTION_SUFFIX.length - 2) / 2;
  const hex = data.slice(2);
  const stripped = hex.slice(0, hex.length - suffixLen * 2);
  return `0x${stripped}` as Hex;
}
