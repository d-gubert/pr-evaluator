# Adding a log format

A format module turns the log of one harness (for example, another coding agent) into a `Session`. The view and the renderer do not change.

The contract is `src/model.ts`. Read it first. It defines the types `Session`, `SessionMeta`, `SessionEvent` (one named type for each event kind), `Hook`, `ToolCall`, `Usage`, and `Block`. The types encode the rules of a Session, so the compiler rejects a format that breaks them (see "Rules for `parse`").

```
source (find files) -> format (parse one file) -> Session -> view (steps) -> render (HTML)
```

## The Format interface

The type is in `src/formats/index.ts`:

```ts
export type Format = {
  readonly id: string; // e.g. "claude-code"
  readonly name: string; // e.g. "Claude Code"
  // `head` is the first 64 KiB (or less) of the file.
  readonly detect: (sample: { readonly path: string; readonly head: string }) => boolean;
  readonly parse: (text: string, opts: { readonly file: string }) => Session;
};
```

- `id` is what the user passes to `-f, --format`. It is also `meta.harness` in the Session.
- `detect` must be fast and must not throw. Return `true` only when the file is surely your format. The registry tries the formats in order and uses the first match.
- `parse` gets the whole file as text and the base name of the file. It returns a `Session`. It must not read the disk.

## Rules for `parse`

The compiler checks the first five rules. If a format breaks one of them, `npm run typecheck` fails.

- The first event is `session_start`. The last event is `session_end`. Neither occurs anywhere else. `Session.events` has the type `SessionEvents`, which is a tuple type: `[SessionStartEvent, ...BodyEvent[], SessionEndEvent]`.
- Put at most one `context` event directly after `session_start`. `SessionEvents` allows `[SessionStartEvent, ContextEvent, ...BodyEvent[], SessionEndEvent]` and nothing else.
- Each event is one of the named event types (`PromptEvent`, `RequestEvent`, ...). The field `type` tells which.
- A `ToolCall` has `result: null` exactly when `status` is `'no result'`. Any other status needs a result.
- `compaction.trigger` is `'auto'` or `'manual'`. A `Hook.outcome` is a known word (`'ok'`, `'block'`, ...) or any other string of your harness.
- Make the branded values with the functions of `src/model.ts`: `toSessionId`, `parseToolUseId` (the ID of a tool call, never empty), `parseTimestamp` (an ISO 8601 string, or `''` for an unknown time), and `toPositiveCount` (`api_error.count`, 1 or more). The compiler does not accept a plain string or number in these places. It cannot check the range of a number, so `toPositiveCount` throws a `RangeError` for a value below 1.
- A `tool_use` block points to the `ToolCall` with the same ID in `request.tools`. The compiler checks the type of the ID. It cannot check that the call exists, so you must add both. `test/model/invariants.test.ts` shows how to check this.
- The model is `readonly`. Collect the data in your own mutable variables and build the model at the end. Do not change a `Session` after you return it.
- Skip a line that you cannot read. A session that is still open can end in a partial line.
- Read the log as `unknown`, and narrow it with checks (`typeof`, `Array.isArray`, a small type guard). Do not use `any`, and do not cast the log to a type.
- Do not put secrets or private data of the harness into the Session.
- Use `''` for an unknown text field, `0` for a missing token count, and `null` where the model allows it.

## A minimal example

This format reads a log with one JSON object per line. Each object has `type` set to `user` or `assistant`, a `text`, and a `ts`.

```ts
// src/formats/my-harness.ts
import { parseTimestamp, toSessionId } from '../model.js';
import type { BodyEvent, SessionEvents, Timestamp } from '../model.js';
import type { Format } from './index.js';

/** One readable line of the log. */
type Line = {
  readonly type: string;
  readonly text: string;
  readonly model: string;
  readonly ts: Timestamp;
};

// The log is `unknown` until a check narrows it.
const field = (x: object, key: string): unknown => Reflect.get(x, key);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

function readLines(text: string): Line[] {
  const lines: Line[] = [];
  for (const raw of text.split('\n')) {
    try {
      const x: unknown = JSON.parse(raw);
      if (typeof x !== 'object' || x === null) continue;
      lines.push({
        type: str(field(x, 'type')),
        text: str(field(x, 'text')),
        model: str(field(x, 'model')),
        ts: parseTimestamp(field(x, 'ts')),
      });
    } catch {
      // blank or partial line
    }
  }
  return lines;
}

export const myHarness: Format = {
  id: 'my-harness',
  name: 'My Harness',

  detect({ head }) {
    const first = head.split('\n').find((line) => line.trim());
    try {
      const x: unknown = JSON.parse(first ?? '');
      return typeof x === 'object' && x !== null && field(x, 'harness') === 'my-harness';
    } catch {
      return false;
    }
  },

  parse(text, { file }) {
    const lines = readLines(text);
    const startedAt = lines[0]?.ts ?? '';
    const endedAt = lines.at(-1)?.ts ?? '';

    const body: BodyEvent[] = [];
    for (const line of lines) {
      if (line.type === 'user') {
        body.push({ type: 'prompt', ts: line.ts, text: line.text, hooks: [] });
      } else if (line.type === 'assistant') {
        body.push({
          type: 'request',
          ts: line.ts,
          model: line.model,
          usage: null,
          stopReason: '',
          blocks: [{ type: 'text', text: line.text }],
          tools: [],
          hooks: [],
        });
      }
    }

    // The compiler checks the shape of this list: `session_start` first, `session_end` last.
    const events: SessionEvents = [
      { type: 'session_start', ts: startedAt, hooks: [] },
      ...body,
      { type: 'session_end', ts: endedAt, hooks: [] },
    ];

    return {
      meta: {
        harness: 'my-harness',
        harnessName: 'My Harness',
        file,
        sessionId: toSessionId(file.replace(/\.jsonl$/, '')),
        cwd: '',
        gitBranch: '',
        version: '',
        entrypoint: '',
        models: [...new Set(lines.map((line) => line.model).filter(Boolean))],
        firstPrompt: lines.find((line) => line.type === 'user')?.text ?? '',
        startedAt,
        endedAt,
        contextWindow: null,
      },
      events,
    };
  },
};
```

## Register the format

Add the module to the `formats` tuple in `src/formats/index.ts`. This is the only change in `src/formats/index.ts`. The registry is a non-empty readonly tuple (`readonly [Format, ...Format[]]`), so the compiler rejects an empty registry.

```ts
import { claudeCode } from './claude-code.js';
import { myHarness } from './my-harness.js';

export const formats: NonEmptyReadonly<Format> = [claudeCode, myHarness];
```

The order matters: `detectFormat` returns the first format whose `detect` is `true`. Put a strict `detect` first. `--help` lists the new ID, and `-f my-harness` selects it.

## Add a source for its session files

A format reads a file. A source finds files. If the harness stores its sessions in a known place, add a source so that `yast` and `yast --list` find them. If you only need `yast <path>`, skip this step.

The type is in `src/sources/index.ts`:

```ts
export type SessionSource = {
  readonly id: string;
  readonly name: string;
  readonly root: (env: Readonly<Record<string, string | undefined>>, home: string) => string;
  readonly list: (root: string, opts?: { readonly limit?: number }) => Promise<SessionInfo[]>;
  readonly resolve: (root: string, id: string) => Promise<string | null>;
};
```

- `root(env, home)` returns the data directory of the harness. Read it from `env` and `home`, never from `process.env`. Claude Code uses `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
- `list(root, {limit})` returns `SessionInfo` objects (`id`, `path`, `source`, `project`, `modifiedAt`, `size`, `firstPrompt`), newest first. It reads only the start of each file. A missing directory gives `[]`.
- `resolve(root, id)` returns the path of the session with this ID or unique ID prefix, or `null`. For an ambiguous ID, throw `AmbiguousSessionError` (exported from `src/sources/claude-code.ts`).

Write the module, then add it to the `sources` tuple in `src/sources/index.ts`. It is a non-empty readonly tuple, like `formats`:

```ts
export const sources: NonEmptyReadonly<SessionSource> = [claudeCodeSource, myHarnessSource];
```

The CLI merges the lists of all sources, sorts them by time, and tries each source to resolve an ID. A source imports only Node built-ins. It does not import a format or the model.

## Test the format

- Put a small log in `test/` and a test in `test/formats/<id>.test.ts`. Use `node:test` and `node:assert/strict`. The tests are TypeScript. `npm test` builds the project and runs the compiled tests from `dist/test/`.
- Check the Session against the rules above. The test for Claude Code compares the output with `test/golden/fixture.session.json`. `test/support/decode.ts` has `decodeSession` (checks that JSON is a valid `Session`) and `findViolations` (checks that every `tool_use` block has its call).
- Run `npm run typecheck` for the type rules, and `npm test` for the tests. To run only the format tests after a build: `node --test 'dist/test/formats/*.test.js'`.
- Do a manual check: `npm run build && node dist/bin/yast.js --format my-harness path/to/log --stdout`.
