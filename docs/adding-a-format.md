# Adding a log format

A format module turns the log of one harness (for example, another coding agent) into a `Session`. The view and the renderer do not change.

The contract is `src/model.js`. Read it first. It defines `Session`, `SessionMeta`, `SessionEvent`, `Hook`, `ToolCall`, `Usage`, and `Block`.

```
source (find files) -> format (parse one file) -> Session -> view (steps) -> render (HTML)
```

## The Format interface

The interface is in `src/formats/index.js`:

```js
/**
 * @typedef {object} Format
 * @property {string} id      e.g. "claude-code"
 * @property {string} name    e.g. "Claude Code"
 * @property {(sample: {path: string, head: string}) => boolean} detect
 *           `head` is the first 64 KiB (or less) of the file.
 * @property {(text: string, opts: {file: string}) => Session} parse
 */
```

- `id` is what the user passes to `-f, --format`. It is also `meta.harness` in the Session.
- `detect` must be fast and must not throw. Return `true` only when the file is surely your format. The registry tries the formats in order and uses the first match.
- `parse` gets the whole file as text and the base name of the file. It returns a `Session`. It must not read the disk.

## Rules for `parse`

- The first event is `session_start`. The last event is `session_end`.
- Put at most one `context` event directly after `session_start`.
- Skip a line that you cannot read. A session that is still open can end in a partial line.
- Do not put secrets or private data of the harness into the Session.
- A `tool_use` block points to the `ToolCall` with the same `id` in `request.tools`.
- Use `''` for an unknown text field, `0` for a missing token count, and `null` where the model allows it.

## A minimal example

This format reads a log with one JSON object per line. Each object has `type` set to `user` or `assistant`, a `text`, and a `ts`.

```js
// @ts-check
// src/formats/my-harness.js

/** @typedef {import('../model.js').Session} Session */
/** @typedef {import('../model.js').SessionEvent} SessionEvent */

/** @type {import('./index.js').Format} */
export const myHarness = {
  id: 'my-harness',
  name: 'My Harness',

  detect({ head }) {
    const first = head.split('\n').find((line) => line.trim());
    try {
      return JSON.parse(first ?? '').harness === 'my-harness';
    } catch {
      return false;
    }
  },

  parse(text, { file }) {
    /** @type {any[]} */
    const records = [];
    for (const line of text.split('\n')) {
      try {
        const r = JSON.parse(line);
        if (r && typeof r === 'object') records.push(r);
      } catch {
        // blank or partial line
      }
    }

    const startedAt = records[0]?.ts ?? '';
    const endedAt = records.at(-1)?.ts ?? '';

    /** @type {SessionEvent[]} */
    const events = [{ type: 'session_start', ts: startedAt, hooks: [] }];
    for (const r of records) {
      if (r.type === 'user') {
        events.push({ type: 'prompt', ts: r.ts ?? '', text: String(r.text ?? ''), hooks: [] });
      } else if (r.type === 'assistant') {
        events.push({
          type: 'request',
          ts: r.ts ?? '',
          model: String(r.model ?? ''),
          usage: null,
          stopReason: '',
          blocks: [{ type: 'text', text: String(r.text ?? '') }],
          tools: [],
          hooks: [],
        });
      }
    }
    events.push({ type: 'session_end', ts: endedAt, hooks: [] });

    /** @type {Session} */
    const session = {
      meta: {
        harness: 'my-harness',
        harnessName: 'My Harness',
        file,
        sessionId: file.replace(/\.jsonl$/, ''),
        cwd: '',
        gitBranch: '',
        version: '',
        entrypoint: '',
        models: [...new Set(records.map((r) => r.model).filter(Boolean))],
        firstPrompt: String(records.find((r) => r.type === 'user')?.text ?? ''),
        startedAt,
        endedAt,
        contextWindow: null,
      },
      events,
    };
    return session;
  },
};
```

## Register the format

Add the module to the `formats` array in `src/formats/index.js`. This is the only change in `src/formats/index.js`.

```js
import { claudeCode } from './claude-code.js';
import { myHarness } from './my-harness.js';

/** @type {Format[]} */
export const formats = [claudeCode, myHarness];
```

The order matters: `detectFormat` returns the first format whose `detect` is `true`. Put a strict `detect` first. `--help` lists the new ID, and `-f my-harness` selects it.

## Add a source for its session files

A format reads a file. A source finds files. If the harness stores its sessions in a known place, add a source so that `session-trace` and `session-trace --list` find them. If you only need `session-trace <path>`, skip this step.

The interface is in `src/sources/index.js`:

```js
/**
 * @typedef {object} SessionSource
 * @property {string} id
 * @property {string} name
 * @property {(env: Record<string, string | undefined>, home: string) => string} root
 * @property {(root: string, opts?: { limit?: number }) => Promise<SessionInfo[]>} list
 * @property {(root: string, id: string) => Promise<string | null>} resolve
 */
```

- `root(env, home)` returns the data directory of the harness. Read it from `env` and `home`, never from `process.env`. Claude Code uses `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
- `list(root, {limit})` returns `SessionInfo` objects (`id`, `path`, `source`, `project`, `modifiedAt`, `size`, `firstPrompt`), newest first. It reads only the start of each file. A missing directory gives `[]`.
- `resolve(root, id)` returns the path of the session with this ID or unique ID prefix, or `null`. For an ambiguous ID, throw `AmbiguousSessionError` (exported from `src/sources/claude-code.js`).

Write the module, then add it to the `sources` array in `src/sources/index.js`:

```js
export const sources = [claudeCodeSource, myHarnessSource];
```

The CLI merges the lists of all sources, sorts them by time, and tries each source to resolve an ID. A source imports only Node built-ins. It does not import a format.

## Test the format

- Put a small log in `test/` and a test in `test/formats/<id>.test.js`. Use `node:test` and `node:assert/strict`.
- Check the Session against the rules above. The test for Claude Code compares the output with `test/golden/fixture.session.json`.
- Run `npm test`, or `node --test 'test/formats/*.test.js'` for the format tests only.
- Do a manual check: `node bin/session-trace.js --format my-harness path/to/log --stdout`.
