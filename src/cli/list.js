// @ts-check
// The session list as text. Knows SessionInfo only.

/** @typedef {import('../sources/index.js').SessionInfo} SessionInfo */

const DEFAULT_COLUMNS = 100;
const MAX_PROJECT = 28;
const MIN_PROMPT = 10;

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0');

/** Local time, YYYY-MM-DD HH:MM. @param {Date} d */
function stamp(d) {
  if (Number.isNaN(d.getTime())) return '----------------';
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * Clip to `max` characters; a clipped text ends with "…".
 * @param {string} s
 * @param {number} max
 */
function clip(s, max) {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return max <= 0 ? '' : chars.slice(0, max - 1).join('') + '…';
}

/** Keep the end of a long project path. @param {string} s @param {number} max */
function clipStart(s, max) {
  const chars = Array.from(s);
  return chars.length <= max ? s : '…' + chars.slice(chars.length - (max - 1)).join('');
}

/**
 * One line per session: index, local date and time, project, first prompt.
 * Every line fits `columns` (default 100).
 * @param {SessionInfo[]} sessions
 * @param {{columns?: number}} [opts]
 * @returns {string}  lines joined with "\n", ending with "\n"; "" for no sessions
 */
export function formatSessionList(sessions, opts = {}) {
  if (!sessions.length) return '';
  const columns = opts.columns && opts.columns > 0 ? opts.columns : DEFAULT_COLUMNS;
  const indexWidth = String(sessions.length).length;
  const projects = sessions.map((s) => clipStart(s.project || '', MAX_PROJECT));
  const projectWidth = Math.max(...projects.map((p) => Array.from(p).length));
  // "<index>  <date>  <project>  <prompt>"
  const fixed = indexWidth + 2 + 16 + 2 + projectWidth + 2;
  const promptWidth = Math.max(MIN_PROMPT, columns - fixed);

  const lines = sessions.map((s, i) => {
    const prompt = s.firstPrompt.replace(/\s+/g, ' ').trim() || '(no prompt)';
    const project = projects[i] + ' '.repeat(projectWidth - Array.from(projects[i]).length);
    const line = `${String(i + 1).padStart(indexWidth)}  ${stamp(s.modifiedAt)}  ${project}  ${clip(prompt, promptWidth)}`;
    return clip(line, columns);
  });
  return lines.join('\n') + '\n';
}
