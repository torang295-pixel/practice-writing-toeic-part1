const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

class Element {
  constructor() { this.children = []; this.value = ''; this.open = false; this.classList = { add() {} }; }
  append(...items) { this.children.push(...items); if (!this.value && items[0]?.tag === 'option') this.value = items[0].value; }
  replaceChildren() { this.children = []; this.value = ''; }
  setAttribute() {}
  removeAttribute() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  querySelector() { return new Element(); }
}
const result = { score: 3, summary: 'Đúng.', errors: [], correction: 'A man walks.' };
async function load(records) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const handlers = {};
  const db = { transaction() {
    const tx = { objectStore() { return {
      getAll() { const req = {}; queueMicrotask(() => { req.result = structuredClone(records); req.onsuccess(); }); return req; },
      put(record) { const copy = structuredClone(record); queueMicrotask(() => { const i = records.findIndex(r => r.id === copy.id); if (i < 0) records.push(copy); else records[i] = copy; tx.oncomplete(); }); }
    }; } }; return tx;
  } };
  let receive, calls = 0;
  const context = vm.createContext({
    document: { getElementById: get, querySelectorAll: () => [], createElement: tag => Object.assign(new Element(), { tag }), documentElement: new Element(),
      querySelector: () => [...elements.values()].find(e => e.open), addEventListener: (name, handler) => { handlers[name] = handler; } },
    indexedDB: { open() { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } },
    window: { chrome: { webview: { addEventListener: (_, handler) => { receive = handler; }, postMessage: message => { calls++; queueMicrotask(() => receive({ data: { id: message.id, ok: true, result } })); } } } },
    localStorage: { getItem: () => JSON.stringify({ baseUrl: 'http://localhost:20128/v1', model: 'test', apiKey: 'test' }), setItem() {} },
    crypto: { randomUUID }, setTimeout: () => 1, clearTimeout() {}, URL, DOMException, console
  });
  await vm.runInContext(`(async () => { ${readFileSync('app.js', 'utf8')} })()`, context);
  return { get, handlers, calls: () => calls };
}

test('arrows respect boundaries, input focus and open modal', async () => {
  const records = [{ id: 'a', name: 'a.jpg', data: 'data:', words: ['man', 'walk'], answer: 'Draft', result, createdAt: 1 }, { id: 'b', name: 'b.jpg', data: 'data:', words: ['desk', 'sit'], createdAt: 2 }];
  const ui = await load(records);
  assert.equal(ui.get('previousQuestion').disabled, true);
  assert.equal(ui.get('historyButton').textContent, 'Lịch sử chấm (1)');
  const arrow = editing => ({ key: 'ArrowRight', target: { closest: () => editing }, preventDefault() {} });
  ui.handlers.keydown(arrow(true));
  assert.equal(ui.get('questionLabel').textContent, 'Ảnh 1 / 2');
  ui.handlers.keydown(arrow(false));
  assert.equal(ui.get('questionLabel').textContent, 'Ảnh 2 / 2');
  assert.equal(ui.get('nextQuestion').disabled, true);
  ui.get('previousQuestion').onclick();
  assert.equal(ui.get('answer').value, 'Draft');
  ui.get('historyButton').onclick();
  assert.equal(ui.get('resultDialog').open, true);
  ui.handlers.keydown(arrow(false));
  assert.equal(ui.get('questionLabel').textContent, 'Ảnh 1 / 2');
  ui.get('closeResult').onclick();
  assert.equal(ui.get('resultDialog').open, false);
});

test('grade opens modal, persists snapshots and survives reload without duplicate migration', async () => {
  const records = [{ id: 'a', name: 'a.jpg', data: 'data:', words: ['man', 'walk'], answer: 'Old sentence', result, createdAt: 1 }];
  let ui = await load(records);
  ui.get('answer').value = 'A man walks.';
  await ui.get('answerForm').onsubmit({ preventDefault() {} });
  assert.equal(ui.calls(), 1);
  assert.equal(ui.get('resultDialog').open, true);
  assert.equal(records[0].history.length, 2);
  assert.equal(ui.get('submittedAnswer').textContent, 'A man walks.');
  assert.equal(records[0].history[0].answer, 'Old sentence');
  assert.deepEqual(records[0].history[1].words, ['man', 'walk']);
  ui.get('historySelect').value = records[0].history[0].id;
  ui.get('historySelect').onchange();
  assert.equal(ui.get('submittedAnswer').textContent, 'Old sentence');
  ui = await load(records);
  assert.equal(records[0].history.length, 2);
  assert.equal(ui.get('resultDialog').open, false);
  assert.equal(ui.get('historyButton').textContent, 'Lịch sử chấm (2)');
  let submitted = 0;
  ui.get('answerForm').requestSubmit = () => submitted++;
  ui.get('answer').onkeydown({ key: 'Enter', shiftKey: true });
  ui.get('answer').onkeydown({ key: 'Enter', isComposing: true });
  assert.equal(submitted, 0);
  ui.get('answer').onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(submitted, 1);
});

test('renderResult renders better_sentence and better_sentence_vi', async () => {
  const richResult = {
    score: 3,
    summary: 'Đúng.',
    errors: [],
    correction: 'A man walks.',
    better_sentence: 'A man is walking along the street.',
    better_sentence_vi: 'Một người đàn ông đang đi bộ dọc con phố.'
  };
  const records = [{ id: 'a', name: 'a.jpg', data: 'data:', words: ['man', 'walk'], answer: 'A man walks.', result: richResult, createdAt: 1 }];
  const ui = await load(records);
  ui.get('historyButton').onclick();
  const resultBox = ui.get('result');
  const sentencesBox = resultBox.children.find(c => c.className === 'sentences-box');
  assert.ok(sentencesBox);
  const betterItem = sentencesBox.children.find(c => c.className?.includes('better-item'));
  assert.ok(betterItem);
  const translationItem = betterItem.children.find(c => c.className === 'sentence-translation');
  assert.ok(translationItem);
  assert.equal(translationItem.textContent, 'Một người đàn ông đang đi bộ dọc con phố.');
});

test('old grading history explains missing translation', async () => {
  const oldResult = { score: 3, summary: 'Đúng.', errors: [], correction: 'A man walks.', better_sentence: 'A man is walking.' };
  const records = [{ id: 'a', name: 'a.jpg', data: 'data:', words: ['man', 'walk'], answer: 'A man walks.', result: oldResult, createdAt: 1 }];
  const ui = await load(records);
  ui.get('historyButton').onclick();
  const sentencesBox = ui.get('result').children.find(c => c.className === 'sentences-box');
  const betterItem = sentencesBox.children.find(c => c.className?.includes('better-item'));
  const translationItem = betterItem.children.find(c => c.className === 'sentence-translation');
  assert.equal(translationItem.textContent, 'Chưa có bản dịch trong kết quả chấm cũ. Hãy chấm lại câu để tạo bản dịch.');
});
