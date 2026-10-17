import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseInline, parseLegalMarkdown, plainText } from './legalMarkdown';

const read = (f: string) => readFileSync(join(__dirname, '..', 'content', 'legal', f), 'utf8');

describe('parseLegalMarkdown', () => {
  it('parses headings, lists, rules and line-broken paragraphs', () => {
    const b = parseLegalMarkdown('# T\n\n**A:** x\n**B:** y\n\n---\n\n## S\n- one\n- two\n');
    expect(b.map((x) => x.t)).toEqual(['h1', 'p', 'hr', 'h2', 'ul']);
    expect(b[1]).toMatchObject({ t: 'p', v: [{ t: 'strong' }, { t: 'text', v: ' x' }, { t: 'br' }, { t: 'strong' }, { t: 'text', v: ' y' }] });
  });

  it('keeps bracket placeholders literal, handles code and links', () => {
    expect(parseInline('Run by [PUBLISHER NAME].')).toEqual([{ t: 'text', v: 'Run by [PUBLISHER NAME].' }]);
    expect(parseInline('`[FEES: x]` see [https://x.com/NairaGuardHQ].')).toEqual([
      { t: 'code', v: '[FEES: x]' }, { t: 'text', v: ' see [' },
      { t: 'link', v: 'https://x.com/NairaGuardHQ', href: 'https://x.com/NairaGuardHQ' }, { t: 'text', v: '].' },
    ]);
  });

  for (const f of ['terms.md', 'privacy.md']) {
    it(`${f}: drops the template banner and keeps every placeholder`, () => {
      const md = read(f);
      const text = plainText(parseLegalMarkdown(md));
      expect(text).not.toMatch(/NOT LEGAL ADVICE/);
      const visible = md.replace(/<!--[\s\S]*?-->/g, '');
      const placeholders = visible.match(/\[[A-Z][A-Z0-9 /'’"().,:;=—-]*(?:[^\]]*)\]/g) ?? [];
      expect(placeholders.length).toBeGreaterThan(3);
      for (const p of placeholders) expect(text).toContain(p);
      expect(text).toContain('[PUBLISHER NAME]');
    });
  }
});
