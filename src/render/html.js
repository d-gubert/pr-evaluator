// @ts-check
// View → HTML. Renders one self-contained page from a View. Knows no log format.

import { readFileSync } from 'node:fs';

/** @typedef {import('../view/steps.js').View} View */

const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');

/** @param {string} s */
const escapeHtml = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {View} view
 * @returns {string}
 */
export function renderHtml(view) {
  const json = JSON.stringify(view)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const name = escapeHtml(view.meta?.harnessName || 'Agent');
  return PAGE.replace(/\/\*__(HARNESS|DATA)__\*\//g, (_, key) => (key === 'DATA' ? json : name));
}
