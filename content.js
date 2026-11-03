const api = globalThis.browser ?? globalThis.chrome;

const DEFAULTS = {
  enabled: true,
  target: '3.8 Flash High',
  modeId: '',
  levelIndex: -1,
  debug: false,
};

const PICKER_SELECTORS = [
  '.input-area-switch',
  'button[aria-label*="chế độ" i]',
  'button[aria-label*="chọn chế độ" i]',
  '[data-test-id*="model" i]',
  '[data-test-id*="mode" i]',
  'button[aria-label*="model" i]',
  'button[aria-label*="modelo" i]',
  'button[aria-label*="modèle" i]',
  'button[aria-label*="modello" i]',
  'button[aria-label*="modell" i]',
  'button[aria-label*="mô hình" i]',
  'button[aria-label*="モデル"]',
  'button[aria-label*="模型"]',
  'button[aria-label*="모델"]',
];

const ITEM_SELECTOR =
  '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="radio"],[role="button"],mat-option,button,gem-menu-item';
const MODEL_HINT = /(flash|thinking|fast|nano|high|low|reasoning|extended|pro\b)/i;
const DIAG_HINT =
  /(flash|pro|thinking|fast|auto|nano|high|low|medium|standard|extended|deep|ultra|lite|plus|reasoning)/i;
const MAX_ATTEMPTS = 15;
const RETRY_MS = 1500;
const USER_QUIET_MS = 3000;
const OVERLAY_SELECTOR =
  '.cdk-overlay-pane,[role="menu"],[role="listbox"],mat-menu,.mat-mdc-menu-panel';

const state = {
  settings: { ...DEFAULTS },
  started: false,
  busy: false,
  satisfied: false,
  attempts: 0,
  retryTimer: 0,
  menuRoot: null,
  userTouchedAt: 0,
  pickerText: '',
  lastError: '',
  candidates: [],
};

function log(...args) {
  if (state.settings.debug) console.log('[gemini-model-switch]', ...args);
}

function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function textOf(el) {
  return String(el?.innerText ?? el?.textContent ?? '');
}

function pickerSignature(el) {
  return `${textOf(el)} ${el?.getAttribute('aria-label') ?? ''}`.trim();
}

function matchesTarget(text, target = state.settings.target) {
  const wanted = normalize(target);
  const got = normalize(text);
  if (!wanted || !got) return false;
  if (got === wanted || got.includes(wanted)) return true;
  return wanted.split(' ').filter(Boolean).every((token) => got.includes(token));
}

// The picker shows "Flash Cao": no version number, and the thinking level in the UI language.
// So it is on target when its model words equal the target's, ignoring version numbers and levels.
// The narrow layout's header button reads "Gemini Flash", so "gemini" is not part of the model.
const LEVEL_WORDS = new Set(['cao', 'thap', 'trung', 'binh', 'high', 'medium', 'low', 'standard', 'gemini']);

function modelWords(text) {
  return normalize(text)
    .split(' ')
    .filter((word) => word && !/^\d/.test(word) && !LEVEL_WORDS.has(word));
}

function pickerOnTarget(picker, target = state.settings.target) {
  const want = modelWords(target);
  const got = modelWords(textOf(picker));
  return want.length > 0 && want.length === got.length && want.every((word) => got.includes(word));
}

function onTarget(picker) {
  return matchesTarget(pickerSignature(picker)) || pickerOnTarget(picker);
}

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

function inOverlay(el) {
  return Boolean(el.closest(OVERLAY_SELECTOR));
}

function findModelPicker() {
  for (const selector of PICKER_SELECTORS) {
    const el = [...document.querySelectorAll(selector)].find(
      (node) => isVisible(node) && !inOverlay(node) && textOf(node).trim().length < 80,
    );
    if (el) return el;
  }
  const hinted = [...document.querySelectorAll('[role="button"],[aria-haspopup="menu"],button')].filter((el) => {
    if (!isVisible(el) || inOverlay(el)) return false;
    const text = textOf(el).trim();
    return text.length > 0 && text.length < 80 && MODEL_HINT.test(text);
  });
  return (
    hinted.find((el) => el.getAttribute('aria-haspopup') === 'menu' || el.hasAttribute('aria-expanded')) ??
    hinted[0] ??
    null
  );
}

function overlayRoot() {
  const panes = [...document.querySelectorAll(OVERLAY_SELECTOR)].filter(isVisible);
  return panes.find((el) => el.querySelector(ITEM_SELECTOR)) ?? null;
}

function menuItems() {
  const root = state.menuRoot && isVisible(state.menuRoot) ? state.menuRoot : overlayRoot();
  if (!root) return [];
  return [...root.querySelectorAll(ITEM_SELECTOR)].filter((el) => {
    if (!isVisible(el)) return false;
    const text = textOf(el).trim();
    return text.length > 0 && text.length <= 120;
  });
}

function clickableAncestor(el) {
  return (
    el.closest(
      'button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="radio"],mat-option,li,label',
    ) ?? el
  );
}

function matchingElement(elements, target = state.settings.target) {
  const wanted = normalize(target);
  const matches = [];
  const labels = new Set();
  for (const el of elements) {
    if (!el.isConnected || !isVisible(el)) continue;
    const text = textOf(el).trim();
    if (!text || text.length > 120) continue;
    const key = normalize(text);
    if (!key) continue;
    if (key.length <= 60 && labels.size < 40) labels.add(key);
    if (!matchesTarget(text, target)) continue;
    matches.push({ el, key, children: el.getElementsByTagName('*').length });
  }
  if (labels.size > 0) {
    const hinted = [...labels].filter((label) => DIAG_HINT.test(label));
    state.candidates = (hinted.length > 0 ? hinted : [...labels]).slice(0, 12);
  }
  if (matches.length === 0) return null;
  matches.sort(
    (a, b) =>
      Number(b.key === wanted) - Number(a.key === wanted) ||
      a.children - b.children ||
      a.key.length - b.key.length,
  );
  return clickableAncestor(matches[0].el);
}

function findItem() {
  return matchingElement(menuItems());
}

function findInAdded(roots) {
  const elements = [];
  for (const root of roots) {
    if (!root.isConnected) continue;
    elements.push(root);
    for (const child of root.querySelectorAll('*')) elements.push(child);
  }
  return matchingElement(elements);
}

function humanClick(el) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const rect = el.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mousedown', base));
  el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true }));
  el.dispatchEvent(new MouseEvent('mouseup', base));
  el.dispatchEvent(new MouseEvent('click', base));
  return Date.now();
}

function pressEscape() {
  const target = document.activeElement ?? document.body;
  for (const type of ['keydown', 'keyup']) {
    target.dispatchEvent(
      new KeyboardEvent(type, {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

function waitFor(fn, timeout = 3000, interval = 100) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      let value = null;
      try {
        value = fn();
      } catch {
        value = null;
      }
      if (value) return resolve(value);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(tick, interval);
    };
    tick();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startNodeWatcher() {
  const added = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) added.push(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return { added, stop: () => observer.disconnect() };
}

// Gemini's model menu: one gem-menu-item per model, carrying a language-independent data-mode-id,
// and a .selected class on its content for the model in use. Pinning by id avoids matching text.
function modeItems() {
  const root = state.menuRoot && isVisible(state.menuRoot) ? state.menuRoot : overlayRoot();
  return root ? [...root.querySelectorAll('gem-menu-item[data-mode-id]')] : [];
}

function pinnedMode() {
  return modeItems().find((item) => item.dataset.modeId === state.settings.modeId) ?? null;
}

function selectedMode() {
  return modeItems().find((item) => item.querySelector('.selected')) ?? null;
}

function modeLabel(item) {
  return textOf(item.querySelector('.label')).trim();
}

// The "thinking level" entry of that menu opens a submenu whose items carry no id, only an order
// (low, medium, high) and the same .selected class. So the level is pinned by its position.
// It may sit outside the element that holds the model items, so it is searched page-wide.
function levelTrigger() {
  return [...document.querySelectorAll('gem-menu-item[value="thinking_level"]')].find(isVisible) ?? null;
}

function hover(el) {
  for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, view: window }));
  }
}

function levelMenuOf(trigger) {
  const id = trigger.getAttribute('aria-controls');
  const menu = id ? document.getElementById(id) : null;
  return menu && isVisible(menu) ? menu : null;
}

// In a narrow viewport (a browser sidebar, say) Gemini lists the levels in the same pane as the
// models, as an accordion under the trigger, and the trigger has no aria-controls. Clicking it
// would collapse the list, so it is only clicked to expand it.
async function openInlineLevelItems(trigger) {
  const pane = trigger.closest(OVERLAY_SELECTOR) ?? state.menuRoot;
  const levels = () =>
    pane
      ? [...pane.querySelectorAll('gem-menu-item')].filter(
          (item) => item !== trigger && !item.dataset.modeId && !item.hasAttribute('value') && isVisible(item),
        )
      : [];
  if (trigger.getAttribute('aria-expanded') !== 'true') humanClick(trigger);
  return (await waitFor(() => (levels().length > 0 ? levels() : null), 1500, 100)) ?? [];
}

// The submenu opens on hover; clicking the entry is the fallback if hover alone does not open it.
async function openLevelItems(trigger) {
  if (!trigger.getAttribute('aria-controls')) return openInlineLevelItems(trigger);
  hover(trigger);
  let menu = await waitFor(() => levelMenuOf(trigger), 700, 100);
  if (!menu) {
    humanClick(trigger);
    menu = await waitFor(() => levelMenuOf(trigger), 1500, 100);
  }
  if (!menu) {
    const key = { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, bubbles: true, cancelable: true };
    trigger.dispatchEvent(new KeyboardEvent('keydown', key));
    menu = await waitFor(() => levelMenuOf(trigger), 1000, 100);
  }
  return menu ? [...menu.querySelectorAll('gem-menu-item')] : [];
}

// Sets the pinned thinking level. A model without a level entry is left alone.
async function applyLevel(picker, menuOpen) {
  const trigger = menuOpen ? levelTrigger() : await openMenuAndFind(picker, levelTrigger);
  if (!trigger) {
    log('no thinking level entry for this model');
    return { ok: true };
  }
  const want = (await openLevelItems(trigger))[state.settings.levelIndex];
  if (!want) return { ok: false, error: `Không thấy mức tư duy thứ ${state.settings.levelIndex + 1}` };
  if (want.querySelector('.selected')) return { ok: true };
  log('clicking level', state.settings.levelIndex + 1);
  humanClick(want.querySelector('.label') ?? want);
  const done = await waitFor(() => (isVisible(state.menuRoot) && !want.querySelector('.selected') ? null : true), 3000, 120);
  return done ? { ok: true } : { ok: false, error: 'Đã bấm mức tư duy nhưng chưa xác nhận được' };
}

async function openMenuAndFind(picker, find = findItem) {
  if (picker.getAttribute('aria-expanded') === 'true') {
    state.menuRoot = overlayRoot();
    return waitFor(find, 1500, 100);
  }

  const before = new Set(document.querySelectorAll(OVERLAY_SELECTOR));
  const watcher = startNodeWatcher();
  let scanned = 0;
  humanClick(picker);
  const deadline = Date.now() + 2500;
  try {
    while (Date.now() < deadline) {
      const pane = [...document.querySelectorAll(OVERLAY_SELECTOR)]
        .filter((el) => isVisible(el) && !before.has(el))
        .find((el) => el.querySelector(ITEM_SELECTOR));
      if (pane) state.menuRoot = pane;

      const item = state.menuRoot ? find() : null;
      if (item) return item;

      if (find === findItem) {
        const nodeItem = findInAdded(watcher.added.slice(scanned));
        scanned = watcher.added.length;
        if (nodeItem) return nodeItem;
      }

      await sleep(120);
    }
    return null;
  } finally {
    watcher.stop();
  }
}

// quiet.css hides the menus while this attribute is on <html>. It stays on a little past the end so
// that a menu still fading out is not seen either.
let quietTimer = 0;

function hideMenus() {
  clearTimeout(quietTimer);
  document.documentElement.setAttribute('data-gms-quiet', '');
}

function showMenusSoon() {
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => document.documentElement.removeAttribute('data-gms-quiet'), 800);
}

// What was applied last time, as the model id, the level and the picker's text. The picker shows
// no id, so seeing the same text again means nothing changed and the menu need not be opened.
function appliedKey(picker) {
  return `${state.settings.modeId}|${state.settings.levelIndex}|${normalize(textOf(picker))}`;
}

async function rememberApplied() {
  const picker = findModelPicker();
  if (!picker || !state.settings.modeId) return;
  state.settings.applied = appliedKey(picker);
  await api.storage.local.set({ applied: state.settings.applied });
}

// Closing the menu hands focus back to the picker, which shows its tooltip and focus ring. Let go
// of it once the menu has finished closing, so the page looks untouched.
function releaseFocus() {
  for (const delay of [150, 600]) {
    setTimeout(() => {
      const picker = findModelPicker();
      if (picker && document.activeElement === picker) picker.blur();
    }, delay);
  }
}

function closeMenu(picker) {
  pressEscape();
  if (picker?.isConnected && picker.getAttribute('aria-expanded') === 'true') humanClick(picker);
  releaseFocus();
}

// Only one thing may drive the menu at a time. A second request (a button in the popup while the
// automatic run is still going, say) waits its turn instead of failing. False if it never came.
async function takeTurn(timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (state.busy) {
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
  state.busy = true;
  return true;
}

// The turn is kept a moment after the work, so the next request does not start while the menu is
// still fading out (it would find the old, closing menu and miss the item).
function releaseTurn() {
  showMenusSoon();
  setTimeout(() => { state.busy = false; }, 600);
}

async function attemptSelection({ force = false } = {}) {
  if (!state.settings.enabled && !force) return { ok: false, reason: 'disabled' };
  if (!(await takeTurn())) return { ok: false, reason: 'busy' };
  // What ran while this waited may already have done the job.
  if (state.satisfied && !force) {
    state.busy = false;
    return { ok: true, already: true };
  }
  try {
    const picker = findModelPicker();
    if (!picker) {
      state.lastError = 'Không tìm thấy nút chọn model';
      log('picker not found');
      return { ok: false, reason: 'no-picker' };
    }
    state.pickerText = textOf(picker).trim();
    const pinned = Boolean(state.settings.modeId);
    // The picker has no model id, so a pinned model can only be checked in the open menu.
    if (!pinned && onTarget(picker)) {
      state.satisfied = true;
      state.lastError = '';
      log('already on target', state.pickerText);
      return { ok: true, already: true, text: state.pickerText };
    }
    if (pinned && !force && state.settings.applied === appliedKey(picker)) {
      state.satisfied = true;
      state.lastError = '';
      log('same as last time, menu left alone', state.pickerText);
      return { ok: true, already: true, text: state.pickerText };
    }
    if (!force && Date.now() - state.userTouchedAt < USER_QUIET_MS) {
      state.lastError = 'Bạn vừa tương tác với trang, thử lại sau';
      return { ok: false, reason: 'user-busy' };
    }
    hideMenus();
    const item = await openMenuAndFind(picker, pinned ? pinnedMode : findItem);
    if (!item) {
      closeMenu(picker);
      state.lastError = pinned
        ? 'Không thấy model đã chọn trong menu (bấm “Lấy danh sách từ Gemini” rồi chọn lại)'
        : `Không thấy mục khớp "${state.settings.target}"`;
      log('no matching item, candidates:', state.candidates);
      return { ok: false, reason: 'no-item', candidates: state.candidates };
    }
    const wantLevel = pinned && state.settings.levelIndex >= 0;
    if (pinned && item.querySelector('.selected')) {
      log('pinned model already selected', modeLabel(item));
      const level = wantLevel ? await applyLevel(picker, true) : { ok: true };
      closeMenu(picker);
      if (!level.ok) {
        state.lastError = level.error;
        log(level.error);
        return { ok: false, reason: 'no-level' };
      }
      state.satisfied = true;
      state.lastError = '';
      await sleep(250); // let the picker show any level just clicked
      await rememberApplied();
      return { ok: true, already: true, text: modeLabel(item) };
    }
    if (!pinned && (item.matches('.selected') || item.querySelector('.selected'))) {
      // Already the model in use, whatever the picker's label says; clicking it proves nothing.
      closeMenu(picker);
      state.satisfied = true;
      state.lastError = '';
      log('target already selected in the menu', textOf(item).trim());
      return { ok: true, already: true, text: textOf(item).trim() };
    }
    log('clicking', textOf(item).trim());
    const beforeSignature = pickerSignature(picker);
    humanClick(pinned ? (item.querySelector('.label') ?? item) : item);
    const confirmed = await waitFor(
      () => {
        // Picking a model closes the menu, so a pinned model counts as done once it has gone.
        if (pinned) return isVisible(state.menuRoot) ? null : findModelPicker();
        const again = findModelPicker();
        if (!again) return null;
        const signature = pickerSignature(again);
        if (onTarget(again)) return again;
        if (signature && signature !== beforeSignature) return again;
        return null;
      },
      3000,
      120,
    );
    if (confirmed && wantLevel) {
      const level = await applyLevel(picker, false);
      closeMenu(picker);
      if (!level.ok) {
        state.lastError = level.error;
        log(level.error);
        return { ok: false, reason: 'no-level' };
      }
    }
    if (confirmed) {
      releaseFocus(); // clicking a menu item closes the menu without going through closeMenu
      state.satisfied = true;
      state.lastError = '';
      await sleep(250);
      await rememberApplied();
      state.pickerText = textOf(findModelPicker() ?? confirmed).trim();
      log('confirmed', state.pickerText);
      return { ok: true, text: state.pickerText };
    }
    closeMenu(picker);
    state.lastError = 'Đã bấm nhưng chưa xác nhận được model';
    log('unconfirmed');
    return { ok: false, reason: 'unconfirmed' };
  } finally {
    releaseTurn();
  }
}

// Reads the models and thinking levels Gemini offers, for the popup's pickers. The levels listed
// are those of the model in use; they are identified by position.
async function listOptions() {
  if (!(await takeTurn())) return { ok: false, lastError: 'Gemini vẫn đang bận sau 30 giây, thử lại sau' };
  try {
    const picker = findModelPicker();
    if (!picker) return { ok: false, lastError: 'Không tìm thấy nút chọn model' };
    hideMenus();
    if (!(await openMenuAndFind(picker, () => modeItems()[0] ?? null))) {
      closeMenu(picker);
      return { ok: false, lastError: 'Không đọc được danh sách model từ menu' };
    }
    const models = modeItems().map((item) => ({
      id: item.dataset.modeId,
      label: modeLabel(item),
      selected: Boolean(item.querySelector('.selected')),
    }));
    const trigger = levelTrigger();
    const items = trigger ? await openLevelItems(trigger) : [];
    const levels = items.map((item, index) => ({
      index,
      label: textOf(item).split('\n')[0].trim(),
      selected: Boolean(item.querySelector('.selected')),
    }));
    closeMenu(picker);
    const levelError = !trigger
      ? 'Không thấy mục “Cấp độ tư duy” trong menu'
      : levels.length === 0
        ? 'Không mở được menu con “Cấp độ tư duy”'
        : '';
    return { ok: true, models, levels, levelError };
  } finally {
    releaseTurn();
  }
}

// Leaves a note the popup can read even when it cannot reach this frame (e.g. Firefox's AI
// chatbot sidebar, which is not the active tab): proof the script runs there and what it saw.
function reportSeen(reason) {
  const picker = findModelPicker();
  api.storage.local
    .set({
      seen: {
        at: Date.now(),
        reason,
        href: location.href.slice(0, 120),
        width: window.innerWidth,
        picker: picker ? pickerSignature(picker).slice(0, 120) : null,
        error: state.lastError,
      },
    })
    .catch(() => {});
}

function scheduleAuto(delay = 0) {
  clearTimeout(state.retryTimer);
  state.retryTimer = setTimeout(async () => {
    if (state.satisfied || !state.settings.enabled) return;
    const result = await attemptSelection();
    reportSeen(result.ok ? 'ok' : result.reason ?? 'failed');
    if (result.ok) return;
    if (result.reason === 'user-busy') {
      scheduleAuto(4000);
      return;
    }
    if (result.reason === 'busy' || result.reason === 'disabled') {
      scheduleAuto(RETRY_MS);
      return;
    }
    state.attempts += 1;
    if (['no-item', 'unconfirmed', 'no-level'].includes(result.reason) && state.attempts >= 3) return;
    if (state.attempts < MAX_ATTEMPTS) scheduleAuto(RETRY_MS);
  }, delay);
}

async function loadSettings() {
  try {
    // "applied" is bookkeeping, not a setting: it is read here but left out of DEFAULTS so that
    // writing it does not look like a settings change.
    const stored = await api.storage.local.get({ ...DEFAULTS, applied: '' });
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

function statusResponse() {
  const picker = findModelPicker();
  const pickerText = picker ? textOf(picker).trim() : state.pickerText;
  return {
    enabled: state.settings.enabled,
    target: state.settings.target,
    pinned: Boolean(state.settings.modeId),
    pickerText,
    matched: picker ? onTarget(picker) : matchesTarget(pickerText),
    satisfied: state.satisfied,
    lastError: state.lastError,
    candidates: state.candidates,
  };
}

async function init() {
  if (state.started) return;
  state.started = true;

  state.settings = await loadSettings();
  log('settings', state.settings);

  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    // Only real input counts; the clicks this script dispatches itself are not the user.
    window.addEventListener(type, (event) => { if (event.isTrusted) state.userTouchedAt = Date.now(); }, { capture: true, passive: true });
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS && state.settings[key] !== newValue) {
        state.settings[key] = newValue;
        changed = true;
      }
    }
    if (!changed) return;
    log('settings changed', state.settings);
    if (!state.settings.enabled) {
      clearTimeout(state.retryTimer);
      return;
    }
    state.satisfied = false;
    state.attempts = 0;
    scheduleAuto(0);
  });

  function handleCommand(type) {
    if (type === 'status') return Promise.resolve(statusResponse());
    if (type === 'list-options') return listOptions();
    if (type === 'select-now') {
      state.satisfied = false;
      state.attempts = 0;
      return attemptSelection({ force: true });
    }
    return undefined;
  }

  api.runtime.onMessage.addListener((message) => handleCommand(message?.type));

  // The popup cannot message a frame that is not a tab (Firefox's AI chatbot sidebar), so it can
  // also post a command to storage; every Gemini frame answers it there.
  api.storage.onChanged.addListener(async (changes, area) => {
    const cmd = area === 'local' ? changes.cmd?.newValue : null;
    if (!cmd) return;
    const result = (await handleCommand(cmd.type)) ?? null;
    await api.storage.local.set({ cmdResult: { id: cmd.id, result } });
  });

  reportSeen('started');
  // Once per page load: go as soon as the model button exists, then stay idle. Nothing polls or
  // watches afterwards; it only acts again on a popup command or when the settings change.
  waitFor(findModelPicker, 30000, 200).then((picker) => {
    if (picker) scheduleAuto(0);
  });
}

init();
