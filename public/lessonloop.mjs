// Lesson Loop — a toy agent that fails, writes a lesson into its own prompt
// file, and re-runs. Shared by the browser lab, the CLI report, and the tests.
//
// The world is a deterministic step pipeline. The agent plans a step list
// from its prompt (base instructions + a lessons section). The environment
// enforces one rule: `store` rejects a record that was never `validate`d.
// A naive plan skips `validate`, so run 1 always fails the same way.
// reflect() turns that failure into a lesson; the lesson store persists it;
// the planner rewrites the next plan to satisfy every stored lesson.

export const BASE_PROMPT =
  'You are a pipeline agent. Produce a plan that moves a record from ' +
  'source to sink using these steps: fetch, transform, validate, store.';

// ---------------------------------------------------------------------------
// World: execute a plan against the deterministic pipeline rules.
// ---------------------------------------------------------------------------

export function runEpisode(plan) {
  const record = { fetched: false, transformed: 0, validated: false };
  const trace = [];
  for (const step of plan) {
    trace.push(step);
    switch (step) {
      case 'fetch':
        record.fetched = true;
        break;
      case 'transform':
        record.transformed += 1;
        break;
      case 'validate':
        record.validated = true;
        break;
      case 'recheck':
        // a well-formed but useless step — what a wrong lesson buys you
        break;
      case 'store':
        if (!record.fetched) {
          return { ok: false, trace, failure: { step, error: 'store: nothing fetched' } };
        }
        if (record.transformed > 1) {
          return {
            ok: false,
            trace,
            failure: { step, error: 'store: record corrupted by double transform' },
          };
        }
        if (!record.validated) {
          return {
            ok: false,
            trace,
            failure: { step, error: 'store: rejected unvalidated record' },
          };
        }
        return { ok: true, trace, failure: null };
      default:
        return { ok: false, trace, failure: { step, error: `unknown step: ${step}` } };
    }
  }
  return { ok: false, trace, failure: { step: null, error: 'plan ended without store' } };
}

// ---------------------------------------------------------------------------
// Lessons. A lesson is what the agent writes back into its own prompt:
//   { id, text, fix: { before, ensure } }
// `fix` is the actionable part: "before running `before`, make sure `ensure`
// ran at least once." The text is what a human (or the next prompt) reads.
// ---------------------------------------------------------------------------

export function lessonSignature(lesson) {
  return `${lesson.fix.before}<-${lesson.fix.ensure}`;
}

// reflect() is the post-failure step. In a real agent this is an LLM call;
// here it is deterministic so the mechanism — not the model — is the demo.
// `kind: 'wrong'` models a plausible misdiagnosis: the agent blames
// `transform` ("the record must need a second pass") instead of noticing it
// skipped `validate`. The wrong lesson is still syntactically valid and the
// planner will apply it — that is what makes it a learned bug.
export function reflect(failure, kind = 'correct') {
  if (!failure) return null;
  if (failure.step === 'store' && failure.error.includes('unvalidated')) {
    if (kind === 'wrong') {
      return {
        id: 'L-wrong',
        text: 'store rejected the record — re-check the input first; run recheck before store',
        fix: { before: 'store', ensure: 'recheck' },
      };
    }
    return {
      id: 'L1',
      text: 'store rejected an unvalidated record — always run validate before store',
      fix: { before: 'store', ensure: 'validate' },
    };
  }
  if (failure.step === 'store' && failure.error.includes('corrupted')) {
    return {
      id: 'L2',
      text: 'store rejected a corrupted record — never run transform twice',
      fix: { before: 'transform', ensure: '__cap_transform_once__' },
    };
  }
  return {
    id: `L-${Math.abs(hash(failure.error))}`,
    text: `unhandled failure at ${failure.step}: ${failure.error}`,
    fix: null,
  };
}

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

// ---------------------------------------------------------------------------
// Lesson store — the prompt file that survives the run.
// ---------------------------------------------------------------------------

export function createMemoryStore() {
  return { lessons: [], persisted: false };
}

export async function createFileStore(path, fs) {
  // fs is injected so this module stays dependency-free and browser-safe.
  let lessons = [];
  try {
    const raw = await fs.readFile(path, 'utf8');
    lessons = JSON.parse(raw);
  } catch {
    lessons = [];
  }
  return {
    lessons,
    persisted: true,
    async flush() {
      await fs.writeFile(path, JSON.stringify(lessons, null, 2) + '\n');
    },
  };
}

// Append a lesson with the two hygiene rules from the article:
// dedupe identical fixes, and compact once the file exceeds `cap` entries
// (older lessons collapse into a single summary line, most recent kept).
export function appendLesson(store, lesson, { cap = Infinity } = {}) {
  if (!lesson || !lesson.fix) return { added: false, compacted: false };
  const sig = lessonSignature(lesson);
  if (store.lessons.some((l) => l.fix && lessonSignature(l) === sig)) {
    return { added: false, compacted: false, duplicate: true };
  }
  store.lessons.push(lesson);
  let compacted = false;
  if (store.lessons.length > cap) {
    const keep = store.lessons.slice(-Math.max(1, cap - 1));
    const dropped = store.lessons.length - keep.length;
    store.lessons = [
      {
        id: 'L-compacted',
        text: `${dropped} older lesson(s) compacted — check the episode log for details`,
        fix: null,
      },
      ...keep,
    ];
    compacted = true;
  }
  return { added: true, compacted };
}

// The lessons section injected into the next run's prompt.
export function renderLessons(store) {
  if (!store.lessons.length) return '';
  const lines = store.lessons.map((l) => `- ${l.text}`);
  return ['## Lessons from previous runs', ...lines].join('\n');
}

export function promptSize(store) {
  const rendered = renderLessons(store);
  return rendered ? BASE_PROMPT.length + 2 + rendered.length : BASE_PROMPT.length;
}

// ---------------------------------------------------------------------------
// Planner: naive plan + one rewrite pass per stored lesson.
// ---------------------------------------------------------------------------

export const NAIVE_PLAN = ['fetch', 'transform', 'store'];

export function createPlan(store) {
  const plan = [...NAIVE_PLAN];
  for (const lesson of store.lessons) {
    if (!lesson.fix) continue;
    const { before, ensure } = lesson.fix;
    if (ensure === '__cap_transform_once__') {
      // collapse consecutive transforms — lesson L2's remedy
      for (let i = plan.length - 1; i > 0; i--) {
        if (plan[i] === 'transform' && plan[i - 1] === 'transform') plan.splice(i, 1);
      }
      continue;
    }
    const at = plan.indexOf(before);
    if (at === -1) continue;
    // The planner obeys lessons literally: insert `ensure` right before
    // `before` unless it is already the immediate predecessor. It does not
    // check whether `ensure` ran earlier — a lesson is an instruction, not
    // a constraint solver. That is exactly why a wrong lesson sticks.
    if (plan[at - 1] !== ensure) {
      plan.splice(at, 0, ensure);
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// The loop: episode → reflect → (optionally) guard by replay → persist.
// ---------------------------------------------------------------------------

// Modes:
//   off      — no write-back: lessons die with the run (failure repeats)
//   learn    — correct lesson persisted: run 2 passes
//   wrong    — misdiagnosed lesson persisted: a learned bug, fails forever,
//              and the failure *changes* because the plan changed
//   guarded  — lesson must survive a sandboxed replay before it is kept
export async function runExperiment({
  mode = 'learn',
  episodes = 4,
  store = createMemoryStore(),
  cap = Infinity,
} = {}) {
  const results = [];
  let lastLesson = null;
  for (let ep = 1; ep <= episodes; ep++) {
    const plan = createPlan(store);
    const r = runEpisode(plan);
    const entry = {
      episode: ep,
      plan,
      ok: r.ok,
      failure: r.failure,
      lessonAdded: null,
      lessonRejected: null,
      promptSize: promptSize(store),
      lessonCount: store.lessons.length,
    };
    if (!r.ok && mode !== 'off') {
      const candidate = reflect(r.failure, mode === 'wrong' ? 'wrong' : 'correct');
      if (mode === 'guarded' && candidate && candidate.fix) {
        // The fix for "a wrong lesson is a learned bug": replay the episode
        // with the candidate applied, keep it only if the replay passes.
        const trial = createMemoryStore();
        trial.lessons = [...store.lessons, candidate];
        const replay = runEpisode(createPlan(trial));
        if (replay.ok) {
          const res = appendLesson(store, candidate, { cap });
          entry.lessonAdded = res.added ? candidate.text : null;
        } else {
          entry.lessonRejected = candidate.text;
        }
      } else {
        const res = appendLesson(store, candidate, { cap });
        entry.lessonAdded = res.added ? candidate.text : null;
      }
      lastLesson = candidate;
    }
    results.push(entry);
  }
  return { mode, episodes: results, store, lastLesson };
}
