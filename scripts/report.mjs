// Side-by-side report: the same failing task under four memory policies.
// Usage: node scripts/report.mjs
import {
  BASE_PROMPT, createMemoryStore, createFileStore,
  renderLessons, promptSize, runExperiment, appendLesson,
} from '../public/lessonloop.mjs';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODES = ['off', 'learn', 'wrong', 'guarded'];
const EPISODES = 4;

console.log('Lesson Loop — one failing task, four memory policies');
console.log('='.repeat(72));
console.log(`base prompt: ${BASE_PROMPT.length} bytes`);
console.log(`naive plan:  fetch -> transform -> store   (skips validate; always fails)`);
console.log('');

for (const mode of MODES) {
  const store = createMemoryStore();
  const res = await runExperiment({ mode, episodes: EPISODES, store });
  console.log(`--- mode: ${mode} ${'-'.repeat(60 - mode.length)}`);
  for (const e of res.episodes) {
    const result = e.ok ? 'PASS' : `FAIL (${e.failure.error})`;
    const wb = e.lessonAdded ? '+lesson' : e.lessonRejected ? 'rejected' : '      ';
    console.log(
      `  ep${e.episode}  ${e.plan.join(' -> ').padEnd(42)} ${result.padEnd(46)} ${wb}`,
    );
  }
  console.log(
    `  final: ${store.lessons.length} lesson(s), prompt ${promptSize(store)} bytes`,
  );
  console.log('');
}

// persistence proof: write to a real file, "restart" (fresh store), reload
const dir = mkdtempSync(join(tmpdir(), 'lessonloop-'));
const path = join(dir, 'lessons.json');
const fs = { readFile: async (p) => readFileSync(p, 'utf8'), writeFile: async (p, s) => writeFileSync(p, s) };
const s1 = await createFileStore(path, fs);
appendLesson(s1, {
  id: 'L1',
  text: 'store rejected an unvalidated record — always run validate before store',
  fix: { before: 'store', ensure: 'validate' },
});
await s1.flush();
const s2 = await createFileStore(path, fs); // simulated restart
console.log('--- persistence ---------------------------------------------------');
console.log(`  wrote ${s1.lessons.length} lesson(s), reloaded ${s2.lessons.length} after "restart"`);
console.log(`  next-run prompt section:\n${renderLessons(s2).split('\n').map((l) => '    ' + l).join('\n')}`);
rmSync(dir, { recursive: true, force: true });

console.log('');
console.log('Takeaway: "self-improving" is a file write and a re-read. Guard what');
console.log('gets written, or the agent learns its bugs.');
