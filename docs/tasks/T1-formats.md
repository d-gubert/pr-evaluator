# T1: Formats — registry and Claude Code parser

Read `docs/plan.md` and `src/model.js` first.

## Scope

Create the format layer. A format turns the text of one log file into a `Session`.

Files you create (and no others):

- `src/formats/index.js`
- `src/formats/claude-code.js`
- `test/formats/claude-code.test.js`
- `test/formats/registry.test.js`

## Public API

```js
// src/formats/index.js
/**
 * @typedef {object} Format
 * @property {string} id                       e.g. "claude-code"
 * @property {string} name                     e.g. "Claude Code"
 * @property {(sample: {path: string, head: string}) => boolean} detect
 *           `head` is the first 64 KiB (or less) of the file.
 * @property {(text: string, opts: {file: string}) => Session} parse
 */
export const formats;                        // Format[]; Claude Code first
export function getFormat(id);               // Format | undefined
export function detectFormat(sample);        // Format | undefined (first match)
export function parseSession(text, opts);    // opts: {file: string, format?: string}
                                             // uses opts.format, else detectFormat({path: opts.file, head})
export class UnknownFormatError extends Error {}   // thrown by parseSession when no format matches
                                                   // or opts.format is not a known id
```

`src/formats/claude-code.js` exports `claudeCode` (a `Format`). To add a format later, a
developer writes one module and adds it to the `formats` array. Nothing else changes.

## Behavior

Port the parse half of `buildTrace` in `session-trace.mjs` (the code before `render`).
Map its internal step kinds to the event types of `src/model.js`. Differences from the old code:

- Output is a `Session`, not display steps. No text clipping, no display formatting,
  except the `context` event: its `items` are the short lines that `contextLine` makes now.
- Usage fields are normalized (`input`, `cacheRead`, `cacheWrite`, `output`, `thinking`).
- `ToolCall.status` and `ToolCall.result.text` come from the parser (see `toolStatus`, `resultText`).
- Hook `detail` is the full text.
- `meta.harness = "claude-code"`, `meta.harnessName = "Claude Code"`, `meta.contextWindow = null`.

Keep these rules from the old code:

- Skip records with `isSidechain: true`.
- Ignore a line that is not valid JSON (a live session can end in a partial line).
- Never put `session_context`, `credential_org`, or `remote_session_change` attachments
  into the Session. They hold private data.
- `detect` returns true when the head has a JSON line with a string `sessionId` and a
  `type` in `user | assistant | system | attachment | summary | progress | queue-operation`.

## Definition of done

1. `claudeCode.parse(readFileSync('test/fixture.jsonl','utf8'), {file: 'fixture.jsonl'})`
   deep-equals `test/golden/fixture.session.json` (`assert.deepEqual` after a JSON round trip).
2. Tests show: partial last line ignored; sidechain records skipped; a test log with a
   `session_context` attachment gives a Session whose JSON has no trace of its text; `detect` true for the fixture head and false
   for `{"a":1}` and for plain text.
3. Registry tests: `getFormat('claude-code')`, `detectFormat`, `parseSession` with and without
   `opts.format`, and `UnknownFormatError` for unknown text and for an unknown id.
4. Smoke: every `*.jsonl` directly under `~/.claude/projects/*/` parses without a throw, and
   the first event is `session_start` and the last is `session_end`. Skip this test when the
   directory does not exist.
5. `node --test test/formats/` passes. No file outside the list above changes.
6. `src/formats/` imports only node built-ins and model types.
