// Format: Claude Code session transcripts (.jsonl, one JSON record per line).
// Ported from the parse half of the first single-file version (commit 5ff6e5b).
//
// A log line is `unknown` until a guard narrows it (see ./json.ts). The parser
// builds mutable drafts of the events, because hooks and results arrive after the
// event that they belong to. At the end it returns the read-only model.

import { basename } from 'node:path';
import {
  parseTimestamp,
  parseToolUseId,
  toPositiveCount,
  toSessionId,
  type ApiErrorEvent,
  type BodyEvent,
  type CommandEvent,
  type CompactionEvent,
  type Hook,
  type NoticeEvent,
  type InterruptEvent,
  type PromptEvent,
  type RequestEvent,
  type Session,
  type SessionEndEvent,
  type SessionEvents,
  type SessionMeta,
  type SessionStartEvent,
  type StopHooksEvent,
  type SubagentTotals,
  type Timestamp,
  type ToolCall,
  type ToolResult,
  type ToolStatus,
  type ToolUseId,
  type Usage,
} from '../model.js';
import type { Format } from './index.js';
import { asArr, asRec, isRec, isString, num0, str, type Rec } from './json.js';

const RECORD_TYPES = new Set(['user', 'assistant', 'system', 'attachment', 'summary', 'progress', 'queue-operation']);

// ---------------------------------------------------------------- drafts

// A draft is an event that the parser still changes. A mutable draft is
// assignable to the read-only event, so most drafts need no conversion.

type Writable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

type ToolDraft = {
  readonly id: ToolUseId;
  readonly name: string;
  readonly input: unknown;
  readonly pre: Hook[];
  readonly post: Hook[];
  result: ToolResult | null;
  subagent: SubagentTotals | null;
};

type StartDraft = Writable<SessionStartEvent>;
type EndDraft = Writable<SessionEndEvent>;
type PromptDraft = Writable<PromptEvent>;
type CommandDraft = Writable<CommandEvent>;
type RequestDraft = Omit<Writable<RequestEvent>, 'tools'> & { tools: ToolDraft[] };
type ApiErrorDraft = Writable<ApiErrorEvent>;
type CompactionDraft = Writable<CompactionEvent>;
type StopDraft = Writable<StopHooksEvent>;
type MetaDraft = Writable<SessionMeta>;

type HookedDraft = StartDraft | PromptDraft | CommandDraft | RequestDraft | CompactionDraft | StopDraft;
type BodyDraft = PromptDraft | CommandDraft | RequestDraft | ApiErrorDraft | CompactionDraft | StopDraft | InterruptEvent | NoticeEvent;

const hasHooks = (e: StartDraft | BodyDraft): e is HookedDraft => 'hooks' in e;

// ---------------------------------------------------------------- helpers

const num = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => asRec(b).type === 'text')
    .map((b) => asRec(b).text)
    .join('\n');
}

/**
 * Parse the lines of a log. A line that is not a JSON object is skipped:
 * a session that is still open can end in a partial line.
 */
function readRecords(text: string): Rec[] {
  const out: Rec[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r: unknown = JSON.parse(line);
      if (isRec(r)) out.push(r);
    } catch {
      // partial or invalid line
    }
  }
  return out;
}

// ---------------------------------------------------------------- tools

/** @param block a tool_result block */
function resultText(block: Rec): string {
  const c = block.content;
  let text = typeof c === 'string' ? c : textOf(c);
  if (Array.isArray(c) && c.some((b) => asRec(b).type === 'image')) text += '\n[image]';
  return text;
}

const DENIED = /doesn't want to proceed|was rejected|user rejected|denied (this|the) (tool|request)|permission.*denied/i;
const INTERRUPTED = /^\[Request interrupted by user/;

function toolStatus(result: ToolResult): Exclude<ToolStatus, 'no result'> {
  if (INTERRUPTED.test(result.text)) return 'interrupted';
  if (result.isError && DENIED.test(result.text)) return 'rejected';
  if (result.isError) return 'error';
  return 'ok';
}

/** The tool with its final status. A tool has a status of "no result" exactly when it has no result. */
function finishTool(t: ToolDraft): ToolCall {
  const base = { id: t.id, name: t.name, input: t.input, pre: t.pre, post: t.post, subagent: t.subagent };
  return t.result === null ? { ...base, result: null, status: 'no result' } : { ...base, result: t.result, status: toolStatus(t.result) };
}

/** @param x the `toolUseResult` field of a record */
function subagentOf(x: unknown): SubagentTotals | null {
  if (!isRec(x) || (x.totalToolUseCount == null && x.totalTokens == null)) return null;
  const ms = x.totalDurationMs;
  return {
    toolCalls: num0(x.totalToolUseCount),
    tokens: num0(x.totalTokens),
    durationMs: typeof ms === 'number' && ms >= 0 ? ms : null,
  };
}

/** @param u API usage object */
function normalizeUsage(u: Rec): Usage {
  const thinking = asRec(u.output_tokens_details).thinking_tokens;
  return {
    input: num0(u.input_tokens),
    cacheRead: num0(u.cache_read_input_tokens),
    cacheWrite: num0(u.cache_creation_input_tokens),
    output: num0(u.output_tokens),
    thinking: typeof thinking === 'number' ? thinking : null,
  };
}

// ---------------------------------------------------------------- hooks

function hookOutcome(a: Rec, type: string): string {
  switch (type) {
    case 'hook_success':
      return 'ok';
    case 'hook_additional_context':
      return 'context added';
    case 'hook_blocking_error':
      return 'block';
    case 'hook_non_blocking_error':
    case 'hook_error_during_execution':
      return 'error';
    case 'hook_cancelled':
      return 'cancelled';
    case 'hook_stopped_continuation':
      return 'stop';
    case 'hook_permission_decision':
      return str(a.decision) || 'decision';
    default:
      return type.replace(/^hook_/, '');
  }
}

/** @param a an attachment whose type starts with "hook_" */
function hookFromAttachment(a: Rec, type: string): Hook {
  const event = str(a.hookEvent) || (str(a.hookName).split(':')[0] ?? '') || 'Hook';
  const detail = [a.content, a.stdout, a.stderr, asRec(a.blockingError).blockingError, a.message, a.reason]
    .map((v): unknown => (Array.isArray(v) ? v.join(' ') : v))
    .find((v): v is string => typeof v === 'string' && v.trim() !== '');
  return { event, name: str(a.hookName) || event, outcome: hookOutcome(a, type), detail: detail ?? '', command: str(a.command) };
}

/** @param d the `data` of a hook_progress record */
function hookFromProgress(d: Rec): Hook {
  const event = str(d.hookEvent) || (str(d.hookName).split(':')[0] ?? '') || 'Hook';
  return { event, name: str(d.hookName) || event, outcome: 'run', detail: '', command: str(d.command) };
}

// ---------------------------------------------------------------- context

// These attachments hold private data. They never go into the Session.
const PRIVATE_ATTACHMENTS = new Set(['session_context', 'credential_org', 'remote_session_change']);
const NOISE_ATTACHMENTS = new Set(['total_tokens_reminder', 'deferred_tools_record', 'queued_command']);

function contextLine(a: Rec, type: string): string | null {
  if (PRIVATE_ATTACHMENTS.has(type) || NOISE_ATTACHMENTS.has(type)) return null;
  switch (type) {
    case 'prompt_snapshot': {
      const parts = asArr(a.systemPrompt);
      const chars = parts.reduce<number>((n, p) => n + String(p).length, 0);
      return `system: ${plural(parts.length, 'part')}, ${num(chars)} characters`;
    }
    case 'environment': {
      const snapshot = asRec(a.snapshot);
      return `env:    ${str(snapshot.platform)} ${snapshot.isGitRepo ? '(git repository)' : ''}`.trimEnd();
    }
    case 'model':
      return `model:  ${str(asRec(a.identity).modelId)}`;
    case 'deferred_tools_delta':
      return `tools:  ${plural(asArr(a.addedNames).length, 'deferred tool')}`;
    case 'mcp_instructions_delta':
      return `mcp:    ${asArr(a.addedNames).join(', ')}`;
    case 'skill_listing':
      return `skills: ${String(a.skillCount ?? (Array.isArray(a.names) ? a.names.length : undefined) ?? '')}`;
    case 'agent_listing_delta':
      return `agents: ${asArr(a.addedTypes).join(', ')}`;
    case 'auto_mode':
      return 'mode:   auto';
    case 'date':
      return `date:   ${String(a.date)}`;
    default: {
      const path = a.path || a.filePath || asRec(a.content).path;
      return typeof path === 'string' && path ? `${type}: ${path}` : type;
    }
  }
}

// ---------------------------------------------------------------- parse

function parse(text: string, opts: { file: string }): Session {
  const main = readRecords(text).filter((r) => !r.isSidechain);
  const meta: MetaDraft = {
    harness: 'claude-code',
    harnessName: 'Claude Code',
    file: basename(opts.file),
    sessionId: toSessionId(''),
    cwd: '',
    gitBranch: '',
    version: '',
    entrypoint: '',
    models: [],
    firstPrompt: '',
    startedAt: '',
    endedAt: '',
    contextWindow: null,
  };

  // The events between session_start and session_end. Hooks are added to the
  // drafts while they arrive, so the drafts are finished at the end.
  const start: StartDraft = { type: 'session_start', ts: '', hooks: [] };
  const end: EndDraft = { type: 'session_end', ts: '', hooks: [] };
  const body: BodyDraft[] = [];
  const contextLines: string[] = [];
  const byMsg = new Map<string, RequestDraft>();
  const byTool = new Map<ToolUseId, ToolDraft>();
  const hookSeen = new Map<string, { list: Hook[]; index: number; hook: Hook }>();
  let cur: StartDraft | BodyDraft = start;
  /** The newest event that can hold hooks. */
  let hooked: HookedDraft = start;
  let lastPrompt: PromptDraft | null = null;
  let lastCompact: CompactionDraft | null = null;
  let pendingPreCompact: Hook[] = [];
  let requestNo = 0;

  function push<E extends BodyDraft>(ev: E): E {
    body.push(ev);
    cur = ev;
    if (hasHooks(ev)) hooked = ev;
    return ev;
  }

  const newStop = (ts: Timestamp): StopDraft => ({ type: 'stop_hooks', ts, hooks: [], commands: [], errors: [], prevented: false, reason: '' });

  function addHook(h: Hook, toolId: ToolUseId | null, ts: Timestamp): void {
    const tool = toolId ? byTool.get(toolId) : undefined;
    let list: Hook[];
    if (tool) list = /^(Pre|Permission)/.test(h.event) ? tool.pre : tool.post;
    else if (h.event === 'SessionStart') list = start.hooks;
    else if (h.event === 'UserPromptSubmit') list = (lastPrompt ?? hooked).hooks;
    else if (h.event === 'Stop' || h.event === 'SubagentStop') {
      list = (cur.type === 'stop_hooks' ? cur : push(newStop(ts))).hooks;
    } else if (h.event === 'PreCompact') list = pendingPreCompact;
    else if (h.event === 'SessionEnd') list = end.hooks;
    else list = hooked.hooks;
    // A hook can show as a progress record and later as a result record.
    const key = `${toolId ?? ''}|${h.name}`;
    const prev = hookSeen.get(key);
    if (prev && prev.list === list) {
      if (h.outcome !== 'run') {
        const merged: Hook = { ...h, command: h.command || prev.hook.command };
        list[prev.index] = merged;
        prev.hook = merged;
      }
      return;
    }
    list.push(h);
    hookSeen.set(key, { list, index: list.length - 1, hook: h });
  }

  function onUser(r: Rec): void {
    const c = asRec(r.message).content;
    if (Array.isArray(c) && c.some((b) => asRec(b).type === 'tool_result')) {
      for (const b of c) {
        const block = asRec(b);
        if (block.type !== 'tool_result') continue;
        const id = parseToolUseId(block.tool_use_id);
        const t = id && byTool.get(id);
        if (t) {
          t.result = { text: resultText(block), isError: !!block.is_error };
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
    const content = textOf(c).trim();
    if (!content) return;
    const ts = parseTimestamp(r.timestamp);
    if (INTERRUPTED.test(content)) {
      push({ type: 'interrupt', ts });
      return;
    }
    const cmd = content.match(/<command-name>([\s\S]*?)<\/command-name>/);
    if (cmd) {
      const args = content.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '';
      push({ type: 'command', ts, name: (cmd[1] ?? '').trim(), args: args.trim(), output: '', hooks: [] });
      return;
    }
    const bash = content.match(/<bash-input>([\s\S]*?)<\/bash-input>/);
    if (bash) {
      push({ type: 'command', ts, name: '!', args: (bash[1] ?? '').trim(), output: '', hooks: [] });
      return;
    }
    const out = content.match(/<(local-command-stdout|bash-stdout)>([\s\S]*?)<\/\1>/);
    if (out) {
      if (cur.type === 'command') cur.output = (cur.output ? cur.output + '\n' : '') + (out[2] ?? '');
      return;
    }
    if (/^<(system-reminder|local-command-caveat|bash-stderr)/.test(content)) return;
    meta.firstPrompt ||= content;
    lastPrompt = push({ type: 'prompt', ts, text: content, hooks: [] });
  }

  function onAssistant(r: Rec): void {
    const m = r.message;
    if (!isRec(m)) return;
    const ts = parseTimestamp(r.timestamp);
    if (m.model === '<synthetic>') {
      push({ type: 'notice', ts, text: textOf(m.content) });
      return;
    }
    const id = str(m.id) || str(r.requestId) || str(r.uuid);
    const model = str(m.model);
    let ev = byMsg.get(id);
    if (!ev) {
      requestNo++;
      ev = push<RequestDraft>({ type: 'request', ts, model, usage: null, stopReason: '', blocks: [], tools: [], hooks: [] });
      byMsg.set(id, ev);
      if (model && !meta.models.includes(model)) meta.models.push(model);
    }
    for (const b of asArr(m.content)) {
      if (!isRec(b)) continue;
      switch (b.type) {
        case 'tool_use': {
          // A tool_use block without an id cannot be matched to a result: skip it.
          const toolId = parseToolUseId(b.id);
          if (!toolId) break;
          const t: ToolDraft = { id: toolId, name: str(b.name), input: b.input, pre: [], post: [], result: null, subagent: null };
          ev.tools.push(t);
          byTool.set(toolId, t);
          ev.blocks.push({ type: 'tool_use', toolId });
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
          ev.blocks.push({ type: 'server_tool_use', name: str(b.name), input: b.input });
          break;
      }
    }
    const stopReason = str(m.stop_reason);
    if (stopReason) ev.stopReason = stopReason;
    if (typeof m.usage === 'object' && m.usage !== null) ev.usage = normalizeUsage(asRec(m.usage));
  }

  function onSystem(r: Rec): void {
    const ts = parseTimestamp(r.timestamp);
    switch (r.subtype) {
      case 'stop_hook_summary': {
        const s = cur.type === 'stop_hooks' ? cur : push(newStop(ts));
        s.commands = asArr(r.hookInfos)
          .map((h) => asRec(h).command)
          .filter(isString);
        s.errors = asArr(r.hookErrors).map((e) => (typeof e === 'string' ? e : JSON.stringify(e)));
        s.prevented = !!r.preventedContinuation;
        s.reason = str(r.stopReason);
        break;
      }
      case 'compact_boundary': {
        const cm = asRec(r.compactMetadata);
        lastCompact = push<CompactionDraft>({
          type: 'compaction',
          ts,
          trigger: cm.trigger === 'manual' ? 'manual' : 'auto',
          preTokens: typeof cm.preTokens === 'number' ? cm.preTokens : null,
          summary: '',
          hooks: pendingPreCompact,
        });
        pendingPreCompact = [];
        break;
      }
      case 'api_error':
        if (cur.type === 'api_error') cur.count = toPositiveCount(cur.count + 1);
        else {
          const err = asRec(r.error);
          const msg = err.message || asRec(err.error).message || r.content || JSON.stringify(r.error || {});
          push({ type: 'api_error', ts, count: toPositiveCount(1), message: typeof msg === 'string' ? msg : JSON.stringify(msg) });
        }
        break;
      case 'local_command':
        onUser({ ...r, message: { content: r.content } });
        break;
    }
  }

  for (const r of main) {
    const ts = parseTimestamp(r.timestamp);
    if (ts) {
      meta.startedAt ||= ts;
      meta.endedAt = ts;
    }
    meta.sessionId ||= toSessionId(str(r.sessionId));
    meta.cwd ||= str(r.cwd);
    meta.version ||= str(r.version);
    meta.entrypoint ||= str(r.entrypoint);
    if (str(r.gitBranch)) meta.gitBranch = str(r.gitBranch);
    start.ts ||= ts;
    switch (r.type) {
      case 'user':
        onUser(r);
        break;
      case 'assistant':
        onAssistant(r);
        break;
      case 'attachment': {
        const a = asRec(r.attachment);
        const type = str(a.type);
        if (!type) break;
        if (type.startsWith('hook_')) addHook(hookFromAttachment(a, type), parseToolUseId(a.toolUseID), ts);
        else if (requestNo === 0) {
          const line = contextLine(a, type);
          if (line && !contextLines.includes(line)) contextLines.push(line);
        }
        break;
      }
      case 'progress': {
        const data = asRec(r.data);
        if (data.type === 'hook_progress') addHook(hookFromProgress(data), parseToolUseId(r.toolUseID) ?? parseToolUseId(r.parentToolUseID), ts);
        break;
      }
      case 'system':
        onSystem(r);
        break;
    }
  }

  end.ts = meta.endedAt;
  // The compiler checks the shape of the list (invariant 1): session_start first,
  // session_end last, a context event only after session_start.
  const middle = body.map(finishEvent);
  const events: SessionEvents = contextLines.length
    ? [start, { type: 'context', ts: start.ts, items: contextLines }, ...middle, end]
    : [start, ...middle, end];
  return { meta, events };
}

/** A body event in its final form: its tool calls get their status. */
function finishEvent(e: BodyDraft): BodyEvent {
  return e.type === 'request' ? { ...e, tools: e.tools.map(finishTool) } : e;
}

export const claudeCode: Format = {
  id: 'claude-code',
  name: 'Claude Code',
  detect({ head }) {
    for (const line of String(head).split('\n')) {
      if (!line.trim()) continue;
      let r: unknown;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (isRec(r) && typeof r.sessionId === 'string' && typeof r.type === 'string' && RECORD_TYPES.has(r.type)) return true;
    }
    return false;
  },
  parse,
};
