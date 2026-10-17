/**
 * Tiny Markdown subset parser for the legal pages (/terms, /privacy).
 * Supports: # / ## headings, paragraphs (single newlines become line breaks), "- " lists,
 * "---" rules, **bold**, `code` and bare https:// links. HTML comments are dropped.
 * Text is never interpreted as HTML, so [PLACEHOLDER] text renders exactly as written.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; v: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; v: string; href: string }
  | { t: 'br' };

export type Block =
  | { t: 'h1' | 'h2' | 'p'; v: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'hr' };

const URL_RE = /https?:\/\/[^\s\]\)<>"]+[^\s\]\)<>".,;:!?]/g;

function linkify(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    if (m.index! > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    out.push({ t: 'link', v: m[0], href: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let buf = '';
  const flush = () => { if (buf) { out.push(...linkify(buf)); buf = ''; } };
  while (i < s.length) {
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end > i) { flush(); out.push({ t: 'code', v: s.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (s.startsWith('**', i)) {
      const end = s.indexOf('**', i + 2);
      if (end > i + 1) { flush(); out.push({ t: 'strong', v: parseInline(s.slice(i + 2, end)) }); i = end + 2; continue; }
    }
    buf += s[i];
    i += 1;
  }
  flush();
  return out;
}

export function parseLegalMarkdown(md: string): Block[] {
  const text = md.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const endPara = () => {
    if (!para.length) return;
    const v: Inline[] = [];
    para.forEach((line, n) => { if (n) v.push({ t: 'br' }); v.push(...parseInline(line)); });
    blocks.push({ t: 'p', v });
    para = [];
  };
  const endList = () => { if (list.length) { blocks.push({ t: 'ul', items: list.map(parseInline) }); list = []; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { endPara(); endList(); continue; }
    if (/^-{3,}$/.test(line)) { endPara(); endList(); blocks.push({ t: 'hr' }); continue; }
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    if (h) { endPara(); endList(); blocks.push({ t: h[1].length === 1 ? 'h1' : 'h2', v: parseInline(h[2]) }); continue; }
    if (line.startsWith('- ')) { endPara(); list.push(line.slice(2)); continue; }
    endList();
    para.push(line);
  }
  endPara();
  endList();
  return blocks;
}

/** Plain text of the parsed document (for tests and metadata). */
export function plainText(blocks: Block[]): string {
  const inl = (v: Inline[]): string => v.map((x) => (x.t === 'br' ? '\n' : x.t === 'strong' ? inl(x.v) : x.v)).join('');
  return blocks.map((b) => (b.t === 'hr' ? '' : b.t === 'ul' ? b.items.map(inl).join('\n') : inl(b.v))).join('\n');
}
