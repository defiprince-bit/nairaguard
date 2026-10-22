# Celo mainnet deployment (chain 42220)

Deployed 22 Oct 2026 ~23:00 WAT with `pnpm deploy:tagged --send` (ERC-8021 suffix `celo_9efd0f97b491` on every tx).
Deployer `0x1ab29BDaAc75255501ADBBdcC2150fe4D346C0A7` (still owner; transferOwnership not done yet).

| Item | Address / tx |
|---|---|
| VaultImplementation | `0xf639c92039905c7cdbac585031fee1d953ac9efe` (tx `0x3cdacc04d7383fac78803df5653dc29388ee659478a257352fbffd4b9f2beac7`, block 80805461) |
| VaultFactory | `0xfe37fbea39ce656d7f8181e946e723b7b0d8cecb` (tx `0x8e8bbbe02bc49a45716da4789ed6b618ad4203d0aa729b3158a6f04748e35c9c`) |
| `FACTORY_START_BLOCK` | `80805463` |
| setPriceFeed | `0x5c902cf5346233b3bb4ce8f7b9d8a7e038c72dae12e70ebecca5ef86be6a1b06` |
| setVenue LimitOrderReactor | `0x1717c8f3d80b28ed22941d14a3548574f9c8b8910695812793353c7b09e19edd` |
| setVenue VaultOrderExecutor | `0xc1b619e5b342a6380c8c525d21fec158237aab025873be3e795f32dbb58ee3b8` |

Inputs: cNGN `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f`, USDT `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`,
Chainlink NGN/USD `0xc17cBE2dB40e53F4984C46F608DA6DA1fF074c11`, Textile LimitOrderReactor
`0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3`, VaultOrderExecutor `0x01b006d5c687bde182aa36F542f1f014144742e2`,
agent `0xA2A173A481BC063fEE0EF11c67Fc756DC5f928f4`. `pnpm verify:deploy` passed.

Verification: VaultFactory verified on Celoscan. Vault is an exact runtime match on Sourcify; Celoscan rejects it because
the 35-byte ERC-8021 suffix trails the initcode and is not ABI-encoded constructor args.
