# T3: Session sources — profile directory, list, resolve

Read `docs/plan.md` first.

## Scope

Create the layer that finds session files on disk. It does not parse whole logs.

Files you create (and no others):

- `src/sources/index.js`
- `src/sources/claude-code.js`
- `test/sources/claude-code.test.js`

## Public API

```js
// src/sources/index.js
/**
 * @typedef {object} SessionInfo
 * @property {string} id          file name without ".jsonl"
 * @property {string} path        absolute path
 * @property {string} source      source id, e.g. "claude-code"
 * @property {string} project     cwd from the log, else the project directory name
 * @property {Date}   modifiedAt  file mtime
 * @property {number} size        bytes
 * @property {string} firstPrompt first user prompt, "" when none in the head
 * @typedef {object} SessionSource
 * @property {string} id
 * @property {string} name
 * @property {(env: Record<string,string|undefined>, home: string) => string} root
 * @property {(root: string, opts?: {limit?: number}) => Promise<SessionInfo[]>} list
 * @property {(root: string, id: string) => Promise<string|null>} resolve
 */
export const sources;                 // SessionSource[]; Claude Code first
export function getSource(id);        // SessionSource | undefined
export class AmbiguousSessionError extends Error { candidates /* string[] paths */ }
```

`src/sources/claude-code.js` exports `claudeCodeSource`.

## Behavior

- `root(env, home)`: `env.CLAUDE_CONFIG_DIR` when set and not empty, else `join(home, '.claude')`.
  No other place in the code reads this variable.
- `list(root)`: read `<root>/projects/*/*.jsonl` (one level only; ignore subagent files in
  nested directories). Sort newest `modifiedAt` first. Apply `limit` after the sort.
  A missing directory gives `[]`, not an error.
- Read only the first 64 KiB of each file for `project` and `firstPrompt`.
  `firstPrompt` is the first `type: "user"` record with string content (or text blocks) that is
  not `isMeta`, not `isSidechain`, not a tool result, and does not start with `<` (command
  wrappers, reminders). Skip lines that are not valid JSON.
- `resolve(root, id)`: an exact id match, else a unique prefix of 4 or more characters.
  Two or more matches throw `AmbiguousSessionError`. No match returns `null`.
- Use `node:fs/promises`. Do not block on large files.

## Definition of done

1. Tests build a temporary profile with `mkdtemp`: two projects, three sessions with set
   mtimes (`utimes`), one subagent file in a nested directory, one non-jsonl file.
2. Tests show: `root` uses `CLAUDE_CONFIG_DIR`, else `<home>/.claude`; the order is newest
   first; `limit` works; the nested and non-jsonl files are not listed; `project` comes from
   `cwd`; `firstPrompt` skips `isMeta` and `<command-name>` records; a missing root gives `[]`.
3. Tests show `resolve`: exact id, unique prefix, a prefix shorter than 4 characters gives
   `null`, ambiguous prefix throws `AmbiguousSessionError` with 2 candidates.
4. A test shows that `list` reads at most 64 KiB per file (a 1 MiB file with the prompt after
   64 KiB gives `firstPrompt === ""`).
5. `node --test test/sources/` passes. No file outside the list above changes.
6. `src/sources/` imports only node built-ins.
