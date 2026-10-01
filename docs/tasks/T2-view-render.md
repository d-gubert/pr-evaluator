# T2: View and HTML renderer

Read `docs/plan.md` and `src/model.js` first.

## Scope

Create the layers after the parser: `Session → View → HTML`. These layers know the
Session model only. They know no log format.

Files you create (and no others):

- `src/view/steps.js`   (public: `toView`)
- `src/view/text.js`    (private helpers: clip, quote, num, ktok, plural, times, duration, countNames)
- `src/render/html.js`  (public: `renderHtml`)
- `src/render/page.html` (the page template)
- `test/view/steps.test.js`
- `test/render/html.test.js`

## Public API

```js
// src/view/steps.js
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
export function toView(session);   // View

// src/render/html.js
export function renderHtml(view);   // string: one self-contained HTML page
```

## Behavior

Port `render`, `describe`, `describeTurn`, `describeEnd`, and their helpers from
`session-trace.mjs`, but read the Session model instead of the old internal steps.
One event gives one step. The turn number is the index of the `request` event (1-based).
Where the old text says "Claude Code" for the harness, use `meta.harnessName`.

Window rule: `meta.contextWindow` when it is a number. Else 1,000,000 when a request context
is above 200,000 or a model id contains `[1m]`. Else 200,000.

Move the `PAGE` template into `src/render/page.html`. `renderHtml` reads it once
(`new URL('./page.html', import.meta.url)`) and puts the View JSON into it. Escape `<`,
U+2028 and U+2029 in the JSON (see the old `renderHtml`). The `<h1>` and the note use
`meta.harnessName`. Keep the layout, the CSS, and the script of the page the same.

## Definition of done

1. `toView(golden session).steps` deep-equals `test/golden/fixture.steps.json`, where
   golden session = `test/golden/fixture.session.json`. Also `meta.turns === 6` and
   `meta.window === 200000`.
2. Window tests: a request with 250,000 context tokens gives 1,000,000; a model
   `claude-x[1m]` gives 1,000,000; `meta.contextWindow: 32000` gives 32000.
3. A test with a different `harnessName` shows that name in the start step and in the HTML.
4. Render tests: the HTML holds the step titles in the data block; a step title
   `</script><script>alert(1)</script>` does not end the data script (only the 2 real
   `</script>` tags remain); U+2028 is escaped.
5. `node --test 'test/view/*.test.js' 'test/render/*.test.js'` passes. No file outside the list above changes.
6. `src/view/` and `src/render/` import nothing from `src/formats/`, `src/sources/`, or `src/cli/`.
