import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toFunctionSignature } from 'viem';
import { describe, expect, it } from 'vitest';
import { factoryAbi } from './vault';

const src = (f: string) => readFileSync(join(__dirname, '../../contracts/src', f), 'utf8');

/** Solidity struct Limits from Vault.sol → canonical tuple type, e.g. (uint256,uint256,...). */
function limitsTuple(): string {
  const body = /struct Limits\s*\{([^}]*)\}/.exec(src('Vault.sol'))?.[1];
  if (!body) throw new Error('struct Limits not found');
  const types = body.split(';').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  return `(${types.join(',')})`;
}

describe('dashboard factory ABI matches contracts/src', () => {
  it('createVault takes exactly Vault.Limits', () => {
    expect(src('VaultFactory.sol')).toMatch(/function createVault\(Vault\.Limits calldata \w+\) external returns \(address \w+\)/);
    const item = factoryAbi.find((x) => x.type === 'function' && x.name === 'createVault');
    expect(item && toFunctionSignature(item as never)).toBe(`createVault(${limitsTuple()})`);
  });
  it('vaultOf / VaultExists are in VaultFactory.sol', () => {
    const f = src('VaultFactory.sol');
    expect(f).toMatch(/mapping\(address( \w+)? => address( \w+)?\) public vaultOf/);
    expect(f).toMatch(/error VaultExists\(\)/);
  });
});
