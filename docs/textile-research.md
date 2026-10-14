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

## Permit2, the taker side and Textile's Operator Vault (checked 2026-10-14)

Sources: the [address book](https://fx-docs.textilecredit.com/protocol/address-book.html), [Settlement](https://fx-docs.textilecredit.com/protocol/settlement.html), [Operator Vault](https://fx-docs.textilecredit.com/protocol/operator-vault/), [For aggregators](https://fx-docs.textilecredit.com/api/v2/aggregators.html), [Authentication](https://fx-docs.textilecredit.com/api/v2/authentication.html) and [Testnet](https://fx-docs.textilecredit.com/testnet.html). Verified source comes from celo.blockscout.com, and the reads were made with `cast` against forno.celo.org and sepolia.base.org. Nothing was signed or sent.

### 1. Who uses Permit2: the maker, not us

`LimitOrderReactor` `0xa9AA…35b3` is verified (solc 0.8.30) and is vendored UniswapX v2.1.0. `permit2()` returns `0x000000000022D473030F116dDEE9F6B43aC78BA3`, and `feeController()` returns `0x7b00…3Ea7`.

In UniswapX the **swapper** is the party that signs the order. On Textile that is the **maker** (a market maker's wallet or an Operator Vault). The **taker**, which is us, is the reactor's `msg.sender`, which UniswapX calls the "filler".

- The maker's input is pulled with **Permit2 SignatureTransfer**:
  ```solidity
  // LimitOrderReactor.sol
  function _transferInputTokens(ResolvedOrder memory order, address to) internal override {
      permit2.permitWitnessTransferFrom(order.toPermit(), order.transferDetails(to),
          order.info.swapper, order.hash, ...
  // BaseReactor._prepare
  order.validate(msg.sender);
  _transferInputTokens(order, msg.sender);   // maker's tokens go to the taker
  ```
- The taker's side (the order's outputs) is a **plain ERC-20 `transferFrom` from `msg.sender`**:
  ```solidity
  // BaseReactor._fill -> CurrencyLibrary.transferFill
  // else the caller must have approved the token for the fill
  ERC20(currency).safeTransferFrom(msg.sender, recipient, amount);
  ```
- The aggregators doc says the same: "pulls the taker's side from msg.sender with a plain transferFrom. There are no callbacks, no Permit2 on the taker side, and no EOA or tx.origin checks." The spender is `quote.spender`. That is the reactor for most quotes, or the `VaultOrderExecutor` when the order is from a vault. Read it from each quote.
- Permit2's own source (verified on Celo) handles EIP-1271 in `SignatureVerification.verify`: `if (claimedSigner.code.length == 0) { ecrecover … } else { IERC1271(claimedSigner).isValidSignature(hash, signature) … }`. A contract **swapper** is supported, and that is how Textile's Operator Vaults sign. We are never the swapper, though, so we don't need it.

**What this means for 8b:** NairaGuard sells by acting as the **taker**. The vault does a plain `approve(quote.spender, takerPays)`, calls `transactions.swap.to` with `transactions.swap.data`, resets the allowance to 0, and checks the balance changes. No Permit2 approval is needed, and no EIP-1271 for settlement. The output arrives at `msg.sender`, which is the vault. The spender allowlist has two entries: the reactor and the VaultOrderExecutor. Permit2 is not one of them.

### 2. Textile's Operator Vault and VaultOrderExecutor

- `OperatorVaultFactory` `0x8810…844A` and `VaultOrderExecutor` `0x01b0…42e2` are both verified. The executor's `reactor()` is the Celo reactor, and its `factory()` is that factory.
- An Operator Vault is a **maker-side LP vault**. LPs deposit, and an operator's Stitch bot quotes with the vault's inventory. The vault is the **swapper** and signs through EIP-1271 (`OperatorVault.isValidSignature`). Every order needs **two signatures on the same digest**: the strategy signer (the bot) and the risk signer. Other roles are operator admin, risk admin (which rotates the risk signer after a delay) and guardian (pause). The vault's policy checks the pair, a single output whose recipient is the vault, size caps, expiry and epoch.
- `VaultOrderExecutor.fill(signedOrder)` is a stateless **taker-side** wrapper for filling *against* a vault order. It:
  - checks that `factory.isVault(swapper)`, that the reactor matches and that there is one output;
  - checks that `msg.sender` is in the order's `preferredFillers` (`_assertCallerMayFill`);
  - calls `prepareSettlement` to recall idle funds from Aave;
  - pulls the output plus the fee from `msg.sender` with `safeTransferFrom`, then `forceApprove(reactor)` and `reactor.execute`;
  - resets the approval to 0;
  - forwards the received input token and any leftover to `msg.sender`.
- Example mainnet fill: [`0x5f2e9dcf…5bb2`](https://celo.blockscout.com/tx/0x5f2e9dcf4bdecc745707aeb0d25653c5cc43a1ccbf9bc496f1959c6e71be5bb2) (2026-10-05 03:03 WAT). The taker EOA `0x1a25…aA0` called `fill` itself and paid 65,000,000 IDRX. The vault `0xEac3…` received 64,993,500.65 IDRX and the fee controller got 6,499.35 IDRX (1 bps). The taker received 3,649.385 USDT, part of it recalled from aCelUSDT.
- **Fit with NairaGuard:**
  - We can't use an Operator Vault as our vault. It is an LP market-making product with two-key signing and epoch-based redemptions, not a per-user vault run by an agent with spending limits.
  - We don't have to "be the swapper through the executor" either, because we are the taker. When a quote is filled by a Textile vault, `quote.spender` and `transactions.swap.to` are the executor, and our vault calls it the same way it calls the reactor (approve spender, call, reset, check deltas).
  - Because of the preferred-filler check, our **vault address must be the `taker`** in the RFQ request, so the quote binds to it.
- **Attribution:** the agent's own EOA sends `NairaGuardVault.swapViaTextile(...)` with the `celo_9efd0f97b491` tag. The vault calls the reactor or executor in the same transaction. No order is signed by us and no filler submits on our behalf.

### 3. Base Sepolia sandbox

- The reactor `0x3a6e…e4D9` has code, and its `permit2()` returns the canonical Permit2.
- The tokens match the address book. `0xe238…afa2` is `cNGN` with 6 decimals, and `0x036C…CF7e` is `USDC` with 6 decimals.
- **Right now the RFQ API can't quote cNGN↔USDC there.** `/v2/rfq/preview` on 84532 returns `Corridor cngn-usdc-base-sepolia is not RFQ-enabled — use the /v1 book`. `/v2/rfq/levels?chainId=84532` lists only ZARU (`0x47b0…`) ↔ USDC. Celo Sepolia (11142220) returns `has no FX settlement contract deployed`. Celo mainnet `/levels` lists cNGN `0x62b8…` ↔ USDT `0x4806…` with **zero depth** at the time of the check.
- **Keys:** a firm request without a key works only with `takerProof`, a TakerControl signature by the taker. Our keyless test returned `401 proof_of_control_required`. For a contract taker that proof is checked with EIP-1271, so a keyless vault would need `isValidSignature` just to request quotes. Regular keys also check that the taker already holds the sell token. The cleaner route is a **partner key with the `rfq:aggregator` scope**, which skips both checks and allows 32 live quotes. These keys are issued by hand, so the owner needs to ask Textile for one.

### Recommendation

Go with **option (a), approve then call**, and correct one point: the approval goes to `quote.spender` (the reactor or the VaultOrderExecutor), not to Permit2.
- No Permit2 `approve` and no `isValidSignature` are needed for settlement.
- Both possible spenders and swap targets go on the factory allowlist.
- Request quotes with `taker = vault`, using an aggregator key.

We could add a narrow EIP-1271 later, signing only TakerControl digests the agent commits to, if we have to stay keyless. Option (c) isn't a fit, because the executor is just one more allowlisted spender inside (a). A dress rehearsal on Base Sepolia waits until Textile enables the cNGN↔USDC RFQ corridor there.
