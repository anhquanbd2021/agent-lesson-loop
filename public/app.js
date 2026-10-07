import {
  BASE_PROMPT, NAIVE_PLAN,
  createMemoryStore, appendLesson, renderLessons, promptSize,
  runExperiment,
} from '/lessonloop.mjs';

const $ = (id) => document.getElementById(id);
const tbody = $('episodes');
const promptEl = $('promptfile');
const statusEl = $('status');

function renderPromptFile(store) {
  const lessons = renderLessons(store);
  const body = BASE_PROMPT + (lessons ? '\n\n' + lessons : '');
  promptEl.textContent = body || '(empty prompt file)';
}

function row(e) {
  const tr = document.createElement('tr');
  const result = e.ok
    ? '<span class="ok">PASS</span>'
    : `<span class="fail">FAIL</span> — ${e.failure.error}`;
  let wb = '<span class="rej">—</span>';
  if (e.lessonAdded) wb = `<span class="lesson">+ lesson kept</span>`;
  if (e.lessonRejected) wb = `<span class="rej">lesson rejected by replay</span>`;
  tr.innerHTML = `<td>${e.episode}</td>
    <td class="plan">${e.plan.join(' → ')}</td>
    <td>${result}</td><td>${wb}</td><td>${e.promptSize}</td>`;
  return tr;
}

$('run').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  tbody.innerHTML = '';
  const store = createMemoryStore();
  renderPromptFile(store);
  statusEl.textContent = `mode=${mode} — running…`;
  const res = await runExperiment({ mode, episodes: 4, store });
  for (const e of res.episodes) tbody.appendChild(row(e));
  renderPromptFile(store);
  const last = res.episodes.at(-1);
  const verdict = last.ok
    ? `mode=${mode}: passing by episode ${res.episodes.findIndex((x) => x.ok) + 1}`
    : `mode=${mode}: still failing after 4 episodes`;
  statusEl.textContent = `${verdict} — ${store.lessons.length} lesson(s) in memory, prompt ${promptSize(store)} bytes.`;
});

$('stress').addEventListener('click', () => {
  const store = createMemoryStore();
  tbody.innerHTML = '';
  for (let i = 1; i <= 12; i++) {
    appendLesson(store, {
      id: `L-stress-${i}`,
      text: `lesson ${i}: prefer step ordering variant ${i} under load`,
      fix: { before: 'store', ensure: `noop-${i}` },
    }, { cap: 6 });
  }
  renderPromptFile(store);
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>—</td><td class="plan">12 lessons appended, cap 6</td>
    <td><span class="fail">compaction</span> — ${store.lessons.length} entries kept, oldest folded into a summary line</td>
    <td class="lesson">dedupe + cap</td><td>${promptSize(store)}</td>`;
  tbody.appendChild(tr);
  statusEl.textContent = 'append-only memory is unbounded — the cap is the only thing between you and a bloated prompt.';
});

// initial paint: show the naive plan and an empty prompt file
tbody.innerHTML = '';
const blank = createMemoryStore();
renderPromptFile(blank);
statusEl.textContent = `naive plan: ${NAIVE_PLAN.join(' → ')} — pick a mode and run.`;
