import { parseAbi } from 'viem';
import { appClient, factoryAbi } from './vault';

/** MiniPay deeplink that opens the add-cash flow for USD₮. */
export const MINIPAY_ADD_CASH_USDT = 'https://link.minipay.xyz/add_cash?tokens=USDT' as const;

const balAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);

/** True when the wallet has neither cNGN nor USD₮ to deposit. */
export function walletNeedsTopUp(cngnRaw: bigint, usdtRaw: bigint): boolean {
  return cngnRaw === 0n && usdtRaw === 0n;
}

/** Wallet cNGN / USD₮ balances over the app RPC (not the wallet's chain). */
export async function readWalletDepositBalances(
  owner: `0x${string}`,
  factory: `0x${string}`,
): Promise<{ cngn: bigint; usdt: bigint }> {
  const pc = appClient();
  const [cngn, usdt] = await Promise.all([
    pc.readContract({ address: factory, abi: factoryAbi, functionName: 'cNGN' }) as Promise<`0x${string}`>,
    pc.readContract({ address: factory, abi: factoryAbi, functionName: 'usdt' }) as Promise<`0x${string}`>,
  ]);
  const bal = (t: `0x${string}`) =>
    pc.readContract({ address: t, abi: balAbi, functionName: 'balanceOf', args: [owner] }) as Promise<bigint>;
  const [c, u] = await Promise.all([bal(cngn), bal(usdt)]);
  return { cngn: c, usdt: u };
}
