# Lesson Loop — companion demo

Interactive lab for the article *An Agent That Learns From Its Mistakes Is
Just Editing a Text File*. A toy agent fails a scripted pipeline task,
writes a lesson into its own prompt file, and re-runs — and the four modes
show that "self-improving" depends entirely on the write-back policy.

Zero dependencies — Node 20+ only. The loop engine
(`public/lessonloop.mjs`) is a plain ES module shared by the browser lab,
the CLI report, and the test suite.

## The four modes

| Mode | What it proves |
|---|---|
| **Memory off** | The lesson is produced but never persisted — every episode fails identically. "It improves" is only true if the lesson survives to the next run. |
| **Write-back on** | Episode 1 fails on `store: rejected unvalidated record`; the lesson `run validate before store` is appended; episode 2 passes. |
| **Wrong lesson** | The reflection misdiagnoses the failure and prescribes a `recheck` no-op. The plan obeys it forever — a learned bug. |
| **Guarded write-back** | A candidate lesson must pass a sandboxed replay of the failed episode before it is persisted — the fix for learned bugs. |

A **Stress memory** button appends 12 lessons with a cap of 6 to show
append-only bloat and the dedupe/compact remedy.

## Run it

```text
npm start       # serve the lab on :3000
npm test        # loop, persistence, and server tests
npm run scan    # CLI side-by-side report for all four modes + persistence proof
npm run check   # both
```

## Examples

- `examples/scenario.json` — the task, the step catalog, the hidden rule,
  the naive plan, and the correct/wrong lesson fixtures.

## Honest limits

- The "agent" is deterministic — `reflect()` is a lookup table, not an LLM.
  The demo isolates the *write-back mechanism* (persist, misdiagnose, guard,
  compact), not model quality.
- The guarded mode replays one episode. A real system needs a regression
  suite, not a single retry.
- The lesson store is a JSON file; real agents use prompt sections, memory
  tools, or files like `AGENTS.md`. The failure modes are identical.
- Not affiliated with PrimeIntellect — inspired by the self-improving
  design described for Prime Agent.

This is an educational demo, not production infrastructure.
