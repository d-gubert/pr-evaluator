#!/usr/bin/env node
// session-trace: read a Claude Code session transcript (.jsonl) and write the
// step-through "session trace" page with the data of that session.
//
//   node session-trace.mjs [session.jsonl | session-id] [-o out.html] [--stdout]
//
// With no argument, the script takes the newest session of the current
// directory from ~/.claude/projects (or $CLAUDE_CONFIG_DIR/projects).

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const MAX_LINE = 160;
const MAX_CODE_LINES = 60;
const RESULT_LINES = 3;

// ---------------------------------------------------------------- helpers

const clip = (s, n = MAX_LINE) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const quote = (s, n = 100) => JSON.stringify(clip(s, n));
const num = n => Number(n || 0).toLocaleString('en-US');
const ktok = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const times = n => (n === 1 ? 'one time' : `${n} times`);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
}

function countNames(names) {
  const m = new Map();
  for (const n of names) m.set(n, (m.get(n) || 0) + 1);
  return [...m].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
}

function duration(ms) {
  if (!(ms >= 0)) return 'an unknown time';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function readRecords(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A session that is still open can end in a partial line.
    }
  }
  return out;
}

// ---------------------------------------------------------------- tools

function toolArg(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick =
    input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ??
    input.query ?? input.description ?? input.skill ?? input.prompt ?? input.path;
  if (typeof pick === 'string') return quote(pick, 110);
  if (name === 'TodoWrite') return '';
  return clip(JSON.stringify(input), 110);
}

function todoLines(input) {
  if (!Array.isArray(input?.todos)) return [];
  const box = { completed: '[x]', in_progress: '[~]' };
  return input.todos.slice(0, 12).map(t => `  ${box[t.status] || '[ ]'} ${clip(t.content, 90)}`);
}

function resultText(block) {
  const c = block.content;
  let text = typeof c === 'string' ? c : textOf(c);
  if (Array.isArray(c) && c.some(b => b.type === 'image')) text += '\n[image]';
  return text;
}

const DENIED = /doesn't want to proceed|was rejected|user rejected|denied (this|the) (tool|request)|permission.*denied/i;
const INTERRUPTED = /^\[Request interrupted by user/;

function toolStatus(t) {
  if (!t.result) return 'no result';
  const text = resultText(t.result);
  if (INTERRUPTED.test(text)) return 'interrupted';
  if (t.result.is_error && DENIED.test(text)) return 'rejected';
  if (t.result.is_error) return 'error';
  return 'ok';
}

// ---------------------------------------------------------------- hooks

function hookFromAttachment(a) {
  const event = a.hookEvent || String(a.hookName || '').split(':')[0] || 'Hook';
  const outcome = {
    hook_success: 'ok',
    hook_additional_context: 'context added',
    hook_blocking_error: 'block',
    hook_non_blocking_error: 'error',
    hook_error_during_execution: 'error',
    hook_cancelled: 'cancelled',
    hook_stopped_continuation: 'stop',
    hook_permission_decision: a.decision || 'decision',
  }[a.type] || a.type.replace(/^hook_/, '');
  const detail = [a.content, a.stdout, a.stderr, a.blockingError?.blockingError, a.message, a.reason]
    .map(v => (Array.isArray(v) ? v.join(' ') : v))
    .find(v => typeof v === 'string' && v.trim());
  return { event, name: a.hookName || event, outcome, detail: detail ? clip(detail, 110) : '', command: a.command || '' };
}

function hookFromProgress(d) {
  const event = d.hookEvent || String(d.hookName || '').split(':')[0] || 'Hook';
  return { event, name: d.hookName || event, outcome: 'run', detail: '', command: d.command || '' };
}

const hookLine = h =>
  `hook: ${h.name} → ${h.outcome}` + (h.command ? `\n  $ ${clip(h.command, 100)}` : '') + (h.detail ? `\n  ${quote(h.detail)}` : '');

// ---------------------------------------------------------------- context

const PRIVATE_ATTACHMENTS = new Set(['session_context', 'credential_org', 'remote_session_change']);
const NOISE_ATTACHMENTS = new Set(['total_tokens_reminder', 'deferred_tools_record', 'queued_command']);

function contextLine(a) {
  if (PRIVATE_ATTACHMENTS.has(a.type) || NOISE_ATTACHMENTS.has(a.type)) return null;
  switch (a.type) {
    case 'prompt_snapshot': {
      const parts = Array.isArray(a.systemPrompt) ? a.systemPrompt : [];
      const chars = parts.reduce((n, p) => n + String(p).length, 0);
      return `system: ${plural(parts.length, 'part')}, ${num(chars)} characters`;
    }
    case 'environment':
      return `env:    ${a.snapshot?.platform || ''} ${a.snapshot?.isGitRepo ? '(git repository)' : ''}`.trimEnd();
    case 'model':
      return `model:  ${a.identity?.modelId || ''}`;
    case 'deferred_tools_delta':
      return `tools:  ${plural(a.addedNames?.length || 0, 'deferred tool')}`;
    case 'mcp_instructions_delta':
      return `mcp:    ${(a.addedNames || []).join(', ')}`;
    case 'skill_listing':
      return `skills: ${a.skillCount ?? a.names?.length ?? ''}`;
    case 'agent_listing_delta':
      return `agents: ${(a.addedTypes || []).join(', ')}`;
    case 'auto_mode':
      return 'mode:   auto';
    case 'date':
      return `date:   ${a.date}`;
    default: {
      const path = a.path || a.filePath || a.content?.path;
      return path ? `${a.type}: ${path}` : a.type;
    }
  }
}

// ---------------------------------------------------------------- parse

export function buildTrace(records, { file = '' } = {}) {
  const main = records.filter(r => !r.isSidechain);
  const meta = { file, sessionId: '', cwd: '', gitBranch: '', version: '', entrypoint: '', models: [], firstPrompt: '', first: '', last: '' };
  const steps = [];
  const start = { kind: 'start', hooks: [] };
  const end = { kind: 'end', hooks: [] };
  const contextLines = [];
  const byMsg = new Map();
  const byTool = new Map();
  const hookSeen = new Map();
  let cur = start;
  let lastPrompt = null;
  let lastCompact = null;
  let pendingPreCompact = [];
  let turnNo = 0;
  let promptNo = 0;
  steps.push(start);

  const push = s => {
    steps.push(s);
    cur = s;
    return s;
  };

  function addHook(h, toolUseID) {
    const tool = toolUseID && byTool.get(toolUseID);
    let list;
    if (tool) list = /^(Pre|Permission)/.test(h.event) ? tool.pre : tool.post;
    else if (h.event === 'SessionStart') list = start.hooks;
    else if (h.event === 'UserPromptSubmit') list = (lastPrompt || cur).hooks;
    else if (h.event === 'Stop' || h.event === 'SubagentStop') list = (cur.kind === 'stop' ? cur : push({ kind: 'stop', hooks: [] })).hooks;
    else if (h.event === 'PreCompact') list = pendingPreCompact;
    else if (h.event === 'SessionEnd') list = end.hooks;
    else list = cur.hooks;
    // A hook can show as a progress record and later as a result record.
    const prev = hookSeen.get(`${toolUseID || ''}|${h.name}`);
    if (prev && prev.list === list) {
      if (h.outcome !== 'run') Object.assign(prev.hook, h, { command: h.command || prev.hook.command });
      return;
    }
    list.push(h);
    hookSeen.set(`${toolUseID || ''}|${h.name}`, { list, hook: h });
  }

  function onUser(r) {
    const c = r.message?.content;
    if (Array.isArray(c) && c.some(b => b.type === 'tool_result')) {
      for (const b of c) {
        const t = b.type === 'tool_result' && byTool.get(b.tool_use_id);
        if (t) Object.assign(t, { result: b, extra: r.toolUseResult });
      }
      return;
    }
    if (r.isCompactSummary) {
      if (lastCompact) lastCompact.summary = textOf(c);
      return;
    }
    if (r.isMeta) return;
    const text = textOf(c).trim();
    if (!text) return;
    if (INTERRUPTED.test(text)) return void push({ kind: 'interrupt', hooks: [], ts: r.timestamp });
    const cmd = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
    if (cmd) {
      const args = (text.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
      return void push({ kind: 'command', name: cmd[1].trim(), args: args.trim(), hooks: [], ts: r.timestamp });
    }
    const bash = text.match(/<bash-input>([\s\S]*?)<\/bash-input>/);
    if (bash) return void push({ kind: 'command', name: '!', args: bash[1].trim(), hooks: [], ts: r.timestamp });
    const out = text.match(/<(local-command-stdout|bash-stdout)>([\s\S]*?)<\/\1>/);
    if (out) {
      if (cur.kind === 'command') cur.output = (cur.output ? cur.output + '\n' : '') + out[2];
      return;
    }
    if (/^<(system-reminder|local-command-caveat|bash-stderr)/.test(text)) return;
    promptNo++;
    meta.firstPrompt ||= text;
    lastPrompt = push({ kind: 'prompt', n: promptNo, text, hooks: [], ts: r.timestamp });
  }

  function onAssistant(r) {
    const m = r.message;
    if (!m) return;
    if (m.model === '<synthetic>') return void push({ kind: 'synthetic', text: textOf(m.content), hooks: [], ts: r.timestamp });
    const id = m.id || r.requestId || r.uuid;
    let s = byMsg.get(id);
    if (!s) {
      s = push({ kind: 'turn', n: ++turnNo, model: m.model, blocks: [], tools: [], hooks: [], ts: r.timestamp });
      byMsg.set(id, s);
      if (m.model && !meta.models.includes(m.model)) meta.models.push(m.model);
    }
    for (const b of m.content || []) {
      if (b.type === 'tool_use') {
        const t = { id: b.id, name: b.name, input: b.input, pre: [], post: [] };
        s.tools.push(t);
        byTool.set(b.id, t);
        s.blocks.push({ type: 'tool_use', tool: t });
      } else s.blocks.push(b);
    }
    if (m.stop_reason) s.stop = m.stop_reason;
    if (m.usage) s.usage = m.usage;
  }

  function onSystem(r) {
    switch (r.subtype) {
      case 'stop_hook_summary': {
        const s = cur.kind === 'stop' ? cur : push({ kind: 'stop', hooks: [], ts: r.timestamp });
        Object.assign(s, { infos: r.hookInfos || [], errors: r.hookErrors || [], prevented: !!r.preventedContinuation, stopReason: r.stopReason || '' });
        break;
      }
      case 'compact_boundary':
        lastCompact = push({ kind: 'compact', trigger: r.compactMetadata?.trigger || 'auto', pre: r.compactMetadata?.preTokens, hooks: pendingPreCompact, ts: r.timestamp });
        pendingPreCompact = [];
        break;
      case 'api_error':
        if (cur.kind === 'apierr') cur.count++;
        else push({ kind: 'apierr', count: 1, error: clip(r.error?.message || r.error?.error?.message || r.content || JSON.stringify(r.error || {}), 140), hooks: [], ts: r.timestamp });
        break;
      case 'local_command':
        onUser({ ...r, message: { content: r.content } });
        break;
    }
  }

  for (const r of main) {
    if (r.timestamp) {
      meta.first ||= r.timestamp;
      meta.last = r.timestamp;
    }
    meta.sessionId ||= r.sessionId || '';
    meta.cwd ||= r.cwd || '';
    meta.version ||= r.version || '';
    meta.entrypoint ||= r.entrypoint || '';
    if (r.gitBranch) meta.gitBranch = r.gitBranch;
    start.ts ||= r.timestamp;
    switch (r.type) {
      case 'user':
        onUser(r);
        break;
      case 'assistant':
        onAssistant(r);
        break;
      case 'attachment': {
        const a = r.attachment;
        if (!a?.type) break;
        if (a.type.startsWith('hook_')) addHook(hookFromAttachment(a), a.toolUseID);
        else if (turnNo === 0) {
          const line = contextLine(a);
          if (line && !contextLines.includes(line)) contextLines.push(line);
        }
        break;
      }
      case 'progress':
        if (r.data?.type === 'hook_progress') addHook(hookFromProgress(r.data), r.toolUseID || r.parentToolUseID);
        break;
      case 'system':
        onSystem(r);
        break;
      case 'summary':
        meta.summary ||= r.summary;
        break;
    }
  }

  if (contextLines.length) steps.splice(1, 0, { kind: 'context', lines: contextLines, hooks: [], ts: start.ts });
  end.ts = meta.last;
  steps.push(end);

  const turns = steps.filter(s => s.kind === 'turn');
  const maxCtx = Math.max(0, ...turns.map(s => ctxOf(s) || 0));
  meta.turns = turns.length;
  meta.window = maxCtx > 200000 || meta.models.some(m => /\[1m\]/i.test(m)) ? 1000000 : 200000;
  return { meta, steps: render(steps, meta) };
}

function ctxOf(s) {
  const u = s.usage;
  if (!u) return null;
  return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
}

// ---------------------------------------------------------------- render

function render(steps, meta) {
  let turn = 0;
  let ctx = 0;
  return steps.map((s, i) => {
    if (s.kind === 'turn') {
      turn = s.n;
      ctx = ctxOf(s) ?? ctx;
    }
    if (s.kind === 'compact') {
      // The compact step shows the context of the first request after it.
      const next = steps.slice(i + 1).find(x => x.kind === 'turn' && ctxOf(x) != null);
      if (next) ctx = ctxOf(next);
    }
    const out = describe(s, steps, i, meta);
    const code = out.c.split('\n');
    if (code.length > MAX_CODE_LINES) out.c = code.slice(0, MAX_CODE_LINES).join('\n') + `\n… (${code.length - MAX_CODE_LINES} more lines)`;
    return { ...out, turn, ctx, ts: s.ts || '' };
  });
}

function describe(s, steps, i, meta) {
  const hooks = s.hooks || [];
  const hookK = hooks.length ? ['hook'] : [];
  switch (s.kind) {
    case 'start': {
      const d = [`Claude Code ${meta.version || ''} starts`.replace(/\s+starts/, ' starts') + (meta.cwd ? ` in ${meta.cwd}` : '') + '.'];
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
        d: 'Claude Code builds the system prompt and the tool definitions. It adds the skills, the agents, and the MCP servers. The transcript records the parts below.',
        c: s.lines.join('\n'),
      };
    case 'prompt': {
      const d = ['You type the request.'];
      if (hooks.length) d.push(`The UserPromptSubmit hook runs ${times(hooks.length)}. The hook can block the prompt or add context to it.`);
      d.push('The agent loop starts.');
      const lines = s.text.split('\n').slice(0, 12).map(l => '> ' + l);
      return { t: s.n > 1 ? `User sends prompt ${s.n}` : 'User sends the prompt', k: ['ui', ...hookK], d: d.join(' '), c: [...lines, '', ...hooks.map(hookLine)].join('\n').trimEnd() };
    }
    case 'command': {
      const out = (s.output || '').split('\n').filter(l => l.trim()).slice(0, 8).map(l => '→ ' + clip(l));
      const name = s.name === '!' ? 'a shell command' : `the command ${s.name}`;
      return {
        t: s.name === '!' ? 'You run a shell command' : `Slash command ${s.name}`,
        k: ['ui', ...hookK],
        d: `You run ${name}. Claude Code handles it in the CLI.`,
        c: [`> ${s.name === '!' ? '! ' : s.name + ' '}${s.args}`.trimEnd(), ...out, ...hooks.map(hookLine)].join('\n'),
      };
    }
    case 'interrupt':
      return { t: 'You interrupt the turn', k: ['ui', 'loop'], d: 'You stop the agent loop. Claude Code waits for your next prompt.', c: '[Request interrupted by user]' };
    case 'synthetic':
      return { t: 'Claude Code adds a message', k: ['loop'], d: 'Claude Code writes this assistant message itself. No API request occurs.', c: clip(s.text, 400) };
    case 'apierr':
      return {
        t: s.count > 1 ? `API error ×${s.count}` : 'API error',
        k: ['http'],
        d: 'The Messages API returns an error. Claude Code waits and sends the request again.',
        c: `POST /v1/messages\n← error: ${s.error}` + (s.count > 1 ? `\nretries: ${s.count}` : ''),
      };
    case 'compact': {
      const d = [s.trigger === 'manual' ? 'You run /compact.' : 'The context comes close to the limit, so Claude Code compacts it.'];
      if (hooks.length) d.push('The PreCompact hook runs first.');
      d.push('One extra API request writes a summary. The summary replaces the old messages.');
      const sum = (s.summary || '').split('\n').filter(l => l.trim()).slice(0, 6).map(l => '  ' + clip(l, 120));
      const c = [...hooks.map(hookLine), `trigger: "${s.trigger}"` + (s.pre ? `   before: ${num(s.pre)} tokens` : ''), 'POST /v1/messages  → summary of the conversation', 'messages = [summary, recent turns]', ...(sum.length ? ['', 'summary:', ...sum] : [])];
      return { t: s.trigger === 'manual' ? 'Compact (manual)' : 'Auto-compact', k: ['loop', 'http', ...hookK], d: d.join(' '), c: c.join('\n') };
    }
    case 'stop': {
      const next = steps[i + 1];
      const continued = next && next.kind === 'turn';
      const infos = hooks.length ? hooks.map(hookLine) : (s.infos || []).map(h => `hook: Stop\n  $ ${clip(h.command, 100)}`);
      const errs = hooks.length ? [] : (s.errors || []).map(e => `→ ${quote(e, 140)}`);
      const d = ['The Stop hook runs when the loop exits.'];
      if (continued) d.push('The hook returns a block decision. The loop continues with the reason as input.');
      else if (s.prevented) d.push('The hook stops the session.' + (s.stopReason ? ` The reason is: ${clip(s.stopReason, 80)}` : ''));
      else d.push('The hook lets the loop exit.');
      return { t: 'Stop hook', k: ['hook', 'loop'], d: d.join(' '), c: [...infos, ...errs, continued ? `→ loop continues (turn ${next.n}) …` : ''].join('\n').trimEnd() };
    }
    case 'turn':
      return describeTurn(s);
    case 'end':
      return describeEnd(s, steps, meta);
  }
  return { t: s.kind, k: ['loop'], d: '', c: '' };
}

function describeTurn(s) {
  const u = s.usage || {};
  const ctx = ctxOf(s) || 0;
  const tools = s.tools;
  const status = tools.map(toolStatus);
  const errors = status.filter(x => x === 'error').length;
  const rejected = status.filter(x => x === 'rejected').length;
  const toolHooks = tools.reduce((n, t) => n + t.pre.length + t.post.length, 0);
  const blocked = tools.filter(t => t.pre.some(h => h.outcome === 'block' || h.outcome === 'deny')).length;
  const allHooks = toolHooks + s.hooks.length;

  const title = `Turn ${s.n}: ` + (tools.length ? countNames(tools.map(t => t.name)) : s.stop === 'end_turn' ? 'end_turn' : s.stop || 'text reply');
  const k = ['http', tools.length ? 'tool' : 'loop'];
  if (allHooks) k.push('hook');
  if (rejected || status.includes('interrupted')) k.push('ui');

  const d = [`The agent loop sends request ${s.n} to the Messages API with ${ktok(ctx)} tokens of context.`];
  if (s.blocks.some(b => b.type === 'thinking' || b.type === 'redacted_thinking')) d.push('The model thinks first.');
  if (tools.length === 1) d.push(`The model asks for one tool: ${tools[0].name}.`);
  else if (tools.length > 1) d.push(`The model asks for ${tools.length} tools in one response.`);
  if (toolHooks) d.push(`The PreToolUse and PostToolUse hooks run ${times(toolHooks)}.`);
  if (blocked) d.push(`A PreToolUse hook blocks ${plural(blocked, 'tool call')}.`);
  if (rejected) d.push(`You reject ${plural(rejected, 'tool call')}.`);
  if (errors) d.push(`${plural(errors, 'tool call')} ${errors === 1 ? 'returns' : 'return'} an error.`);
  if (tools.length) d.push('The results go into messages[] as tool_result blocks.');
  else if (s.stop === 'end_turn') d.push('The model returns text with no tool_use. The agent loop exits.');
  else if (s.stop === 'max_tokens') d.push('The response reaches the max_tokens limit.');

  const c = [
    `POST /v1/messages   model: ${s.model || '?'}`,
    `  context: ${num(ctx)} tokens (cache read ${num(u.cache_read_input_tokens)} · cache write ${num(u.cache_creation_input_tokens)} · new ${num(u.input_tokens)})`,
  ];
  for (const b of s.blocks) {
    if (b.type === 'thinking') {
      const tt = u.output_tokens_details?.thinking_tokens;
      c.push(b.thinking ? `← thinking: ${quote(b.thinking, 110)}` : `← thinking${tt ? ` (${num(tt)} tokens)` : ''}`);
    } else if (b.type === 'redacted_thinking') c.push('← thinking (redacted)');
    else if (b.type === 'text' && b.text?.trim()) c.push(`← text: ${quote(b.text, 200)}`);
    else if (b.type === 'tool_use') {
      c.push(`← tool_use: ${b.tool.name}  ${toolArg(b.tool.name, b.tool.input)}`.trimEnd());
      if (b.tool.name === 'TodoWrite') c.push(...todoLines(b.tool.input));
    } else if (b.type === 'server_tool_use') c.push(`← server_tool_use: ${b.name}  ${toolArg(b.name, b.input)}`.trimEnd());
  }
  c.push(`← stop_reason: "${s.stop || '?'}"   output: ${num(u.output_tokens)} tokens`);

  if (tools.length) c.push('');
  tools.forEach((t, j) => {
    c.push(...t.pre.map(hookLine));
    const mark = { ok: '✓', error: '✗ error', rejected: '✗ rejected by you', interrupted: '✗ interrupted', 'no result': '… no result' }[status[j]];
    c.push(`tool: ${t.name} ${mark}`);
    if (t.result) {
      const lines = resultText(t.result).split('\n').filter(l => l.trim());
      c.push(...lines.slice(0, RESULT_LINES).map(l => '  → ' + clip(l, 120)));
      if (lines.length > RESULT_LINES) c.push(`  → … (${lines.length - RESULT_LINES} more lines)`);
    }
    const x = t.extra;
    if (x && typeof x === 'object' && (x.totalToolUseCount != null || x.totalTokens != null)) {
      c.push(`  subagent: ${plural(x.totalToolUseCount || 0, 'tool call')} · ${num(x.totalTokens)} tokens · ${duration(x.totalDurationMs)}`);
    }
    c.push(...t.post.map(hookLine));
  });
  const results = tools.filter(t => t.result).length;
  if (results) c.push(`messages += tool_result ×${results}`);
  if (s.hooks.length) c.push('', ...s.hooks.map(hookLine));
  return { t: title, k, d: d.join(' '), c: c.join('\n') };
}

function describeEnd(s, steps, meta) {
  const turns = steps.filter(x => x.kind === 'turn');
  const tools = turns.flatMap(x => x.tools);
  const hookRuns = steps.reduce((n, x) => n + (x.hooks?.length || 0) + (x.tools || []).reduce((m, t) => m + t.pre.length + t.post.length, 0), 0);
  const sum = key => turns.reduce((n, x) => n + (x.usage?.[key] || 0), 0);
  const ms = Date.parse(meta.last) - Date.parse(meta.first);
  const last = [...turns].reverse().find(x => x.usage);
  const d = [
    `The transcript ends. The session lasts ${duration(ms)}.`,
    `It has ${plural(turns.length, 'API request')}, ${plural(tools.length, 'tool call')}, and ${plural(hookRuns, 'recorded hook run')}.`,
  ];
  if (s.hooks.length) d.push('The SessionEnd hook runs for cleanup or logs.');
  const c = [
    `requests:   ${turns.length}`,
    `tool calls: ${tools.length}` + (tools.length ? `  (${countNames(tools.map(t => t.name))})` : ''),
    `hook runs:  ${hookRuns}`,
    `tokens:     output ${num(sum('output_tokens'))} · cache read ${num(sum('cache_read_input_tokens'))} · cache write ${num(sum('cache_creation_input_tokens'))} · new ${num(sum('input_tokens'))}`,
    last && `last context: ${num(ctxOf(last))} tokens`,
    ...s.hooks.map(hookLine),
  ];
  return { t: 'Session ends', k: ['ui', ...(s.hooks.length ? ['hook'] : [])], d: d.join(' '), c: c.filter(Boolean).join('\n') };
}

// ---------------------------------------------------------------- page

export function renderHtml(trace) {
  const json = JSON.stringify(trace)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return PAGE.replace('/*__DATA__*/', () => json);
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Claude Code Session Trace</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
:root{
  --bg:#f5f6f8; --surface:#ffffff; --sunk:#eceef2; --ink:#1b1f27; --ink-2:#555c6b; --ink-3:#8a90a0;
  --line:#dde0e7; --line-2:#c3c8d3;
  --loop:#5b50c8; --http:#15876a; --tool:#c4552b; --hook:#a86a0f; --ui:#6f7584;
  --focus:#5b50c8;
  --sans:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme:dark;
    --bg:#12151b; --surface:#1a1e26; --sunk:#0d1015; --ink:#e6e8ee; --ink-2:#a5abb9; --ink-3:#737a8a;
    --line:#2a2f3a; --line-2:#3a404d;
    --loop:#9d95f0; --http:#4cc7a0; --tool:#f08a60; --hook:#e0a84a; --ui:#9aa0ae; --focus:#9d95f0;
  }
}
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#12151b; --surface:#1a1e26; --sunk:#0d1015; --ink:#e6e8ee; --ink-2:#a5abb9; --ink-3:#737a8a;
  --line:#2a2f3a; --line-2:#3a404d;
  --loop:#9d95f0; --http:#4cc7a0; --tool:#f08a60; --hook:#e0a84a; --ui:#9aa0ae; --focus:#9d95f0;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;padding-inline:16px;padding-block:32px 48px}
.wrap{max-width:1040px;margin:0 auto;display:grid;gap:24px}
header h1{font-size:26px;font-weight:600;letter-spacing:-.01em;margin:0 0 6px;text-wrap:balance}
header p{margin:0;color:var(--ink-2);max-width:68ch}
header code{font-family:var(--mono);font-size:13px;background:var(--sunk);padding:1px 6px;border-radius:4px;overflow-wrap:anywhere}
.legend{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;color:var(--ink-2)}
.legend span{display:inline-flex;align-items:center;gap:7px}
.sw{width:10px;height:10px;border-radius:2px;flex:none;background:var(--c)}
.track{display:flex;gap:3px;align-items:stretch;overflow:hidden}
.track.dense{gap:1px}
.track button{flex:1;min-width:0;height:28px;border:0;padding:0;border-radius:3px;background:var(--sunk);cursor:pointer;display:flex;flex-direction:column;gap:2px;padding:3px}
.track.dense button{padding:2px 0;border-radius:1px}
.track button i{flex:1;border-radius:2px;background:var(--c);opacity:.35;display:block}
.track button.on{outline:2px solid var(--focus);outline-offset:1px}
.track button.on i,.track button:hover i{opacity:1}
.track-labels{display:flex;justify-content:space-between;font-family:var(--mono);font-size:11px;color:var(--ink-3);margin-top:6px;letter-spacing:.04em;text-transform:uppercase}
.main{display:grid;grid-template-columns:minmax(0,260px) minmax(0,1fr);gap:24px;align-items:start}
.steps{list-style:none;margin:0;padding:0;display:grid;gap:2px;max-height:75vh;overflow-y:auto}
.steps button{width:100%;text-align:left;display:flex;gap:10px;align-items:center;background:none;border:1px solid transparent;border-radius:6px;padding:7px 10px;font:inherit;font-size:13.5px;color:var(--ink-2);cursor:pointer}
.steps button span:last-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.steps button:hover{background:var(--surface)}
.steps button.on{background:var(--surface);border-color:var(--line-2);color:var(--ink);font-weight:500}
.steps .n{font-family:var(--mono);font-size:11px;color:var(--ink-3);min-width:18px;flex:none;font-variant-numeric:tabular-nums}
.panel{display:grid;gap:14px}
.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.btn{font:inherit;font-size:13.5px;background:var(--surface);color:var(--ink);border:1px solid var(--line-2);border-radius:6px;padding:6px 12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.btn:hover{border-color:var(--ink-3)}
button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.pos{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.meters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:12px}
.meter{background:var(--sunk);border-radius:8px;padding:10px 14px}
.meter .k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.meter .v{font-family:var(--mono);font-size:22px;font-weight:500;font-variant-numeric:tabular-nums}
.bar{height:6px;background:var(--line);border-radius:3px;margin-top:12px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--loop);border-radius:3px;transition:width .35s ease}
.meter .sub{font-family:var(--mono);font-size:12px;color:var(--ink-2);margin-top:6px;font-variant-numeric:tabular-nums}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:18px 20px;display:grid;gap:10px;min-width:0}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.tag{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;padding:2px 9px 2px 7px;border-radius:999px;border:1px solid var(--c);color:var(--c)}
.tag .sw{width:7px;height:7px;border-radius:50%}
.card h2{font-size:18px;font-weight:600;margin:0;overflow-wrap:anywhere}
.card p{margin:0;color:var(--ink-2);max-width:65ch}
pre{margin:0;font-family:var(--mono);font-size:12.5px;line-height:1.6;background:var(--sunk);border-radius:8px;padding:12px 14px;overflow:auto;max-height:60vh;white-space:pre;color:var(--ink)}
.note{font-size:13px;color:var(--ink-3);margin:0;overflow-wrap:anywhere}
@media (max-width:720px){
  .main{grid-template-columns:minmax(0,1fr)}
  .steps{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));max-height:40vh}
  .steps button{font-size:12.5px;padding:6px 8px}
  .meters{grid-template-columns:minmax(0,1fr)}
}
@media (prefers-reduced-motion:reduce){.bar i{transition:none}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Claude Code session trace</h1>
    <p id="intro"></p>
  </header>

  <div class="legend" aria-label="Legend">
    <span><i class="sw" style="--c:var(--loop)"></i>Agent loop</span>
    <span><i class="sw" style="--c:var(--http)"></i>HTTP API request</span>
    <span><i class="sw" style="--c:var(--tool)"></i>Tool call</span>
    <span><i class="sw" style="--c:var(--hook)"></i>Hook</span>
    <span><i class="sw" style="--c:var(--ui)"></i>User / UI</span>
  </div>

  <div>
    <div class="track" id="track" aria-label="Session timeline"></div>
    <div class="track-labels"><span>Start</span><span id="turns"></span><span>Exit</span></div>
  </div>

  <div class="main">
    <ol class="steps" id="steps"></ol>
    <div class="panel">
      <div class="controls">
        <button class="btn" id="prev" aria-label="Previous step">&larr; Previous</button>
        <button class="btn" id="next" aria-label="Next step">Next &rarr;</button>
        <button class="btn" id="play">&#9654; Play</button>
        <span class="pos" id="pos"></span>
      </div>
      <div class="meters">
        <div class="meter"><div class="k">Loop turn</div><div class="v" id="turn">–</div></div>
        <div class="meter"><div class="k">Context in messages[]</div><div class="bar"><i id="ctx"></i></div><div class="sub" id="ctxl"></div></div>
      </div>
      <article class="card" aria-live="polite">
        <div class="tags" id="tags"></div>
        <h2 id="title"></h2>
        <p id="desc"></p>
        <pre id="code"></pre>
      </article>
      <p class="note" id="note"></p>
    </div>
  </div>
</div>

<script type="application/json" id="data">/*__DATA__*/</script>
<script>
const D=JSON.parse(document.getElementById('data').textContent);
const S=D.steps,M=D.meta;
const C={loop:'var(--loop)',http:'var(--http)',tool:'var(--tool)',hook:'var(--hook)',ui:'var(--ui)'};
const N={loop:'Agent loop',http:'HTTP',tool:'Tool',hook:'Hook',ui:'User / UI'};
let i=0,timer=null;
const $=id=>document.getElementById(id);
const steps=$('steps'),track=$('track');
const code=t=>{const c=document.createElement('code');c.textContent=t;return c};
const clip=(t,n)=>t.length>n?t.slice(0,n-1)+'…':t;
(function intro(){
  const p=$('intro');
  p.append('Session ',code(M.sessionId||'unknown'));
  if(M.firstPrompt)p.append(' for the prompt ',code(clip(M.firstPrompt.replace(/\\s+/g,' '),120)));
  if(M.gitBranch)p.append(' on the branch ',code(M.gitBranch));
  p.append('. Step through it to see where the agent loop, the HTTP API requests, the tool calls, and the hooks happen.');
  $('turns').textContent=M.turns?(M.turns>1?'Loop turns 1–'+M.turns:'Loop turn 1'):'No loop turns';
  $('note').textContent='The data comes from '+(M.file||'the session transcript')+'. The page shows only the hooks that Claude Code writes to the transcript. Subagent turns are not in this view.';
  if(M.sessionId)document.title='Session trace '+M.sessionId.slice(0,8);
})();
if(S.length>80)track.classList.add('dense');
S.forEach((s,n)=>{
  const li=document.createElement('li');
  const b=document.createElement('button');
  b.type='button';
  b.innerHTML='<span class="n">'+String(n+1).padStart(2,'0')+'</span><i class="sw" style="--c:'+C[s.k[0]]+'"></i><span></span>';
  b.lastChild.textContent=s.t;
  b.title=s.t;
  b.onclick=()=>{i=n;render()};
  li.appendChild(b);steps.appendChild(li);
  const t=document.createElement('button');
  t.type='button';t.title=s.t;t.setAttribute('aria-label','Step '+(n+1)+': '+s.t);
  t.innerHTML=s.k.map(k=>'<i style="--c:'+C[k]+'"></i>').join('');
  t.onclick=()=>{i=n;render()};
  track.appendChild(t);
});
const fmt=n=>n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?Math.round(n/1e3)+'k':String(n);
function render(){
  const s=S[i];
  [...steps.querySelectorAll('button')].forEach((b,n)=>{b.classList.toggle('on',n===i);if(n===i)b.scrollIntoView({block:'nearest'})});
  [...track.children].forEach((b,n)=>b.classList.toggle('on',n===i));
  $('title').textContent=s.t;
  $('desc').textContent=s.d;
  $('code').textContent=s.c;
  $('tags').innerHTML=s.k.map(k=>'<span class="tag" style="--c:'+C[k]+'"><i class="sw"></i>'+N[k]+'</span>').join('');
  const when=s.ts&&!isNaN(Date.parse(s.ts))?' · '+new Date(s.ts).toLocaleTimeString():'';
  $('pos').textContent='Step '+(i+1)+' / '+S.length+when;
  $('turn').textContent=s.turn?s.turn:'–';
  $('ctx').style.width=Math.min(100,s.ctx/M.window*100)+'%';
  $('ctxl').textContent=s.ctx?fmt(s.ctx)+' / '+fmt(M.window)+' tokens':'no request yet';
}
function go(d){i=(i+d+S.length)%S.length;render()}
$('prev').onclick=()=>go(-1);
$('next').onclick=()=>go(1);
$('play').onclick=()=>{
  const b=$('play');
  if(timer){clearInterval(timer);timer=null;b.innerHTML='&#9654; Play'}
  else{timer=setInterval(()=>go(1),2200);b.innerHTML='&#10074;&#10074; Pause'}
};
document.addEventListener('keydown',e=>{
  if(e.key==='ArrowRight')go(1);
  if(e.key==='ArrowLeft')go(-1);
});
render();
</script>
</body>
</html>
`;

// ---------------------------------------------------------------- cli

function projectsDir() {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

function newest(files) {
  return files.map(f => [f, statSync(f).mtimeMs]).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function listSessions(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f));
}

function findSession(arg) {
  const root = projectsDir();
  if (arg && existsSync(arg)) return resolve(arg);
  const projects = existsSync(root) ? readdirSync(root).map(p => join(root, p)) : [];
  if (arg) {
    const hit = projects.map(p => join(p, `${arg.replace(/\.jsonl$/, '')}.jsonl`)).find(existsSync);
    if (hit) return hit;
    throw new Error(`no session file for "${arg}" in ${root}`);
  }
  const here = join(root, process.cwd().replace(/[^a-zA-Z0-9]/g, '-'));
  const file = newest(listSessions(here)) || newest(projects.flatMap(listSessions));
  if (!file) throw new Error(`no session files in ${root}`);
  return file;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log('usage: session-trace [session.jsonl | session-id] [-o out.html] [--stdout]');
    return;
  }
  const o = args.indexOf('-o');
  const outArg = o >= 0 ? args.splice(o, 2)[1] : null;
  const toStdout = args.includes('--stdout');
  const input = args.find(a => !a.startsWith('-'));

  const file = findSession(input);
  const trace = buildTrace(readRecords(readFileSync(file, 'utf8')), { file: basename(file) });
  const html = renderHtml(trace);
  if (toStdout) return void process.stdout.write(html);
  const out = outArg || `${basename(file, '.jsonl')}.trace.html`;
  writeFileSync(out, html);
  console.error(`${file}\n→ ${out}  (${trace.steps.length} steps, ${trace.meta.turns} loop turns)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv);
  } catch (e) {
    console.error(`session-trace: ${e.message}`);
    process.exit(1);
  }
}
