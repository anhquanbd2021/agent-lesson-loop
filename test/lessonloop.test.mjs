import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  BASE_PROMPT, NAIVE_PLAN,
  runEpisode, reflect, createPlan,
  createMemoryStore, appendLesson, renderLessons, promptSize,
  runExperiment,
} from '../public/lessonloop.mjs';

const scenario = JSON.parse(readFileSync(
  join(fileURLToPath(new URL('..', import.meta.url)), 'examples', 'scenario.json'),
  'utf8',
));

test('naive plan always fails on the unvalidated store', () => {
  const r = runEpisode(NAIVE_PLAN);
  assert.equal(r.ok, false);
  assert.equal(r.failure.step, 'store');
  assert.ok(r.failure.error.includes('unvalidated'));
});

test('scenario fixture matches the engine: same naive plan and rule', () => {
  assert.deepEqual(scenario.naivePlan, NAIVE_PLAN);
  const r = runEpisode(scenario.naivePlan);
  assert.ok(r.failure.error.includes('unvalidated'));
});

test('correct lesson rewrites the plan and the next run passes', async () => {
  const store = createMemoryStore();
  const res = await runExperiment({ mode: 'learn', episodes: 4, store });
  assert.equal(res.episodes[0].ok, false);
  assert.equal(res.episodes[1].ok, true);
  assert.equal(res.episodes[2].ok, true);
  assert.equal(res.episodes[3].ok, true);
  assert.deepEqual(res.episodes[1].plan, ['fetch', 'transform', 'validate', 'store']);
  assert.equal(store.lessons.length, 1);
  assert.equal(res.episodes[0].lessonAdded, store.lessons[0].text);
});

test('memory off fails identically forever — the lesson dies with the run', async () => {
  const res = await runExperiment({ mode: 'off', episodes: 4 });
  assert.ok(res.episodes.every((e) => !e.ok));
  assert.ok(res.episodes.every((e) => e.failure.error.includes('unvalidated')));
  assert.equal(res.store.lessons.length, 0);
  assert.equal(res.episodes[3].promptSize, BASE_PROMPT.length);
});

test('a wrong lesson is a learned bug: obeyed, useless, permanent', async () => {
  const res = await runExperiment({ mode: 'wrong', episodes: 4 });
  assert.ok(res.episodes.every((e) => !e.ok));
  // episode 1 fails untouched; from episode 2 the plan carries the
  // pointless `recheck` step — proof the wrong lesson is being obeyed
  assert.deepEqual(res.episodes[0].plan, ['fetch', 'transform', 'store']);
  assert.ok(res.episodes[1].plan.includes('recheck'));
  assert.ok(res.episodes.every((e) => e.failure.error.includes('unvalidated')));
  // the same wrong lesson is never stored twice (dedupe by signature)
  assert.equal(res.store.lessons.length, 1);
});

test('guarded mode replays a candidate lesson before keeping it', async () => {
  const store = createMemoryStore();
  const res = await runExperiment({ mode: 'guarded', episodes: 4, store });
  assert.equal(res.episodes[0].ok, false);
  assert.equal(res.episodes[0].lessonAdded, scenario.lessons.correct.text);
  assert.equal(res.episodes[1].ok, true);
});

test('guarded mode rejects a wrong candidate before it pollutes memory', async () => {
  const store = createMemoryStore();
  // force a wrong candidate through the guarded path
  const { reflect: R } = await import('../public/lessonloop.mjs');
  const failure = runEpisode(NAIVE_PLAN).failure;
  const candidate = R(failure, 'wrong');
  const trial = createMemoryStore();
  trial.lessons = [candidate];
  const replay = runEpisode(createPlan(trial));
  assert.equal(replay.ok, false); // the replay catches it
  assert.ok(replay.trace.includes('recheck'));
});

test('lessons are rendered into the prompt section and grow it', async () => {
  const store = createMemoryStore();
  const before = promptSize(store);
  appendLesson(store, scenario.lessons.correct);
  const after = promptSize(store);
  assert.ok(after > before);
  assert.ok(renderLessons(store).includes('## Lessons from previous runs'));
  assert.ok(renderLessons(store).includes('validate before store'));
});

test('append-only memory is unbounded; dedupe + cap keep it finite', () => {
  const store = createMemoryStore();
  for (let i = 1; i <= 12; i++) {
    appendLesson(store, {
      id: `L-${i}`,
      text: `lesson ${i}`,
      fix: { before: 'store', ensure: `noop-${i}` },
    }, { cap: 6 });
  }
  assert.equal(store.lessons.length, 6);
  assert.equal(store.lessons[0].id, 'L-compacted');
  assert.ok(store.lessons[0].text.includes('compacted'));
  // duplicates never accumulate regardless of cap
  const s2 = createMemoryStore();
  appendLesson(s2, scenario.lessons.correct);
  appendLesson(s2, scenario.lessons.correct);
  assert.equal(s2.lessons.length, 1);
});

test('reflect() produces fixes only for failures it can diagnose', () => {
  const l = reflect({ step: 'store', error: 'store: rejected unvalidated record' });
  assert.deepEqual(l.fix, { before: 'store', ensure: 'validate' });
  const bogus = reflect({ step: 'store', error: 'store: disk full' });
  assert.equal(bogus.fix, null); // undiagnosed failures don't write lessons
});
