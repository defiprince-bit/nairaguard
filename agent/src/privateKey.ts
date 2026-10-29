/**
 * Read and validate a hex private key from the environment.
 * Errors never include the key value itself.
 */
export function readPrivateKey(
  env: Record<string, string | undefined> = process.env,
  name = 'AGENT_PRIVATE_KEY',
): `0x${string}` {
  const raw = env[name]?.trim();
  if (!raw) throw new Error(`${name} is required (0x-prefixed 32-byte hex private key)`);
  const hex = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error(`${name} must be hexadecimal (0-9, a-f)`);
  if (hex.length !== 64) {
    throw new Error(`${name} must be 32 bytes (64 hex chars, optional 0x prefix); got ${hex.length} hex chars`);
  }
  if (/^0+$/.test(hex)) throw new Error(`${name} must not be zero`);
  return `0x${hex.toLowerCase()}`;
}
