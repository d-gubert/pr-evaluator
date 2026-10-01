// @ts-check
// Format: Claude Code session transcripts (.jsonl, one JSON record per line).
// Ported from the parse half of the first single-file version (commit 5ff6e5b).

import { basename } from 'node:path';

/** @typedef {import('../model.js').Session} Session */
/** @typedef {import('../model.js').SessionEvent} SessionEvent */
/** @typedef {import('../model.js').Hook} Hook */
/** @typedef {import('../model.js').ToolCall} ToolCall */
/** @typedef {import('../model.js').ToolStatus} ToolStatus */
/** @typedef {import('../model.js').Usage} Usage */
/** @typedef {import('../model.js').Block} Block */

const RECORD_TYPES = new Set(['user', 'assistant', 'system', 'attachment', 'summary', 'progress', 'queue-operation']);

// ---------------------------------------------------------------- helpers

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const num = n => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** @param {any} content */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
}

/**
 * Parse the lines of a log. A line that is not a JSON object is skipped:
 * a session that is still open can end in a partial line.
 * @param {string} text
 * @returns {any[]}
 */
function readRecords(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && !Array.isArray(r)) out.push(r);
    } catch {
      // partial or invalid line
    }
  }
  return out;
}

// ---------------------------------------------------------------- tools

/** @param {any} block a tool_result block */
function resultText(block) {
  const c = block.content;
  let text = typeof c === 'string' ? c : textOf(c);
  if (Array.isArray(c) && c.some(b => b?.type === 'image')) text += '\n[image]';
  return text;
}

const DENIED = /doesn't want to proceed|was rejected|user rejected|denied (this|the) (tool|request)|permission.*denied/i;
const INTERRUPTED = /^\[Request interrupted by user/;

/**
 * @param {{text: string, isError: boolean}|null} result
 * @returns {ToolStatus}
 */
function toolStatus(result) {
  if (!result) return 'no result';
  if (INTERRUPTED.test(result.text)) return 'interrupted';
  if (result.isError && DENIED.test(result.text)) return 'rejected';
  if (result.isError) return 'error';
  return 'ok';
}

/** @param {any} x the `toolUseResult` field of a record */
function subagentOf(x) {
  if (!x || typeof x !== 'object' || (x.totalToolUseCount == null && x.totalTokens == null)) return null;
  const ms = x.totalDurationMs;
  return {
    toolCalls: x.totalToolUseCount || 0,
    tokens: x.totalTokens || 0,
    durationMs: typeof ms === 'number' && ms >= 0 ? ms : null,
  };
}

/** @param {any} u API usage object @returns {Usage} */
function normalizeUsage(u) {
  const n = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const thinking = u.output_tokens_details?.thinking_tokens;
  return {
    input: n(u.input_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite: n(u.cache_creation_input_tokens),
    output: n(u.output_tokens),
    thinking: typeof thinking === 'number' ? thinking : null,
  };
}

// ---------------------------------------------------------------- hooks

/** @param {any} a an attachment whose type starts with "hook_" @returns {Hook} */
function hookFromAttachment(a) {
  const event = a.hookEvent || String(a.hookName || '').split(':')[0] || 'Hook';
  const outcome =
    {
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
  return { event, name: a.hookName || event, outcome, detail: detail || '', command: a.command || '' };
}

/** @param {any} d the `data` of a hook_progress record @returns {Hook} */
function hookFromProgress(d) {
  const event = d.hookEvent || String(d.hookName || '').split(':')[0] || 'Hook';
  return { event, name: d.hookName || event, outcome: 'run', detail: '', command: d.command || '' };
}

// ---------------------------------------------------------------- context

// These attachments hold private data. They never go into the Session.
const PRIVATE_ATTACHMENTS = new Set(['session_context', 'credential_org', 'remote_session_change']);
const NOISE_ATTACHMENTS = new Set(['total_tokens_reminder', 'deferred_tools_record', 'queued_command']);

/** @param {any} a @returns {string|null} */
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
      return typeof path === 'string' && path ? `${a.type}: ${path}` : a.type;
    }
  }
}

// ---------------------------------------------------------------- parse

/**
 * @param {string} text
 * @param {{file: string}} opts
 * @returns {Session}
 */
function parse(text, opts) {
  const main = readRecords(text).filter(r => !r.isSidechain);
  const meta = {
    harness: 'claude-code',
    harnessName: 'Claude Code',
    file: basename(opts?.file ?? ''),
    sessionId: '',
    cwd: '',
    gitBranch: '',
    version: '',
    entrypoint: '',
    /** @type {string[]} */
    models: [],
    firstPrompt: '',
    startedAt: '',
    endedAt: '',
    contextWindow: null,
  };

  // Events are built in final form. `hooks` lists are mutated while hooks arrive.
  /** @type {any} */
  const start = { type: 'session_start', ts: '', hooks: [] };
  /** @type {any} */
  const end = { type: 'session_end', ts: '', hooks: [] };
  /** @type {any[]} */
  const events = [start];
  /** @type {string[]} */
  const contextLines = [];
  /** @type {Map<string, any>} */
  const byMsg = new Map();
  /** @type {Map<string, ToolCall>} */
  const byTool = new Map();
  /** @type {Map<string, {list: Hook[], hook: Hook}>} */
  const hookSeen = new Map();
  /** @type {any} */
  let cur = start;
  /** @type {any} The newest event that can hold hooks. */
  let hooked = start;
  /** @type {any} */
  let lastPrompt = null;
  /** @type {any} */
  let lastCompact = null;
  /** @type {Hook[]} */
  let pendingPreCompact = [];
  let requestNo = 0;

  /** @param {any} ev */
  const push = ev => {
    events.push(ev);
    cur = ev;
    if (ev.hooks) hooked = ev;
    return ev;
  };

  /** @param {Hook} h @param {string|undefined} toolUseID @param {string} ts */
  function addHook(h, toolUseID, ts) {
    const tool = toolUseID ? byTool.get(toolUseID) : undefined;
    let list;
    if (tool) list = /^(Pre|Permission)/.test(h.event) ? tool.pre : tool.post;
    else if (h.event === 'SessionStart') list = start.hooks;
    else if (h.event === 'UserPromptSubmit') list = (lastPrompt || hooked).hooks;
    else if (h.event === 'Stop' || h.event === 'SubagentStop') {
      list = (cur.type === 'stop_hooks' ? cur : push({ ...newStop(), ts })).hooks;
    } else if (h.event === 'PreCompact') list = pendingPreCompact;
    else if (h.event === 'SessionEnd') list = end.hooks;
    else list = hooked.hooks;
    // A hook can show as a progress record and later as a result record.
    const key = `${toolUseID || ''}|${h.name}`;
    const prev = hookSeen.get(key);
    if (prev && prev.list === list) {
      if (h.outcome !== 'run') Object.assign(prev.hook, h, { command: h.command || prev.hook.command });
      return;
    }
    list.push(h);
    hookSeen.set(key, { list, hook: h });
  }

  const newStop = () => ({ type: 'stop_hooks', hooks: [], commands: [], errors: [], prevented: false, reason: '' });

  /** @param {any} r */
  function onUser(r) {
    const c = r.message?.content;
    if (Array.isArray(c) && c.some(b => b?.type === 'tool_result')) {
      for (const b of c) {
        const t = b?.type === 'tool_result' && byTool.get(b.tool_use_id);
        if (t) {
          t.result = { text: resultText(b), isError: !!b.is_error };
          t.status = toolStatus(t.result);
          t.subagent = subagentOf(r.toolUseResult);
        }
      }
      return;
    }
    if (r.isCompactSummary) {
      if (lastCompact) lastCompact.summary = textOf(c);
      return;
    }
    if (r.isMeta) return;
    const body = textOf(c).trim();
    if (!body) return;
    const ts = r.timestamp || '';
    if (INTERRUPTED.test(body)) return void push({ type: 'interrupt', ts });
    const cmd = body.match(/<command-name>([\s\S]*?)<\/command-name>/);
    if (cmd) {
      const args = (body.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
      return void push({ type: 'command', ts, name: cmd[1].trim(), args: args.trim(), output: '', hooks: [] });
    }
    const bash = body.match(/<bash-input>([\s\S]*?)<\/bash-input>/);
    if (bash) return void push({ type: 'command', ts, name: '!', args: bash[1].trim(), output: '', hooks: [] });
    const out = body.match(/<(local-command-stdout|bash-stdout)>([\s\S]*?)<\/\1>/);
    if (out) {
      if (cur.type === 'command') cur.output = (cur.output ? cur.output + '\n' : '') + out[2];
      return;
    }
    if (/^<(system-reminder|local-command-caveat|bash-stderr)/.test(body)) return;
    meta.firstPrompt ||= body;
    lastPrompt = push({ type: 'prompt', ts, text: body, hooks: [] });
  }

  /** @param {any} r */
  function onAssistant(r) {
    const m = r.message;
    if (!m) return;
    const ts = r.timestamp || '';
    if (m.model === '<synthetic>') return void push({ type: 'notice', ts, text: textOf(m.content) });
    const id = m.id || r.requestId || r.uuid;
    let ev = byMsg.get(id);
    if (!ev) {
      requestNo++;
      ev = push({ type: 'request', ts, model: m.model || '', usage: null, stopReason: '', blocks: [], tools: [], hooks: [] });
      byMsg.set(id, ev);
      if (m.model && !meta.models.includes(m.model)) meta.models.push(m.model);
    }
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!b || typeof b !== 'object') continue;
      switch (b.type) {
        case 'tool_use': {
          /** @type {ToolCall} */
          const t = { id: b.id, name: b.name, input: b.input, pre: [], post: [], result: null, status: 'no result', subagent: null };
          ev.tools.push(t);
          byTool.set(b.id, t);
          ev.blocks.push({ type: 'tool_use', toolId: b.id });
          break;
        }
        case 'thinking':
          ev.blocks.push({ type: 'thinking', text: typeof b.thinking === 'string' ? b.thinking : '' });
          break;
        case 'redacted_thinking':
          ev.blocks.push({ type: 'redacted_thinking' });
          break;
        case 'text':
          // A blank text block carries nothing to show.
          if (typeof b.text === 'string' && b.text.trim()) ev.blocks.push({ type: 'text', text: b.text });
          break;
        case 'server_tool_use':
          ev.blocks.push({ type: 'server_tool_use', name: b.name, input: b.input });
          break;
      }
    }
    if (m.stop_reason) ev.stopReason = m.stop_reason;
    if (m.usage && typeof m.usage === 'object') ev.usage = normalizeUsage(m.usage);
  }

  /** @param {any} r */
  function onSystem(r) {
    const ts = r.timestamp || '';
    switch (r.subtype) {
      case 'stop_hook_summary': {
        const s = cur.type === 'stop_hooks' ? cur : push({ ...newStop(), ts });
        const infos = Array.isArray(r.hookInfos) ? r.hookInfos : [];
        const errors = Array.isArray(r.hookErrors) ? r.hookErrors : [];
        Object.assign(s, {
          commands: infos.map(h => h?.command).filter(c => typeof c === 'string'),
          errors: errors.map(e => (typeof e === 'string' ? e : JSON.stringify(e))),
          prevented: !!r.preventedContinuation,
          reason: r.stopReason || '',
        });
        break;
      }
      case 'compact_boundary':
        lastCompact = push({
          type: 'compaction',
          ts,
          trigger: r.compactMetadata?.trigger === 'manual' ? 'manual' : 'auto',
          preTokens: typeof r.compactMetadata?.preTokens === 'number' ? r.compactMetadata.preTokens : null,
          summary: '',
          hooks: pendingPreCompact,
        });
        pendingPreCompact = [];
        break;
      case 'api_error':
        if (cur.type === 'api_error') cur.count++;
        else {
          const msg = r.error?.message || r.error?.error?.message || r.content || JSON.stringify(r.error || {});
          push({ type: 'api_error', ts, count: 1, message: typeof msg === 'string' ? msg : JSON.stringify(msg) });
        }
        break;
      case 'local_command':
        onUser({ ...r, message: { content: r.content } });
        break;
    }
  }

  for (const r of main) {
    if (r.timestamp) {
      meta.startedAt ||= r.timestamp;
      meta.endedAt = r.timestamp;
    }
    meta.sessionId ||= r.sessionId || '';
    meta.cwd ||= r.cwd || '';
    meta.version ||= r.version || '';
    meta.entrypoint ||= r.entrypoint || '';
    if (r.gitBranch) meta.gitBranch = r.gitBranch;
    start.ts ||= r.timestamp || '';
    switch (r.type) {
      case 'user':
        onUser(r);
        break;
      case 'assistant':
        onAssistant(r);
        break;
      case 'attachment': {
        const a = r.attachment;
        if (!a || typeof a.type !== 'string' || !a.type) break;
        if (a.type.startsWith('hook_')) addHook(hookFromAttachment(a), a.toolUseID, r.timestamp || '');
        else if (requestNo === 0) {
          const line = contextLine(a);
          if (line && !contextLines.includes(line)) contextLines.push(line);
        }
        break;
      }
      case 'progress':
        if (r.data?.type === 'hook_progress') addHook(hookFromProgress(r.data), r.toolUseID || r.parentToolUseID, r.timestamp || '');
        break;
      case 'system':
        onSystem(r);
        break;
    }
  }

  if (contextLines.length) events.splice(1, 0, { type: 'context', ts: start.ts, items: contextLines });
  end.ts = meta.endedAt;
  events.push(end);

  return { meta, events };
}

/** @type {import('./index.js').Format} */
export const claudeCode = {
  id: 'claude-code',
  name: 'Claude Code',
  detect({ head }) {
    for (const line of String(head).split('\n')) {
      if (!line.trim()) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (r && typeof r === 'object' && typeof r.sessionId === 'string' && RECORD_TYPES.has(r.type)) return true;
    }
    return false;
  },
  parse,
};
