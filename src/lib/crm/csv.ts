/**
 * Minimal RFC-4180 CSV reader and writer: quoted fields, embedded commas
 * and newlines, "" escapes, CRLF or LF. Ported from
 * scripts/lib/outreach-csv.mjs so the admin import and the CLI parse
 * outreach/leads.csv identically.
 */

export interface ParsedCsv {
  header: string[];
  rows: Array<Record<string, string>>;
}

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // A UTF-8 BOM (Excel, Google Sheets exports) would otherwise stick to
  // the first header name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const clean = rows.filter((r) => r.some((v) => v.trim() !== ''));
  const header = (clean.shift() ?? []).map((h) => h.trim());
  return {
    header,
    rows: clean.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))),
  };
}

export function toCsv(header: string[], rows: Array<Record<string, string | null | undefined>>): string {
  const cell = (v: string | null | undefined = '') => {
    const s = v ?? '';
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (
    [header.join(','), ...rows.map((r) => header.map((h) => cell(r[h])).join(','))].join('\n') + '\n'
  );
}
