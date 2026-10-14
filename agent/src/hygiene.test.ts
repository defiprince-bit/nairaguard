import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('tx hygiene', () => {
  it('only txBuilder.ts creates wallet clients or sends transactions', () => {
    const dir = join(__dirname);
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'txBuilder.ts')
      .filter((f) => /createWalletClient|\.sendTransaction\(|\.writeContract\(/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
