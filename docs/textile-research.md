# Textile FX: how swaps work on-chain (research, 14 Oct 2026)

Read-only research. No wallet connected and no transactions sent.
Sources: https://app.textilecredit.com/llms.txt, https://docs.textilecredit.com/llms-full.txt
(address book, settlement, fees, testnet, api/v2/rfq, api/v2/aggregators), the Celo Blockscout API, and the public API at https://api.textilecredit.com.
Note: the app is a Vite SPA, not Next.js, so there are no `_next` chunks. The docs and llms.txt were the main source.

## TL;DR
- Textile is **RFQ, not an AMM or router**. There is **no on-chain `quote()`**. Prices come from market makers through an off-chain HTTP API. The API returns signed UniswapX orders plus calldata, which the taker sends to Textile's own **UniswapX LimitOrderReactor (v2.1.0)** via `executeBatch`.
- **Celo mainnet is live** for cNGN<->USDT (and USDC, wARS, wBRL, IDRX <-> USDT). Taker fee is **1 bps**.
- **No Celo testnet deployment.** Testnets are BSC testnet (97, cNGN/USDT) and Base Sepolia (84532, cNGN/USDC). The API rejects chainId 11142220 with a 400. (Alfajores isn't listed anywhere.)
- **We need a code change.** Our `ISwapRouter.quote/swap(tokenIn,tokenOut,amountIn,minOut)` can't express "execute this signed calldata", so we need a new Vault function or an adapter, plus a Vault/factory redeploy.

## Celo mainnet (42220) addresses
Source: https://docs.textilecredit.com/protocol/address-book. **Confirmed** verified on celo.blockscout.com.

| Contract | Address | Blockscout |
|---|---|---|
| LimitOrderReactor (taker calls this) | 0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3 | verified, solc 0.8.30, creation tx 0x5014633692dc8e0e7cbda3956527f71efd8eb43e011442c1daaa270b0ee12346 |
| SellFirstFeeController (1 bps) | 0x7b005466F905DD882A959888154587fA76cd3Ea7 | verified |
| VaultOrderExecutor (alt. `spender`) | 0x01b006d5c687bde182aa36F542f1f014144742e2 | verified |
| OperatorVaultFactory | 0x88104decA449C797632AfdcA77A3140b24cD844A | (docs only, not checked) |
| Permit2 (canonical) | 0x000000000022D473030F116dDEE9F6B43aC78BA3 | |
All three verified contracts were deployed by 0x0Ddf1DBb612B07aFdAaE54a21e453bb36b3693a7.

Tokens (docs, and confirmed by the live `/v2/rfq/levels?chainId=42220` feed):
- cNGN 0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f (6 dp)
- USDT 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e (6 dp)
- USDC 0xcebA9300f2b948710d2653dD7B07f33A8B32118C (6 dp; only USDC<->USDT, **no cNGN<->USDC corridor on Celo**)
- wARS, wBRL, IDRX are also listed. The feed also has an extra pair 0x471ece37…a438 <-> USDT that the docs don't list.

## Testnets (no Celo)
- BSC testnet 97: reactor 0x65B2f3847b391783e15554D5f2826FBaF318a7Df, fee ctl 0x65DED1F0…bdC5 (5 bps), cNGN 0x8a078b18…9dA8, USDT 0x337610d2…4dDd (**18 dp**)
- Base Sepolia 84532: reactor 0x3a6e177120c72fB8A95546605D4921FaDDFAe4D9, fee ctl 0x350DD056…79af, cNGN 0xe2387F04…Afa2, USDC 0x036CbD53…CF7e
- Testnet min size is about $0.01. Test API keys are available (https://docs.textilecredit.com/testnet).

## On-chain interface (confirmed from the verified ABI)
LimitOrderReactor functions: `execute((bytes order, bytes sig))`, `executeBatch((bytes,bytes)[])`, `executeWithCallback(...)`, `executeBatchWithCallback(...)`, `feeController()`, `permit2()`, `owner()`.
`SignedOrder = (bytes order, bytes sig)` is the standard UniswapX struct. The orders are **signed by the maker** and the taker only submits them.

Example mainnet txs, all `executeBatch` calls to the reactor with status ok (times are WAT):
- 0x5f210288f287e6b9cd1907810d433149b40086a1e32eb344c3aac7eb7671e6ec (14 Oct, 17:34 WAT)
- 0xe66bb4fb57050d9b42ccae5073167b5e6d67eedebcf8302cb872064dd5f5804e (14 Oct, 16:12 WAT)
- 0x3cc022f77f73e1f511588f5daa145254acc4078b424b5578e48fa69f9f86e11f (14 Oct, 15:50 WAT)
These come from several different EOAs, so the reactor is in active use.

## Quote and swap flow (API v2, docs-confirmed)
Base URL https://api.textilecredit.com
1. `GET /v2/rfq/levels?chainId=42220` (no auth): an indicative ladder per pair with min/max size. **Confirmed live.**
2. `POST /v2/rfq/preview` (no auth): indicative price for a size.
3. `POST /v2/rfq/request` takes `{chainId, sellToken, buyToken, sellAmount|buyAmount, taker}` and **blocks up to about 750 ms (set the client timeout to 75 s)**. It returns `quote.{takerPays,buyAmount,feeAmount,spender,reactor,expiresAt,orderDeadline,orders[]}` and `transactions.{approval,swap:{to,data}}`.
   - Auth: either a partner key (`Authorization: Bearer tx_live_…`) or a keyless EIP-712 `takerProof` signed by the taker. **A contract taker can't sign that proof, so we need a partner key.**
   - With a regular key, the taker must already hold the sell token. Our vault does hold it, so a regular key should work (**guessed**). An `rfq:aggregator` key skips that check and allows 32 live quotes; Textile issues those by hand.
4. On-chain, the taker approves `quote.spender` for `takerPays`, then calls `swap.to` with `swap.data`. Per the aggregator docs, the reactor pays the output to **msg.sender** and pulls input from msg.sender with a plain `transferFrom`. No callbacks, no Permit2 on the taker side, **no EOA/tx.origin checks**. The orders are **exclusive to `taker`**.
5. `POST /v2/rfq/submit` is optional, since Textile indexes fills.

## Fees and slippage
- Taker fee is 1 bps on Celo, taken in the sell token and already inside the quote (https://docs.textilecredit.com/fees). The maker spread is inside the rate too.
- It's a firm quote, so there's no slippage. Either the exact `buyAmount` arrives or the tx reverts. The real risk is **expiry**: quotes last a few seconds (`expiresAt`), so the vault tx has to be broadcast right after the request.
- Live limits (levels feed, 14 Oct): cNGN->USDT min about 1,361.5 cNGN (about $1). USDT->cNGN min 1 USDT, max about 3,045 USDT. The indicative rate is about ₦1,361–1,362 per USDT.
- A no-quote is a normal outcome (`status: no_quote`), so the agent must handle it.

## SDK
No public SDK was found. There's an OpenAPI v2 spec (https://docs.textilecredit.com/openapi-v2.json), a Postman collection, and a TypeScript walkthrough in the RFQ docs. GitHub "textile" results are the unrelated textile.io company.

## Mapping to our Vault
Our `contracts/src/Vault.sol` has:
```solidity
interface ISwapRouter {
  function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256);
  function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) external returns (uint256);
}
```
- `quote()` **can't be implemented on-chain**, because the price only exists off-chain. The agent has to quote through the API.
- `swap()` has no way to carry the signed-order calldata.

Options:
**A. Recommended: change the Vault and skip the adapter.** Add an agent-only `swapViaCalldata(tokenIn, tokenOut, amountIn, minOut, usdValue, address target, address spender, bytes data)` in which the vault:
   1. whitelists `target` (the reactor) and `spender` (the reactor or VaultOrderExecutor) as immutable/owner-set,
   2. approves `spender` for exactly `amountIn`,
   3. calls `target` with `data`,
   4. resets the approval to 0,
   5. measures the balance change (as `_executeSwap` already does), requires `amountOut >= minOut` and `amountIn` spent `<= amountIn`, then emits `Swapped`.
   The vault is `taker`, so the quote is requested with `taker = vault address`. It keeps the existing limits, approvals, the reject flow and the event. Because the balance-change check is ours, malicious calldata can't take more than `amountIn` or deliver less than `minOut`.
**B. An adapter contract (TextileRouterAdapter).** The adapter would be the taker. The vault would approve the adapter, which pulls tokens, executes the calldata and forwards the output. This still needs the interface extended with `bytes data`, so the Vault changes anyway, and it adds a contract plus another approval hop. It's only worth it if we want to swap venues without a Vault redeploy.
**Either way, a Vault/factory redeploy is needed before mainnet.**

Agent changes: call `/v2/rfq/request` with `taker=vault` and amount = `amountIn`, check `takerPays <= amountIn`, set `minOut = buyAmount`, check `spender`/`to` against the whitelist, and send the tx before `expiresAt`. On no-quote, skip and log.

## Open questions for Textile (office hours)
1. A partner API key for a contract taker (and whether a regular key is fine, given the vault holds the sell token).
2. A Celo Sepolia deployment, or should we test on Base Sepolia/BSC testnet?
3. A cNGN<->USDC corridor on Celo?
4. Do they credit fills where the taker is a contract, for the hackathon's on-chain metrics?

## On-chain NGN/USD reference rate (Celo mainnet)

Checked 14 Oct 2026 ~20:10 WAT with `cast` against https://forno.celo.org.

| Source | Address | Read result | Freshness |
|---|---|---|---|
| Chainlink NGN/USD (`NGN/USD-RefPrice-DF-Celo-001`) | `0xc17cbe2db40e53f4984c46f608da6da1ff074c11` | `latestRoundData` answer 75193, 8 decimals = 0.00075193 USD/NGN (≈ ₦1,329.9/$) | updatedAt was ~2 min before the read. Triggers on a 1% deviation; the heartbeat isn't published on the page |
| Mento SortedOracles, feed `relayed:NGNUSD` | SortedOracles `0xefB84935239dAcdecF7c5bA76d8dE40b077B7b33`, rateFeedId `0xC13D42556f1baeab4a8600C735afcd5344048d3C` | `medianRate` 7.5193e20 / 1e24 = the same 0.00075193 | medianTimestamp was ~95 s before the read. 1 reporter. `tokenReportExpirySeconds` = 360 |
| Mento ChainlinkRelayer (the reporter) | `0xce35D1F69523a0672b9281dF1675D5b5D4004feF` | `getAggregators()` → the Chainlink feed above (CGP-0180) | relays Chainlink into Mento |
| Pyth | Celo contract `0xff1a0f4744e8582DF1aE09D5611b887B6a12925C` | Hermes lists **no NGN feed** | n/a |
| RedStone | none found | no NGN/USD feed on Celo found | n/a |

Both usable sources are a single Chainlink feed underneath. The Mento copy adds an expiry check (`isOldestReportExpired`).

**Recommendation:** use Chainlink NGN/USD (`0xc17c…4c11`) as the on-chain reference in place of an agent-pushed rate. Mento's `relayed:NGNUSD` is an equivalent alternative. The vault should:
- revert if `block.timestamp - updatedAt` exceeds a staleness bound the factory owner sets (start at about 1h), or if the answer is ≤ 0;
- check `minOut` against the oracle rate with a maximum deviation of about 2%, also set by the factory owner;
- read the decimals from the feed.

This feed is the NGN FX reference, not the cNGN market price. Textile quoted ≈ ₦1,361/$ against an oracle rate of ≈ ₦1,330, which is about a 2.3% gap. Before setting the band, measure the cNGN premium over a few days. The band may need to be about 3%, or one-sided, because the floor only has to stop prices that are too low. Keep an agent-pushed rate only as a fallback the owner can switch on if the feed goes stale.
