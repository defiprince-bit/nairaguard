import { getAddress } from 'viem';

/**
 * Wallet avatar choice, stored per checksummed address.
 * Key: `ng.avatar.<checksumAddress>`. Missing or `initials` means the default
 * (first two hex characters of the address — see `initials` in overviewView).
 */
export const AVATAR_PRESETS = [
  { id: 'shield', label: 'Shield', from: '#9aefc8', to: '#d4f56e', angle: 135, ink: '#06261a' },
  { id: 'naira', label: 'Naira', from: '#03150c', to: '#0f7a4f', angle: 160, ink: '#f4ffd0' },
  { id: 'leaf', label: 'Leaf', from: '#b6f7d4', to: '#c6f36b', angle: 135, ink: '#06261a' },
  { id: 'bolt', label: 'Lightning', from: '#d4f56e', to: '#f3ffb4', angle: 135, ink: '#06261a' },
  { id: 'eagle', label: 'Eagle', from: '#062016', to: '#124a32', angle: 150, ink: '#f4ffd0' },
  { id: 'globe', label: 'Globe', from: '#c9f6e0', to: '#7df0b0', angle: 135, ink: '#06261a' },
  { id: 'gem', label: 'Gem', from: '#8eebc0', to: '#d2f07a', angle: 135, ink: '#06261a' },
  { id: 'moon', label: 'Moon', from: '#03140e', to: '#0e3324', angle: 160, ink: '#f4ffd0' },
  { id: 'sun', label: 'Sun', from: '#e7f58a', to: '#ffe7a3', angle: 135, ink: '#06261a' },
  { id: 'rocket', label: 'Rocket', from: '#071f16', to: '#14553a', angle: 155, ink: '#f4ffd0' },
  { id: 'lion', label: 'Lion', from: '#c6f36b', to: '#9aefc4', angle: 140, ink: '#06261a' },
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESETS)[number]['id'];
export type AvatarChoice = AvatarPresetId | 'initials';

/** Same mint→lime disc the header used before presets existed. */
export const INITIALS_FACE = { from: '#7df0b0', to: '#c6f36b', angle: 135, ink: '#06261a' } as const;

const PRESET_IDS = new Set<string>(AVATAR_PRESETS.map((preset) => preset.id));

export type AvatarFace = { from: string; to: string; angle: number; ink: string };

export function faceFor(choice: AvatarChoice): AvatarFace {
  if (choice === 'initials') return INITIALS_FACE;
  for (const preset of AVATAR_PRESETS) {
    if (preset.id === choice) return preset;
  }
  return INITIALS_FACE;
}

export function avatarStorageKey(address: string): string {
  const checksum = checksumAddress(address);
  return `ng.avatar.${checksum ?? address}`;
}

export function parseAvatarChoice(raw: string | null | undefined): AvatarChoice {
  if (raw && PRESET_IDS.has(raw)) return raw as AvatarPresetId;
  return 'initials';
}

export type AvatarStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export function readAvatarChoice(store: Pick<AvatarStore, 'getItem'>, address: string): AvatarChoice {
  try {
    return parseAvatarChoice(store.getItem(avatarStorageKey(address)));
  } catch {
    return 'initials';
  }
}

/** Preset ids are written; initials removes the key so the default stays "absent". */
export function writeAvatarChoice(store: AvatarStore, address: string, choice: AvatarChoice): void {
  const key = avatarStorageKey(address);
  if (choice === 'initials') store.removeItem(key);
  else store.setItem(key, choice);
}

const listeners = new Set<() => void>();

export function subscribeAvatar(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitAvatar(): void {
  listeners.forEach((listener) => listener());
}

export function loadAvatarChoice(address: string): AvatarChoice {
  try {
    if (typeof window === 'undefined') return 'initials';
    return readAvatarChoice(window.localStorage, address);
  } catch {
    return 'initials';
  }
}

export function saveAvatarChoice(address: string, choice: AvatarChoice): void {
  try {
    writeAvatarChoice(window.localStorage, address, choice);
  } catch {
    /* private mode */
  }
  emitAvatar();
}

function checksumAddress(address: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  try {
    return getAddress(address as `0x${string}`);
  } catch {
    return null;
  }
}
