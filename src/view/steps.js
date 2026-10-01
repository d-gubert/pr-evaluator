// @ts-check
// Session → View. Knows the Session model only, never a log format.

import { clip, quote, num, ktok, plural, times, duration, countNames } from './text.js';

/** @typedef {import('../model.js').Session} Session */
/** @typedef {import('../model.js').SessionEvent} SessionEvent */
/** @typedef {import('../model.js').Hook} Hook */
/** @typedef {import('../model.js').ToolCall} ToolCall */
/** @typedef {import('../model.js').Usage} Usage */
/** @typedef {Extract<SessionEvent, {type: 'request'}>} RequestEvent */

/**
 * @typedef {'loop'|'http'|'tool'|'hook'|'ui'} Kind
 * @typedef {object} Step
 * @property {string} t      title
 * @property {Kind[]} k      tags; k[0] sets the color in the step list
 * @property {string} d      description
 * @property {string} c      code block text
 * @property {number} turn   loop turn number (0 before the first request)
 * @property {number} ctx    context tokens (carried forward)
 * @property {string} ts     ISO timestamp or ""
 * @typedef {object} ViewMeta
 * @property {string} file
 * @property {string} sessionId
 * @property {string} firstPrompt
 * @property {string} gitBranch
 * @property {string} harnessName
 * @property {number} turns     number of request events
 * @property {number} window    context window in tokens
 * @typedef {{meta: ViewMeta, steps: Step[]}} View
 */

const MAX_CODE_LINES = 60;
const RESULT_LINES = 3;

// ---------------------------------------------------------------- helpers

/** @param {ToolCall['name']} name @param {any} input */
function toolArg(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick =
    input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ??
    input.query ?? input.description ?? input.skill ?? input.prompt ?? input.path;
  if (typeof pick === 'string') return quote(pick, 110);
  if (name === 'TodoWrite') return '';
  return clip(JSON.stringify(input), 110);
}

/** @param {any} input */
function todoLines(input) {
  if (!Array.isArray(input?.todos)) return [];
  /** @type {Record<string, string>} */
  const box = { completed: '[x]', in_progress: '[~]' };
  return input.todos.slice(0, 12).map((/** @type {any} */ t) => `  ${box[t.status] || '[ ]'} ${clip(t.content, 90)}`);
}

/** @param {Hook} h */
const hookLine = h =>
  `hook: ${h.name} → ${h.outcome}` + (h.command ? `\n  $ ${clip(h.command, 100)}` : '') + (h.detail ? `\n  ${quote(h.detail)}` : '');

/** Context tokens of a request, or null when the log has no usage.
 * @param {RequestEvent} e
 * @returns {number|null}
 */
function ctxOf(e) {
  const u = e.usage;
  if (!u) return null;
  return (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
}

/** @param {Session} session */
function contextWindow(session) {
  const w = session.meta.contextWindow;
  if (typeof w === 'number') return w;
  const reqs = /** @type {RequestEvent[]} */ (session.events.filter(e => e.type === 'request'));
  const maxCtx = Math.max(0, ...reqs.map(e => ctxOf(e) || 0));
  const models = [...(session.meta.models || []), ...reqs.map(e => e.model)];
  return maxCtx > 200000 || models.some(m => /\[1m\]/i.test(m || '')) ? 1000000 : 200000;
}

// ---------------------------------------------------------------- view

/**
 * @param {Session} session
 * @returns {View}
 */
export function toView(session) {
  const { meta, events } = session;
  const reqs = events.filter(e => e.type === 'request');
  const view = {
    file: meta.file,
    sessionId: meta.sessionId,
    firstPrompt: meta.firstPrompt,
    gitBranch: meta.gitBranch,
    harnessName: meta.harnessName,
    turns: reqs.length,
    window: contextWindow(session),
  };
  return { meta: view, steps: render(session) };
}

/** @param {Session} session @returns {Step[]} */
function render(session) {
  const { events } = session;
  let turn = 0;
  let ctx = 0;
  let promptNo = 0;
  // The turn number of each request event, by event index.
  /** @type {Map<number, number>} */
  const turnAt = new Map();
  let n = 0;
  events.forEach((e, i) => {
    if (e.type === 'request') turnAt.set(i, ++n);
  });

  return events.map((e, i) => {
    if (e.type === 'request') {
      turn = /** @type {number} */ (turnAt.get(i));
      ctx = ctxOf(e) ?? ctx;
    }
    if (e.type === 'compaction') {
      // The compaction step shows the context of the first request after it.
      for (let j = i + 1; j < events.length; j++) {
        const x = events[j];
        if (x.type === 'request' && ctxOf(x) != null) {
          ctx = /** @type {number} */ (ctxOf(x));
          break;
        }
      }
    }
    if (e.type === 'prompt') promptNo++;
    const out = describe(session, i, promptNo, turnAt);
    const code = out.c.split('\n');
    if (code.length > MAX_CODE_LINES) out.c = code.slice(0, MAX_CODE_LINES).join('\n') + `\n… (${code.length - MAX_CODE_LINES} more lines)`;
    return { ...out, turn, ctx, ts: ('ts' in e && e.ts) || '' };
  });
}

/**
 * @param {Session} session
 * @param {number} i
 * @param {number} promptNo
 * @param {Map<number, number>} turnAt
 * @returns {{t: string, k: Kind[], d: string, c: string}}
 */
function describe(session, i, promptNo, turnAt) {
  const { meta, events } = session;
  const s = events[i];
  const who = meta.harnessName;
  const hooks = 'hooks' in s ? s.hooks : [];
  /** @type {Kind[]} */
  const hookK = hooks.length ? ['hook'] : [];
  switch (s.type) {
    case 'session_start': {
      const d = [`${who} ${meta.version || ''} starts`.replace(/\s+starts/, ' starts') + (meta.cwd ? ` in ${meta.cwd}` : '') + '.'];
      d.push(hooks.length ? `The SessionStart hook runs ${times(hooks.length)}. Its stdout can add context to the session.` : 'The transcript records no SessionStart hook.');
      const c = [
        `session: ${meta.sessionId}`,
        meta.cwd && `cwd:     ${meta.cwd}`,
        meta.gitBranch && `branch:  ${meta.gitBranch}`,
        `version: ${meta.version || '?'}` + (meta.entrypoint ? `   entry: ${meta.entrypoint}` : ''),
        meta.models.length && `model:   ${meta.models.join(', ')}`,
        ...hooks.map(hookLine),
      ];
      return { t: 'Session starts', k: hooks.length ? ['hook', 'loop'] : ['loop'], d: d.join(' '), c: c.filter(Boolean).join('\n') };
    }
    case 'context':
      return {
        t: 'Build the context',
        k: ['loop'],
        d: `${who} builds the system prompt and the tool definitions. It adds the skills, the agents, and the MCP servers. The transcript records the parts below.`,
        c: s.items.join('\n'),
      };
    case 'prompt': {
      const d = ['You type the request.'];
      if (hooks.length) d.push(`The UserPromptSubmit hook runs ${times(hooks.length)}. The hook can block the prompt or add context to it.`);
      d.push('The agent loop starts.');
      const lines = s.text.split('\n').slice(0, 12).map(l => '> ' + l);
      return { t: promptNo > 1 ? `User sends prompt ${promptNo}` : 'User sends the prompt', k: ['ui', ...hookK], d: d.join(' '), c: [...lines, '', ...hooks.map(hookLine)].join('\n').trimEnd() };
    }
    case 'command': {
      const out = (s.output || '').split('\n').filter(l => l.trim()).slice(0, 8).map(l => '→ ' + clip(l));
      const name = s.name === '!' ? 'a shell command' : `the command ${s.name}`;
      return {
        t: s.name === '!' ? 'You run a shell command' : `Slash command ${s.name}`,
        k: ['ui', ...hookK],
        d: `You run ${name}. ${who} handles it in the CLI.`,
        c: [`> ${s.name === '!' ? '! ' : s.name + ' '}${s.args}`.trimEnd(), ...out, ...hooks.map(hookLine)].join('\n'),
      };
    }
    case 'interrupt':
      return { t: 'You interrupt the turn', k: ['ui', 'loop'], d: `You stop the agent loop. ${who} waits for your next prompt.`, c: '[Request interrupted by user]' };
    case 'notice':
      return { t: `${who} adds a message`, k: ['loop'], d: `${who} writes this assistant message itself. No API request occurs.`, c: clip(s.text, 400) };
    case 'api_error':
      return {
        t: s.count > 1 ? `API error ×${s.count}` : 'API error',
        k: ['http'],
        d: `The Messages API returns an error. ${who} waits and sends the request again.`,
        c: `POST /v1/messages\n← error: ${clip(s.message, 140)}` + (s.count > 1 ? `\nretries: ${s.count}` : ''),
      };
    case 'compaction': {
      const d = [s.trigger === 'manual' ? 'You run /compact.' : `The context comes close to the limit, so ${who} compacts it.`];
      if (hooks.length) d.push('The PreCompact hook runs first.');
      d.push('One extra API request writes a summary. The summary replaces the old messages.');
      const sum = (s.summary || '').split('\n').filter(l => l.trim()).slice(0, 6).map(l => '  ' + clip(l, 120));
      const c = [...hooks.map(hookLine), `trigger: "${s.trigger}"` + (s.preTokens ? `   before: ${num(s.preTokens)} tokens` : ''), 'POST /v1/messages  → summary of the conversation', 'messages = [summary, recent turns]', ...(sum.length ? ['', 'summary:', ...sum] : [])];
      return { t: s.trigger === 'manual' ? 'Compact (manual)' : 'Auto-compact', k: ['loop', 'http', ...hookK], d: d.join(' '), c: c.join('\n') };
    }
    case 'stop_hooks': {
      const next = events[i + 1];
      const continued = next && next.type === 'request';
      const infos = hooks.length ? hooks.map(hookLine) : (s.commands || []).map(cmd => `hook: Stop\n  $ ${clip(cmd, 100)}`);
      const errs = hooks.length ? [] : (s.errors || []).map(e => `→ ${quote(e, 140)}`);
      const d = ['The Stop hook runs when the loop exits.'];
      if (continued) d.push('The hook returns a block decision. The loop continues with the reason as input.');
      else if (s.prevented) d.push('The hook stops the session.' + (s.reason ? ` The reason is: ${clip(s.reason, 80)}` : ''));
      else d.push('The hook lets the loop exit.');
      return { t: 'Stop hook', k: ['hook', 'loop'], d: d.join(' '), c: [...infos, ...errs, continued ? `→ loop continues (turn ${turnAt.get(i + 1)}) …` : ''].join('\n').trimEnd() };
    }
    case 'request':
      return describeRequest(s, /** @type {number} */ (turnAt.get(i)));
    case 'session_end':
      return describeEnd(session, s);
  }
  return { t: 'event', k: ['loop'], d: '', c: '' };
}

/**
 * @param {RequestEvent} s
 * @param {number} n  turn number
 */
function describeRequest(s, n) {
  /** @type {Partial<Usage>} */
  const u = s.usage || {};
  const ctx = ctxOf(s) || 0;
  const tools = s.tools;
  const status = tools.map(t => t.status);
  const errors = status.filter(x => x === 'error').length;
  const rejected = status.filter(x => x === 'rejected').length;
  const toolHooks = tools.reduce((m, t) => m + t.pre.length + t.post.length, 0);
  const blocked = tools.filter(t => t.pre.some(h => h.outcome === 'block' || h.outcome === 'deny')).length;
  const allHooks = toolHooks + s.hooks.length;

  const title = `Turn ${n}: ` + (tools.length ? countNames(tools.map(t => t.name)) : s.stopReason === 'end_turn' ? 'end_turn' : s.stopReason || 'text reply');
  /** @type {Kind[]} */
  const k = ['http', tools.length ? 'tool' : 'loop'];
  if (allHooks) k.push('hook');
  if (rejected || status.includes('interrupted')) k.push('ui');

  const d = [`The agent loop sends request ${n} to the Messages API with ${ktok(ctx)} tokens of context.`];
  if (s.blocks.some(b => b.type === 'thinking' || b.type === 'redacted_thinking')) d.push('The model thinks first.');
  if (tools.length === 1) d.push(`The model asks for one tool: ${tools[0].name}.`);
  else if (tools.length > 1) d.push(`The model asks for ${tools.length} tools in one response.`);
  if (toolHooks) d.push(`The PreToolUse and PostToolUse hooks run ${times(toolHooks)}.`);
  if (blocked) d.push(`A PreToolUse hook blocks ${plural(blocked, 'tool call')}.`);
  if (rejected) d.push(`You reject ${plural(rejected, 'tool call')}.`);
  if (errors) d.push(`${plural(errors, 'tool call')} ${errors === 1 ? 'returns' : 'return'} an error.`);
  if (tools.length) d.push('The results go into messages[] as tool_result blocks.');
  else if (s.stopReason === 'end_turn') d.push('The model returns text with no tool_use. The agent loop exits.');
  else if (s.stopReason === 'max_tokens') d.push('The response reaches the max_tokens limit.');

  const c = [
    `POST /v1/messages   model: ${s.model || '?'}`,
    `  context: ${num(ctx)} tokens (cache read ${num(u.cacheRead)} · cache write ${num(u.cacheWrite)} · new ${num(u.input)})`,
  ];
  for (const b of s.blocks) {
    if (b.type === 'thinking') {
      c.push(b.text ? `← thinking: ${quote(b.text, 110)}` : `← thinking${u.thinking ? ` (${num(u.thinking)} tokens)` : ''}`);
    } else if (b.type === 'redacted_thinking') c.push('← thinking (redacted)');
    else if (b.type === 'text' && b.text?.trim()) c.push(`← text: ${quote(b.text, 200)}`);
    else if (b.type === 'tool_use') {
      const tool = tools.find(t => t.id === b.toolId);
      if (!tool) {
        c.push('← tool_use: ?');
        continue;
      }
      c.push(`← tool_use: ${tool.name}  ${toolArg(tool.name, tool.input)}`.trimEnd());
      if (tool.name === 'TodoWrite') c.push(...todoLines(tool.input));
    } else if (b.type === 'server_tool_use') c.push(`← server_tool_use: ${b.name}  ${toolArg(b.name, b.input)}`.trimEnd());
  }
  c.push(`← stop_reason: "${s.stopReason || '?'}"   output: ${num(u.output)} tokens`);

  if (tools.length) c.push('');
  /** @type {Record<string, string>} */
  const marks = { ok: '✓', error: '✗ error', rejected: '✗ rejected by you', interrupted: '✗ interrupted', 'no result': '… no result' };
  tools.forEach((t, j) => {
    c.push(...t.pre.map(hookLine));
    c.push(`tool: ${t.name} ${marks[status[j]]}`);
    if (t.result) {
      const lines = t.result.text.split('\n').filter(l => l.trim());
      c.push(...lines.slice(0, RESULT_LINES).map(l => '  → ' + clip(l, 120)));
      if (lines.length > RESULT_LINES) c.push(`  → … (${lines.length - RESULT_LINES} more lines)`);
    }
    if (t.subagent) {
      c.push(`  subagent: ${plural(t.subagent.toolCalls || 0, 'tool call')} · ${num(t.subagent.tokens)} tokens · ${duration(t.subagent.durationMs)}`);
    }
    c.push(...t.post.map(hookLine));
  });
  const results = tools.filter(t => t.result).length;
  if (results) c.push(`messages += tool_result ×${results}`);
  if (s.hooks.length) c.push('', ...s.hooks.map(hookLine));
  return { t: title, k, d: d.join(' '), c: c.join('\n') };
}

/**
 * @param {Session} session
 * @param {Extract<SessionEvent, {type: 'session_end'}>} s
 * @returns {{t: string, k: Kind[], d: string, c: string}}
 */
function describeEnd(session, s) {
  const { meta, events } = session;
  const reqs = /** @type {RequestEvent[]} */ (events.filter(x => x.type === 'request'));
  const tools = reqs.flatMap(x => x.tools);
  const hookRuns = events.reduce((n, x) => {
    const own = 'hooks' in x ? x.hooks.length : 0;
    const toolHooks = x.type === 'request' ? x.tools.reduce((m, t) => m + t.pre.length + t.post.length, 0) : 0;
    return n + own + toolHooks;
  }, 0);
  /** @param {'input'|'cacheRead'|'cacheWrite'|'output'} key */
  const sum = key => reqs.reduce((n, x) => n + (x.usage?.[key] || 0), 0);
  const ms = Date.parse(meta.endedAt) - Date.parse(meta.startedAt);
  const last = [...reqs].reverse().find(x => x.usage);
  const d = [
    `The transcript ends. The session lasts ${duration(ms)}.`,
    `It has ${plural(reqs.length, 'API request')}, ${plural(tools.length, 'tool call')}, and ${plural(hookRuns, 'recorded hook run')}.`,
  ];
  if (s.hooks.length) d.push('The SessionEnd hook runs for cleanup or logs.');
  const c = [
    `requests:   ${reqs.length}`,
    `tool calls: ${tools.length}` + (tools.length ? `  (${countNames(tools.map(t => t.name))})` : ''),
    `hook runs:  ${hookRuns}`,
    `tokens:     output ${num(sum('output'))} · cache read ${num(sum('cacheRead'))} · cache write ${num(sum('cacheWrite'))} · new ${num(sum('input'))}`,
    last && `last context: ${num(ctxOf(last))} tokens`,
    ...s.hooks.map(hookLine),
  ];
  return { t: 'Session ends', k: ['ui', ...(s.hooks.length ? /** @type {Kind[]} */ (['hook']) : [])], d: d.join(' '), c: c.filter(Boolean).join('\n') };
}
