const $ = id => document.getElementById(id);
let images = [], selectedId = null, busy = false, apiKey = '', db;
let config = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' };
try {
  const saved = JSON.parse(localStorage.getItem('toeic-config'));
  if (saved?.baseUrl && saved?.model) { config.baseUrl = saved.baseUrl; config.model = saved.model; }
  if (saved?.apiKey) apiKey = saved.apiKey;
} catch {}
$('baseUrl').value = config.baseUrl; $('model').value = config.model;
if (apiKey) $('apiKey').value = apiKey;

document.querySelectorAll('label[for="upload"]').forEach(label => {
  label.onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('upload').click(); }
  };
});

const desktop = !!window.chrome?.webview;
const pending = new Map();
if (desktop) {
  window.chrome.webview.addEventListener('message', event => {
    const reply = event.data;
    const request = pending.get(reply?.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timer);
    reply.ok ? request.resolve(reply.result) : request.reject(new Error(reply.error || 'Không gọi được AI.'));
  });
}

function desktopRequest(payload) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new DOMException('AI phản hồi chậm.', 'TimeoutError')); }, 50000);
    pending.set(id, { resolve, reject, timer });
    window.chrome.webview.postMessage({ id, type: 'ai', payload });
  });
}

const current = () => images.find(image => image.id === selectedId);
function status(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : ''; }

function store(record, remove = false) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('Kho ảnh chưa sẵn sàng. Hãy khởi động lại ứng dụng.'));
    const tx = db.transaction('images', 'readwrite');
    if (remove) tx.objectStore('images').delete(record.id); else tx.objectStore('images').put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(new Error('Không lưu được ảnh. Bộ nhớ lưu trữ có thể đã đầy.'));
    tx.onabort = tx.onerror;
  });
}

function controls() {
  const image = current();
  $('prepareButton').disabled = busy || !image || !!image.words;
  $('prepareButton').textContent = image?.words ? 'Đề đã sẵn sàng' : 'Tạo từ gợi ý';
  $('regenerateButton').disabled = busy || !image || !image.words;
  $('answer').disabled = busy || !image?.words;
  $('gradeButton').disabled = busy || !image?.words;
  $('gradeButton').textContent = busy ? 'Đang xử lý…' : 'Chấm câu trả lời ↗';
  $('upload').disabled = busy;
  const index = images.indexOf(image);
  $('previousQuestion').disabled = busy || index <= 0;
  $('nextQuestion').disabled = busy || index < 0 || index >= images.length - 1;
  const count = image?.history?.length || 0;
  $('historyButton').disabled = busy || !count;
  $('historyButton').textContent = `Lịch sử chấm (${count})`;
}

function renderResult(result) {
  $('result').replaceChildren(); $('result').hidden = !result;
  if (!result) return;

  // 1. Top Section: Điểm số & Đánh giá tổng quan
  const top = document.createElement('div'); top.className = 'result-top';
  const score = document.createElement('div'); score.className = 'score';
  score.textContent = result.score;
  const outOf = document.createElement('small'); outOf.textContent = ' / 3'; score.append(outOf);

  const desc = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = [
    '0/3 · Chưa đạt yêu cầu',
    '1/3 · Còn nhiều hạn chế',
    '2/3 · Đạt yêu cầu cơ bản (còn lỗi nhỏ)',
    '3/3 · Câu trả lời hoàn toàn chính xác'
  ][result.score] || `${result.score}/3 Điểm`;

  const summary = document.createElement('p');
  summary.textContent = result.summary;
  desc.append(title, summary);
  top.append(score, desc);
  $('result').append(top);

  // 2. Bảng tiêu chí chi tiết (Criteria Breakdown)
  if (result.criteria && typeof result.criteria === 'object') {
    const grid = document.createElement('div'); grid.className = 'criteria-grid';
    const items = [
      { key: 'image_relevance', label: '📷 Nội dung hình ảnh' },
      { key: 'cues_usage', label: '🔤 Từ gợi ý bắt buộc' },
      { key: 'grammar', label: '✍️ Ngữ pháp & Cấu trúc' }
    ];
    items.forEach(item => {
      const text = result.criteria[item.key];
      if (!text) return;
      const card = document.createElement('div'); card.className = 'criteria-card';
      const head = document.createElement('div'); head.className = 'criteria-title'; head.textContent = item.label;
      const body = document.createElement('p'); body.textContent = text;
      card.append(head, body);
      grid.append(card);
    });
    if (grid.children.length > 0) $('result').append(grid);
  }

  // 3. Chi tiết các lỗi cần khắc phục (Detailed Errors)
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    const errorSection = document.createElement('div'); errorSection.className = 'errors-section';
    const subhead = document.createElement('div'); subhead.className = 'section-subhead'; subhead.textContent = 'CÁC LỖI CẦN KHẮC PHỤC:';
    errorSection.append(subhead);

    const cards = document.createElement('div'); cards.className = 'errors-list-cards';
    result.errors.forEach(err => {
      const card = document.createElement('div'); card.className = 'error-card';
      if (typeof err === 'object' && err !== null) {
        if (err.issue) {
          const badge = document.createElement('span'); badge.className = 'error-badge'; badge.textContent = err.issue;
          card.append(badge);
        }
        if (err.detail) {
          const text = document.createElement('span'); text.className = 'error-text'; text.textContent = err.detail;
          card.append(text);
        }
      } else {
        const text = document.createElement('span'); text.className = 'error-text'; text.textContent = String(err);
        card.append(text);
      }
      cards.append(card);
    });
    errorSection.append(cards);
    $('result').append(errorSection);
  }

  // 4. Khung câu sửa & câu gợi ý nâng cao (Sentences Box)
  const sentencesBox = document.createElement('div'); sentencesBox.className = 'sentences-box';

  if (result.correction) {
    const correction = document.createElement('div'); correction.className = 'sentence-item correction-item';
    const label = document.createElement('small'); label.textContent = 'CÂU SỬA TỪ BÀI LÀM CỦA BẠN:';
    const sentence = document.createElement('p'); sentence.textContent = result.correction;
    correction.append(label, sentence);
    sentencesBox.append(correction);
  }

  if (result.better_sentence) {
    const better = document.createElement('div'); better.className = 'sentence-item better-item';
    const label = document.createElement('small'); label.textContent = 'CÂU GỢI Ý TỰ NHIÊN / NÂNG CAO:';
    const sentence = document.createElement('p'); sentence.textContent = result.better_sentence;
    better.append(label, sentence);
    const translation = document.createElement('p'); translation.className = 'sentence-translation';
    translation.textContent = result.better_sentence_vi || 'Chưa có bản dịch trong kết quả chấm cũ. Hãy chấm lại câu để tạo bản dịch.';
    better.append(translation);
    sentencesBox.append(better);
  }

  if (sentencesBox.children.length > 0) $('result').append(sentencesBox);
}

function moveQuestion(step) {
  if (busy || document.querySelector('dialog[open]')) return;
  const index = images.findIndex(image => image.id === selectedId);
  if (index < 0 || !images[index + step]) return;
  select(images[index + step].id);
}
$('previousQuestion').onclick = () => moveQuestion(-1);
$('nextQuestion').onclick = () => moveQuestion(1);
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); moveQuestion(event.key === 'ArrowLeft' ? -1 : 1);
  }
});
function renderHistoryEntry() {
  const image = current();
  const entry = image?.history?.find(item => item.id === $('historySelect').value);
  $('historyEmpty').hidden = !!entry;
  $('submittedAnswer').textContent = entry?.answer || '(Bỏ trống)';
  $('resultContext').textContent = entry ? `${image.name} · Từ gợi ý: ${entry.words.join(' / ')}` : '';
  renderResult(entry?.result);
}
function showHistory(entryId) {
  const image = current(); if (!image) return;
  $('historySelect').replaceChildren();
  [...(image.history || [])].reverse().forEach((entry, index) => {
    const option = document.createElement('option'); option.value = entry.id;
    const time = entry.gradedAt ? new Date(entry.gradedAt).toLocaleString('vi-VN') : 'Bài đã lưu trước cập nhật';
    option.textContent = `Lần ${image.history.length - index} · ${entry.result.score}/3 · ${time}`;
    $('historySelect').append(option);
  });
  if (entryId) $('historySelect').value = entryId;
  renderHistoryEntry();
  if (!$('resultDialog').open) $('resultDialog').showModal();
  $('resultDialog').querySelector('.result-scroll').scrollTop = 0;
}
$('historyButton').onclick = () => showHistory();
$('historySelect').onchange = renderHistoryEntry;
$('closeResult').onclick = () => $('resultDialog').close();

function renderLibrary() {
  $('imageCount').textContent = images.length; $('libraryEmpty').hidden = images.length > 0; $('imageList').replaceChildren();
  images.forEach((image, index) => {
    const row = document.createElement('div'); row.className = `image-item${image.id === selectedId ? ' selected' : ''}`;
    const button = document.createElement('button'); button.className = 'image-select'; button.disabled = busy;
    button.setAttribute('aria-label', `Chọn ảnh ${index + 1}: ${image.name}`);
    button.setAttribute('aria-pressed', String(image.id === selectedId));

    const thumb = document.createElement('img'); thumb.src = image.data; thumb.alt = '';
    const name = document.createElement('span'); name.className = 'image-name'; name.textContent = image.name; name.title = image.name;
    const sub = document.createElement('small'); sub.textContent = image.result ? `${image.result.score}/3 điểm` : image.words ? 'Sẵn sàng luyện tập' : 'Chưa tạo đề';
    name.append(sub); button.append(thumb, name); button.onclick = () => select(image.id);

    const remove = document.createElement('button'); remove.className = 'delete-button'; remove.textContent = '×'; remove.disabled = busy;
    remove.setAttribute('aria-label', `Xóa ảnh ${image.name}`);
    remove.onclick = async () => {
      if (!confirm(`Xóa ảnh “${image.name}” cùng đề và bài làm đã lưu?`)) return;
      try {
        await store(image, true);
        images = images.filter(item => item.id !== image.id);
        if (selectedId === image.id) select(images[0]?.id || null, false); else renderLibrary();
        status('Đã xóa ảnh.');
      } catch (error) { status(error.message, true); }
    };

    row.append(button, remove); $('imageList').append(row);
  });
}

function select(id, auto = true) {
  selectedId = id; const image = current();
  $('pictureEmpty').hidden = !!image; $('activeImage').hidden = !image;
  if (image) { $('activeImage').src = image.data; $('activeImage').alt = `Đề bài: ${image.name}`; } else $('activeImage').removeAttribute('src');
  $('questionLabel').textContent = image ? `Ảnh ${images.indexOf(image) + 1} / ${images.length}` : 'Chưa chọn ảnh';
  $('cues').replaceChildren();
  (image?.words || ['từ thứ nhất', 'từ thứ hai']).forEach(word => {
    const span = document.createElement('span'); span.className = `cue${image?.words ? '' : ' placeholder'}`; span.textContent = word;
    $('cues').append(span);
  });
  $('answer').value = image?.answer || '';
  $('charCount').textContent = `${$('answer').value.length} / 2000`;
  renderLibrary(); controls();
  if (auto && image && !image.words && apiKey && !busy) prepare();
}

async function ensureOptimizedImage(dataUrl) {
  if (!dataUrl || dataUrl.length < 180000) return dataUrl;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    if (Math.max(bitmap.width, bitmap.height) <= 800) { bitmap.close(); return dataUrl; }
    const scale = 800 / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL('image/jpeg', .78);
  } catch { return dataUrl; }
}

async function request(action, image) {
  if (!apiKey) { $('settings').showModal(); throw new Error('Nhập API key để tiếp tục.'); }
  const optimizedData = await ensureOptimizedImage(image.data);
  const payload = { ...config, apiKey, action, image: optimizedData, words: image.words, answer: image.answer || '' };
  if (desktop) return desktopRequest(payload);
  const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(50000), body: JSON.stringify(payload) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Không gọi được AI.'); return result;
}

let bgWorkerRunning = false;
async function processBackgroundQueue() {
  if (bgWorkerRunning || busy || !apiKey) return;
  const pendingImage = images.find(img => !img.words);
  if (!pendingImage) return;

  bgWorkerRunning = true;
  try {
    const optimized = await ensureOptimizedImage(pendingImage.data);
    const result = await (desktop
      ? desktopRequest({ ...config, apiKey, action: 'prepare', image: optimized })
      : fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...config, apiKey, action: 'prepare', image: optimized })
        }).then(r => r.json()));

    if (result?.words?.length === 2) {
      pendingImage.words = result.words;
      await store(pendingImage);
      if (selectedId === pendingImage.id) {
        select(pendingImage.id, false);
      } else {
        renderLibrary();
      }
    }
  } catch {
  } finally {
    bgWorkerRunning = false;
    if (!busy) setTimeout(processBackgroundQueue, 600);
  }
}

async function prepare() {
  const image = current(); if (!image || image.words || busy) return;
  busy = true; controls(); renderLibrary(); status('AI đang quan sát ảnh và chọn hai từ gợi ý…');
  try {
    const result = await request('prepare', image);
    image.words = result.words;
    await store(image);
    status('Đề đã sẵn sàng. Viết một câu bằng cả hai từ gợi ý.');
  }
  catch (error) { status(error.name === 'TimeoutError' ? 'AI phản hồi chậm. Hãy thử lại.' : error.message, true); }
  finally { busy = false; select(selectedId, false); setTimeout(processBackgroundQueue, 1000); }
}

async function regenerate() {
  const image = current(); if (!image || !image.words || busy) return;
  busy = true; controls(); renderLibrary(); status('AI đang chọn hai từ gợi ý khác…');
  try {
    const result = await request('prepare', image);
    image.words = result.words;
    image.answer = '';
    image.result = null;
    await store(image);
    status('Đã đổi sang 2 từ gợi ý mới.');
  }
  catch (error) { status(error.name === 'TimeoutError' ? 'AI phản hồi chậm. Hãy thử lại.' : error.message, true); }
  finally { busy = false; select(selectedId, false); }
}

$('prepareButton').onclick = prepare;
$('regenerateButton').onclick = regenerate;

$('answerForm').onsubmit = async event => {
  event.preventDefault(); const image = current(); if (busy || !image?.words) return;
  image.answer = $('answer').value; busy = true; controls(); renderLibrary(); status('AI đang đối chiếu ảnh và chấm câu trả lời…');
  try {
    const result = await request('grade', image);
    const entry = { id: crypto.randomUUID(), gradedAt: new Date().toISOString(), answer: image.answer, words: [...image.words], result };
    const updated = { ...image, result, history: [...(image.history || []), entry] };
    await store(updated);
    Object.assign(image, updated);
    status('Đã chấm và lưu vào lịch sử của ảnh.');
    showHistory(entry.id);
  }
  catch (error) { status(error.name === 'TimeoutError' ? 'AI phản hồi chậm. Câu trả lời vẫn được giữ lại.' : error.message, true); }
  finally {
    busy = false; select(selectedId, false);
    setTimeout(processBackgroundQueue, 1000);
  }
};

$('answer').oninput = () => {
  const image = current(); if (!image) return;
  image.answer = $('answer').value; image.result = null; renderResult(null);
  $('charCount').textContent = `${image.answer.length} / 2000`;
  store(image).catch(error => status(error.message, true));
};

$('answer').onkeydown = event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.repeat) {
    event.preventDefault();
    $('answerForm').requestSubmit();
  }
};

$('settingsButton').onclick = () => $('settings').showModal();
$('closeSettings').onclick = () => $('settings').close();

$('settingsForm').onsubmit = event => {
  event.preventDefault();
  try {
    const url = new URL($('baseUrl').value.trim());
    const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash) throw new Error('Base URL phải dùng HTTPS hoặc HTTP trên localhost, không chứa tài khoản, query hoặc fragment.');
    if (!$('apiKey').value.trim() || !$('model').value.trim()) throw new Error('Nhập API key và tên model.');
    config = { baseUrl: url.href.replace(/\/$/, ''), model: $('model').value.trim() }; apiKey = $('apiKey').value.trim();
    localStorage.setItem('toeic-config', JSON.stringify({ ...config, apiKey }));
    $('settings').close();
    status('Đã lưu kết nối AI.');
    if (current() && !current().words && !busy) prepare();
    setTimeout(processBackgroundQueue, 100);
  } catch (error) { status(error.message, true); alert(error.message); }
};

async function compress(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: chỉ hỗ trợ JPG, PNG, WebP.`);
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name}: vượt quá 15 MB.`);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', .78);
}

$('upload').onchange = async event => {
  const files = [...event.target.files]; if (!files.length || busy) return;
  busy = true; controls(); renderLibrary(); let added = 0; const errors = [];
  for (const file of files) {
    try {
      const data = await compress(file);
      const image = { id: crypto.randomUUID(), name: file.name, data, answer: '', createdAt: Date.now() };
      await store(image); images.push(image); added++;
      if (!selectedId) selectedId = image.id;
    }
    catch (error) { errors.push(error.message || `${file.name}: không đọc được ảnh.`); }
  }
  busy = false; event.target.value = ''; select(selectedId, false);
  status(`Đã thêm ${added} ảnh.${errors.length ? ' ' + errors.join(' ') : apiKey ? '' : ' Cấu hình AI để tạo từ gợi ý.'}`, !!errors.length);
  if (added && apiKey && !current()?.words) prepare();
  setTimeout(processBackgroundQueue, 100);
};

if (desktop) { document.documentElement.classList.add('desktop'); }

try {
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('sentence-lab', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  images = await new Promise((resolve, reject) => {
    const request = db.transaction('images').objectStore('images').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error);
  });
  for (const image of images) {
    if (!Array.isArray(image.history)) {
      const history = image.result ? [{ id: crypto.randomUUID(), gradedAt: null, answer: image.answer || '', words: [...(image.words || [])], result: image.result }] : [];
      await store({ ...image, history });
      image.history = history;
    }
  }
  select(images[0]?.id || null, false);
  setTimeout(processBackgroundQueue, 500);
} catch {
  status('Không mở được kho ảnh. Hãy khởi động lại ứng dụng.', true);
  $('upload').disabled = true;
}
