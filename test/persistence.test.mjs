import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFileStore, appendLesson, createPlan, runEpisode, renderLessons,
} from '../public/lessonloop.mjs';

const fs = {
  readFile: async (p) => readFileSync(p, 'utf8'),
  writeFile: async (p, s) => writeFileSync(p, s),
};

const LESSON = {
  id: 'L1',
  text: 'store rejected an unvalidated record — always run validate before store',
  fix: { before: 'store', ensure: 'validate' },
};

test('a lesson survives the process that wrote it (restart -> reload -> pass)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lessonloop-'));
  const path = join(dir, 'lessons.json');
  try {
    // "run 1" — process A fails and writes the lesson
    const s1 = await createFileStore(path, fs);
    assert.equal(s1.lessons.length, 0);
    appendLesson(s1, LESSON);
    await s1.flush();

    // "run 2" — process B is a brand-new store reading the same file
    const s2 = await createFileStore(path, fs);
    assert.equal(s2.lessons.length, 1);
    assert.ok(renderLessons(s2).includes('validate before store'));

    // the loaded lesson actually changes behaviour
    const plan = createPlan(s2);
    assert.deepEqual(plan, ['fetch', 'transform', 'validate', 'store']);
    assert.equal(runEpisode(plan).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing store file starts empty (first-ever run)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lessonloop-'));
  const s = await createFileStore(join(dir, 'nope.json'), fs);
  assert.equal(s.lessons.length, 0);
  assert.equal(runEpisode(createPlan(s)).ok, false);
  rmSync(dir, { recursive: true, force: true });
});

test('corrupt store file degrades to empty rather than crashing the run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lessonloop-'));
  const path = join(dir, 'lessons.json');
  writeFileSync(path, '{not json');
  try {
    const s = await createFileStore(path, fs);
    assert.equal(s.lessons.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
