import { describe, expect, it } from 'vitest';
import {
  AVATAR_PRESETS,
  INITIALS_FACE,
  avatarStorageKey,
  faceFor,
  parseAvatarChoice,
  readAvatarChoice,
  writeAvatarChoice,
  type AvatarStore,
} from './avatar';

function memoryStore(): AvatarStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

/** WCAG relative-luminance contrast. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = hex.replace('#', '');
    const channel = (i: number) => {
      const c = parseInt(n.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, bch] = [channel(0), channel(2), channel(4)];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bch;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('avatar storage', () => {
  const lower = '0x5cd6960f36e178852d75acec9bf3796f0e21ac89';
  const other = '0x1111111111111111111111111111111111111111';

  it('keys the choice by checksummed address', () => {
    const key = avatarStorageKey(lower);
    expect(key).toBe('ng.avatar.0x5cd6960f36E178852D75ACEC9Bf3796F0e21ac89');
    expect(avatarStorageKey(lower.toUpperCase().replace('0X', '0x'))).toBe(key);
    expect(avatarStorageKey(other)).not.toBe(key);
  });

  it('stores a preset for one address and leaves initials absent', () => {
    const store = memoryStore();
    expect(readAvatarChoice(store, lower)).toBe('initials');
    writeAvatarChoice(store, lower, 'naira');
    expect(store.getItem(avatarStorageKey(lower))).toBe('naira');
    expect(readAvatarChoice(store, lower)).toBe('naira');
    expect(readAvatarChoice(store, other)).toBe('initials');
    writeAvatarChoice(store, lower.toUpperCase().replace('0X', '0x'), 'shield');
    expect(readAvatarChoice(store, lower)).toBe('shield');
    writeAvatarChoice(store, lower, 'initials');
    expect(store.getItem(avatarStorageKey(lower))).toBeNull();
    expect(readAvatarChoice(store, lower)).toBe('initials');
  });

  it('treats unknown and explicit initials values as the default', () => {
    expect(parseAvatarChoice(null)).toBe('initials');
    expect(parseAvatarChoice('initials')).toBe('initials');
    expect(parseAvatarChoice('upload')).toBe('initials');
    expect(parseAvatarChoice('leaf')).toBe('leaf');
  });
});

describe('avatar presets', () => {
  it('offers 8–12 brand marks including a readable naira', () => {
    expect(AVATAR_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(AVATAR_PRESETS.length).toBeLessThanOrEqual(12);
    const ids = AVATAR_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('naira');
    const naira = faceFor('naira');
    expect(contrast(naira.ink, naira.from)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(naira.ink, naira.to)).toBeGreaterThanOrEqual(4.5);
    expect(naira.ink.toLowerCase()).not.toBe('#06261a');
  });

  it('keeps every disc readable on both gradient stops', () => {
    const faces = [...AVATAR_PRESETS, { id: 'initials', ...INITIALS_FACE }];
    for (const face of faces) {
      expect(contrast(face.ink, face.from), face.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(face.ink, face.to), face.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});
