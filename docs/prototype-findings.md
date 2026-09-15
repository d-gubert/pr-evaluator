# Prototype findings — 2026-09-15

The prototype answers the question "can we build this before we answer the
open questions". The answer is yes. No open question blocks the pipeline.
Each one needs a stated assumption, and the prototype states it.

The prototype then measured four things the design did not know.

Reference checkout:
`/home/douglas-gubert/dev/RocketChat/worktrees/accessor-consolidation`.

## Open question 9 — delta noise: ANSWERED, PASS

Commit `b69545de16` upgrades prettier and it reformats the repository. It is
the pure reformat that open question 9 asks for.

| measure | value |
|---|---|
| touched modules | 28 |
| boundary symbols compared | 3072 |
| modules with a non-zero fact delta | **0** |
| boundary symbols with a changed fact | **0** |

**Verdict: the facts are stable against a reformat.** Line numbers move and
the numbers do not. D12 stands.

## Open question 11 — config patterns: the patterns are still wrong

The patterns of D1 run, and two of them fail against a real change.

1. `apps/meteor/client/*` makes `apps/meteor/client/views` **one module of
   1870 files**. Commit `89cd73af36` changes `MessageBox.tsx` inside it. The
   report shows a zero delta on every fact, because the change never reaches
   a boundary symbol of a module that large. A module must be small enough
   that a change moves one of its numbers.
2. `apps/meteor/app/*/*` stops at `apps/meteor/app/apps/server`, so
   `apps/meteor/app/apps/server/converters` is not a module. The probe round
   measured that directory as a module. The patterns and the probes disagree.

Both are pattern faults, not engine faults. The engine reports what the
patterns ask for.

## D2 needs a second gap — the entry file understates the surface

D2 says the gap between the declared surface and the used surface is a
finding: an export that nobody uses widens the boundary. The prototype
measured the gap in the other direction, and it is larger.

`packages/apps/src` has an entry file. That file declares **4** names.
Consumers import **103** distinct names from deep paths inside the module,
past the entry file.

So the boundary has two gaps, not one:

- **unused** — declared, and nobody imports it.
- **bypassed** — imported, and the entry file does not declare it.

The model now carries both. A bypassed name is part of the real surface, so
the declared list holds it.

## D15 has two more traps, and both are silent

D15 covers `node_modules/@rocket.chat/*` and `<pkg>/dist/**.d.ts`. Two more
shapes produce the same silent failure.

1. **A published subpath.** `@rocket.chat/apps-engine/definition/users` is
   `packages/apps-engine/src/definition/users.ts`. A naive join gives
   `packages/apps-engine/definition/users`, which does not exist.
2. **A build committed at the package root.** `packages/apps-engine` commits
   `definition/users/index.js`. That path *does* exist, so the resolver lands
   on built JavaScript with no types and the wrong module.

Before the fix, `packages/apps-engine/src` reported a used surface of 0 and
0 dependents, with 274 files. The failure looked exactly like a real answer.

**The rule the resolver now follows: the source tree wins. Try
`<pkg>/src/<rest>` before `<pkg>/<rest>`.**

## D14 — a stop must be scoped to the module, or it floods

The first implementation marked a stop whenever a callee had no body. On
`apps/meteor/server/api` that produced 275 `interface` stops, and the
confidence value became meaningless.

Almost all of them are calls into another package through an interface. D6
stops at the module edge by design, so that is not a loss.

The rule: mark a stop only when the body-less declaration sits **inside the
module**, or when the call does not resolve at all. The same module then
reports 1 `interface` stop, 28 `function-type` and 3 `unresolved`. Those are
real losses, and they match the three causes the probe round found.

## D13 earned its place — the cross-check found three bugs in our counter

D13 says to cross-check every metric against a second implementation. The
cross-check compares a statement walk against a token walk over every file of
a directory. The two must agree exactly.

It found three real bugs in our own counter:

1. **A curried arrow absorbed its inner function.** `(a) => (b) => {...}` has
   a function as its body, so the walk never saw the inner arrow as nested and
   it counted the inner branches twice.
2. **An expression body was skipped.** `(a, b) => a || b` counted 1, because
   the walk iterated the children of the body and never visited the body.
3. **Parameter defaults were skipped.** A `??` inside a default value is a
   decision point under the pinned definition, and the walk never saw it.

It also found a bug in the first cross-check itself: `ts.createScanner`
swallows a template literal whole and it loses every token inside the
substitutions. A raw token scan is not usable. The check now walks the parsed
token tree instead.

After the fixes: **0 files disagree of 1370** in `apps/meteor/server`.

### One calibration gap stays open

Our counter reports **20648** for `apps/meteor/server`. The design pins
**20176** from the research round, a 2.3% difference. The two counters are not
available side by side, so the cause is unknown. The most likely cause is bug
3 above: the pinned number probably never counted the operators inside a
parameter default. Decide which definition wins before a score depends on it.

## What the prototype does not do

- **Coverage is built but never exercised.** `src/coverage.ts` reads istanbul
  `coverage-final.json` and `lcov.info`, and it reduces both to line hits. No
  coverage report was available in the checkout, so fact 6 reports "unknown"
  on every run so far. The Codecov path of open question 6 is not built.
- **A rename is reported, not resolved.** The CLI detects a rename with
  `git diff -M` and it prints the module pair. The delta still treats the
  rename as one module removed and one added. Open question 3 stands.
- **One program per module, from the nearest tsconfig.** A change that spans
  `apps/meteor` and `packages/apps` loads two programs, and they still
  disagree about the same symbol. Open questions 4 and 16 stand.
- **Stale `dist` is not detected.** Tier 1 never reads `dist`. Tier 2 remaps
  a resolved `dist` path back to `src`, which is the cheapest option of open
  question 12. Nothing checks whether the build is current.
- **The effect catalog is not measured.** Open question 5 asks for the hit
  rate. The catalog runs and it reports categories. Nobody has checked how
  much I/O it misses.

## Cost

| step | Rocket.Chat |
|---|---|
| workspace map | 0.9s per tree |
| tier 1, 8731 files | 2.5s to 4.2s per tree |
| module model, 163 modules | 0.4s per tree |
| tier 2, a `packages/*` program | 2s to 6s per tree |
| tier 2, the `apps/meteor` program | 22s per tree |
| a whole run, two trees | 20s to 60s |

The tier 2 program load dominates, which confirms new finding 4 of the probe
round. Two `packages/*` modules cost 11s in total. Two `apps/meteor` modules
cost 45s.
