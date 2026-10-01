// View → HTML. Renders one self-contained page from a View. Knows no log format.

import { readFileSync } from 'node:fs';
import type { View } from '../view/steps.js';

// page.html is not compiled. The build copies it next to this module, so the
// same path works from src/ and from dist/ (see scripts/dist.mjs).
const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');

const escapeHtml = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderHtml(view: View): string {
  const json = JSON.stringify(view)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const name = escapeHtml(view.meta.harnessName || 'Agent');
  return PAGE.replace(/\/\*__(HARNESS|DATA)__\*\//g, (_, key: string) => (key === 'DATA' ? json : name));
}
