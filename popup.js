const api = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = {
  enabled: true,
  target: '3.8 Flash',
  modeId: '',
  levelIndex: -1,
  debug: false,
  modelList: [],
  levelList: [],
};

const els = {
  enabled: document.getElementById('enabled'),
  model: document.getElementById('model'),
  level: document.getElementById('level'),
  fetch: document.getElementById('fetch'),
  target: document.getElementById('target'),
  debug: document.getElementById('debug'),
  save: document.getElementById('save'),
  now: document.getElementById('now'),
  status: document.getElementById('status'),
  candidates: document.getElementById('candidates'),
};

// What is saved, for when the lists are fetched again before the user has pressed Save.
let saved = { modeId: '', levelIndex: -1 };

function setStatus(message, tone = '') {
  els.status.textContent = message;
  els.status.className = `status ${tone}`.trim();
}

function renderCandidates(list = []) {
  els.candidates.replaceChildren(
    ...list.slice(0, 10).map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

// Models are identified by Gemini's own id and levels by their position in the menu, so neither
// depends on the interface language; the labels shown are just what Gemini displays.
function fillLists(models, levels, modeId, levelIndex) {
  els.model.replaceChildren(
    new Option('Không chọn (dùng so chữ ở mục nâng cao)', ''),
    ...models.map((model) => {
      const option = new Option(model.label + (model.selected ? ' (đang dùng)' : ''), model.id);
      option.dataset.label = model.label;
      return option;
    }),
  );
  els.model.value = modeId;
  if (els.model.selectedIndex < 0) els.model.value = '';

  els.level.replaceChildren(
    new Option('Giữ nguyên mức hiện tại', '-1'),
    ...levels.map((level) => new Option(`${level.index + 1}. ${level.label}${level.selected ? ' (đang dùng)' : ''}`, String(level.index))),
  );
  els.level.value = String(levelIndex);
  if (els.level.selectedIndex < 0) els.level.value = '-1';
}

function currentSettings() {
  const settings = { enabled: els.enabled.checked, debug: els.debug.checked };
  const picked = els.model.selectedOptions[0];
  if (els.model.value && picked) {
    return { ...settings, modeId: els.model.value, target: picked.dataset.label, levelIndex: Number(els.level.value) };
  }
  return { ...settings, modeId: '', levelIndex: -1, target: els.target.value.trim() || DEFAULTS.target };
}

async function saveSettings() {
  const settings = currentSettings();
  await api.storage.local.set(settings);
  saved = { modeId: settings.modeId, levelIndex: settings.levelIndex };
}

// For a Gemini frame that is not a tab (the AI chatbot sidebar): post the command to storage and
// wait for a Gemini frame to answer it there.
function viaStorage(message) {
  const id = `${Date.now()}-${Math.random()}`;
  return new Promise((resolve) => {
    const finish = (value) => {
      api.storage.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      resolve(value);
    };
    const onChanged = (changes, area) => {
      const reply = area === 'local' ? changes.cmdResult?.newValue : null;
      if (reply?.id === id) finish(reply.result);
    };
    const timer = setTimeout(() => finish(null), 40000);
    api.storage.onChanged.addListener(onChanged);
    api.storage.local.set({ cmd: { id, type: message.type } });
  });
}

async function sendToTab(message) {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) return await api.tabs.sendMessage(tab.id, message);
  } catch {
    // The active tab has no Gemini script; try the sidebar below.
  }
  return viaStorage(message);
}

const NO_TAB = 'Không kết nối được với Gemini (tab hoặc sidebar AI). Mở gemini.google.com rồi tải lại một lần.';

function renderStatus(data) {
  if (!data) {
    setStatus(NO_TAB, 'warn');
    renderCandidates();
    return;
  }
  const current = data.pickerText ? `Hiện tại: ${data.pickerText}` : 'Chưa đọc được model hiện tại';
  if (!data.enabled) {
    setStatus(`Tự động chuyển model đang TẮT: tick ô “Tự động chuyển model” rồi bấm Lưu (nút “Chọn ngay” vẫn dùng được).\n${current}`, 'warn');
  } else if (data.matched) {
    setStatus(`Đang đúng model đích.\n${current}`, 'ok');
  } else if (data.lastError) {
    setStatus(`${data.lastError}.\n${current}`, 'warn');
  } else {
    setStatus(`${current}\nĐích: ${data.target}${data.pinned ? ' (chọn theo ID)' : ''}`);
  }
  renderCandidates(data.candidates);
}

async function refresh() {
  const data = await sendToTab({ type: 'status' });
  renderStatus(data);
  if (!data) {
    // The active tab is not Gemini (or the popup is not in front of it): show the last note a
    // Gemini frame left, which also covers the AI chatbot sidebar.
    const { seen } = await api.storage.local.get({ seen: null });
    if (seen) {
      const ago = Math.round((Date.now() - seen.at) / 1000);
      setStatus(
        `${NO_TAB}\n\nLần cuối script chạy (${ago}s trước): ${seen.reason}\nRộng ${seen.width}px, nút model: ${seen.picker ?? 'không thấy'}${seen.error ? `\nLỗi: ${seen.error}` : ''}\n${seen.href}`,
        'warn',
      );
    }
  }
}

// Asks the Gemini tab for its model and thinking-level menus. Until something is saved, the
// pickers start on what Gemini is using now.
async function fetchLists() {
  setStatus('Đang lấy danh sách từ Gemini…');
  const result = await sendToTab({ type: 'list-options' });
  if (!result) {
    setStatus(NO_TAB, 'warn');
    return;
  }
  if (!result.ok) {
    setStatus(result.lastError ?? 'Không lấy được danh sách', 'warn');
    return;
  }
  const { models, levels, levelError } = result;
  await api.storage.local.set({ modelList: models, levelList: levels });
  const wanted = els.model.value || saved.modeId;
  const modeId = wanted || models.find((model) => model.selected)?.id || '';
  const levelIndex = wanted
    ? Number(els.model.value ? els.level.value : saved.levelIndex)
    : (levels.find((level) => level.selected)?.index ?? -1);
  fillLists(models, levels, modeId, levelIndex);
  const counts = `Đã lấy ${models.length} model, ${levels.length} mức tư duy.`;
  setStatus(levelError ? `${counts}\n${levelError}.` : `${counts}\nChọn rồi bấm Lưu.`, levelError ? 'warn' : 'ok');
}

async function load() {
  const stored = await api.storage.local.get(DEFAULTS);
  els.enabled.checked = stored.enabled !== false;
  els.target.value = stored.target || DEFAULTS.target;
  els.debug.checked = stored.debug === true;
  saved = { modeId: stored.modeId, levelIndex: stored.levelIndex };
  fillLists(stored.modelList, stored.levelList, stored.modeId, stored.levelIndex);
  if (stored.modelList.length === 0) await fetchLists();
  else await refresh();
}

els.fetch.addEventListener('click', fetchLists);

els.save.addEventListener('click', async () => {
  await saveSettings();
  setStatus('Đã lưu cài đặt.', 'ok');
  setTimeout(refresh, 500);
});

els.now.addEventListener('click', async () => {
  await saveSettings();
  const result = await sendToTab({ type: 'select-now' });
  if (!result) {
    setStatus(NO_TAB, 'warn');
    return;
  }
  if (result.ok) {
    setStatus(`Xong: ${result.text ?? 'đã chọn model đích'}.`, 'ok');
    renderCandidates();
  } else {
    setStatus(result.lastError ?? `Thất bại: ${result.reason ?? 'không rõ lý do'}`, 'warn');
    renderCandidates(result.candidates ?? []);
  }
  setTimeout(refresh, 1200);
});

load();
