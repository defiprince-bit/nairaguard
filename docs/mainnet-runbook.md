# Mainnet launch runbook (Celo, chain 42220)

Nothing here runs without the owner's explicit go-ahead. Every step that touches mainnet is listed in order; do not skip or reorder.

## 1. Infrastructure: a separate mainnet agent

Mainnet gets its **own Railway service and its own Postgres**. The Sepolia service (`agent`) keeps running unchanged.

| | Sepolia (existing) | Mainnet (new) |
|---|---|---|
| Railway service | `agent` | `agent-mainnet` (same repo, root `agent/`, same Dockerfile) |
| Postgres | existing plugin | **new** Postgres plugin attached only to `agent-mainnet` |

Every stats/count row also carries `chain_id` (migration `011_chain_id.sql`, Sepolia rows backfilled to `11142220`).
`/api/quotes/stats`, the independent-user count and P&L default to **42220** when no chain is passed, so Sepolia
rows can never reach the mainnet numbers even if a database were shared. Use `?chainId=11142220` to see test stats.

### `agent-mainnet` env vars

| Var | Value |
|---|---|
| `NETWORK` | `celo` |
| `RPC_URL` | `https://forno.celo.org` (or a paid Celo RPC) |
| `DATABASE_URL` | reference to the **mainnet** Postgres only |
| `AGENT_PRIVATE_KEY` | mainnet agent key for `0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4` (secret) |
| `FACTORY_ADDRESS` | mainnet factory from `deploy:tagged` |
| `FACTORY_START_BLOCK` | factory deploy block |
| `CNGN_ADDRESS` | `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f` |
| `USDT_ADDRESS` | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| `PRICE_FEED_ADDRESS` | `0xc17cbe2db40e53f4984c46f608da6da1ff074c11` (Chainlink NGN/USD) |
| `TEXTILE_API_KEY` | partner key with `rfq:aggregator` scope (secret), set in step 8 |
| `ERC8004_ID` | agent id from `register:erc8004` (step 6) |
| `DASHBOARD_URL` | production dashboard URL |
| `WAITLIST_CHAIN_ID` | `42220` |
| `LOOP_INTERVAL_MS` | `300000` |
| `PORT` | Railway default |

Do **not** set `MOCK_REACTOR_ADDRESS`, `MOCK_MARKET_RATE`, `VAULT_ADDRESS` or `SWAP_ROUTER_ADDRESS` on mainnet.
`src/config.ts` has no `celo` entry in `ADDRESSES` yet: add it (from the env vars above, `chainId: 42220`, no `mockReactor`)
in a PR after step 2 and before the service is started.

## 2. Vercel (dashboard)

Set **before** triggering the production deploy, for the Production environment:

- `NEXT_PUBLIC_NETWORK=celo`
- `NEXT_PUBLIC_FACTORY_ADDRESS=<mainnet factory>`
- the agent API URL pointing at `agent-mainnet`

`NEXT_PUBLIC_*` values are baked in at build time; changing them afterwards needs a redeploy. Without them the app keeps
pointing at Sepolia and labels every trade "Test swap".

## 3. Order of operations

All commands run from `agent/`. Every transaction carries the attribution tag `celo_9efd0f97b491` via the shared tx builder.

1. **Deploy (tagged)** — owner-approved only:
   `(cd ../contracts && forge build)` then
   `NETWORK=celo ALLOW_MAINNET=1 DEPLOYER_PRIVATE_KEY=… AGENT_ADDRESS=0xA2A1…28f4 CNGN_ADDRESS=0xF682…1a4f USDT_ADDRESS=0x4806…3D5e pnpm deploy:tagged --send`
   Record the factory address and deploy block.
2. **Verify** (read-only): `pnpm verify:deploy --factory <factory> --from-block <deployBlock>`.
   Checks cNGN/USDT addresses and 6 decimals, the Chainlink feed and that it updated < 1h ago, that the allowlisted venues
   (replayed from `VenueUpdated` events) are exactly the Textile reactor and `VaultOrderExecutor` labelled `textile` with no
   mocks, and `agent()`. Any failure exits 1: stop and fix before continuing.
3. **transferOwnership**: deployer calls `factory.transferOwnership(0x6Cac3a6Ab6981419f175713B80846c57528311f6)` (tagged).
4. **Owner acceptOwnership from MiniPay**: the owner calls `acceptOwnership()` from their own wallet. Nobody else can.
5. **Verify after transfer**: `pnpm verify:deploy --factory <factory> --from-block <deployBlock> --after-transfer`
   → `owner()` is the owner's wallet and `pendingOwner()` is zero.
6. **Register ERC-8004 (tagged)**: `pnpm register:erc8004` from the agent wallet on mainnet; set `ERC8004_ID` on `agent-mainnet`.
7. **Fund the agent wallet** with CELO for gas (target: by 28 Oct).
8. **Set `TEXTILE_API_KEY`** on `agent-mainnet` and start/redeploy the service; check `/api/health`.
9. **First $1 trade**: owner creates a vault in MiniPay on the mainnet factory, deposits a small amount, and the agent's
   first fill (~$1) goes through Textile. Confirm the tx carries the tag and shows in `/api/quotes/stats` (chain 42220).

Smoke test of the verifier against Sepolia (relaxed: mock tokens/feed/venue, no feed-age check):
`pnpm verify:deploy --network celo-sepolia`
