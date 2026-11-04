// Edge smoke test for Gemini Model Auto-Switch driven over CDP.
// Usage: node test/edge-smoke.mjs [--ext=<dir>] [--lang=vi|en] [--width=<px>] [--fresh] [--sidebar] [--keep-open]
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
let extDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
let lang = 'vi';
let width = null;
let fresh = false;
let sidebar = false;
let keepOpen = false;

for (const arg of args) {
  if (arg.startsWith('--ext=')) extDir = resolve(arg.slice(6));
  else if (arg.startsWith('--lang=')) lang = arg.slice(7);
  else if (arg.startsWith('--width=')) width = parseInt(arg.slice(8), 10);
  else if (arg === '--fresh') fresh = true;
  else if (arg === '--sidebar') sidebar = true;
  else if (arg === '--keep-open') keepOpen = true;
}

const EDGE_BIN = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const profileDir = join(tmpdir(), `gms-edge-${lang}`);

if (fresh) rmSync(profileDir, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWebSocketDebuggerUrl(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        const json = await res.json();
        if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timeout connecting to Edge CDP on port ${PORT}`);
}

let nextId = 1;
const pending = new Map();
const contextsBySession = new Map();
const contextWaiters = new Set();
let extensionId = null;
let ws = null;

function send(method, params = {}, sessionId = undefined) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return reject(new Error('WebSocket is not open'));
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  });
}

function isContentContext(ctx) {
  return ctx?.auxData?.type === 'isolated' && ctx.name === 'Gemini Model Auto-Switch';
}

function waitForContext(sessionId, predicate, timeoutMs = 20000) {
  const map = contextsBySession.get(sessionId);
  if (map) {
    for (const ctx of map.values()) if (predicate(ctx)) return Promise.resolve(ctx);
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      sessionId,
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        contextWaiters.delete(waiter);
        reject(new Error(`Timeout waiting for context after ${timeoutMs}ms`));
      }, timeoutMs),
    };
    contextWaiters.add(waiter);
  });
}

async function contentContext(sessionId, timeoutMs = 20000, excludeId = null) {
  const ctx = await waitForContext(
    sessionId,
    (c) => isContentContext(c) && (excludeId === null || c.id !== excludeId),
    timeoutMs,
  );
  if (!extensionId && ctx.origin) {
    try {
      extensionId = new URL(ctx.origin).host;
    } catch {
      extensionId = ctx.origin.replace(/^chrome-extension:\/\//, '').replace(/\/.*$/, '');
    }
  }
  return ctx.id;
}

async function evalIn(sessionId, contextId, expression) {
  const params = { expression, awaitPromise: true, returnByValue: true };
  if (contextId !== undefined && contextId !== null) params.contextId = contextId;
  const res = await send('Runtime.evaluate', params, sessionId);
  if (res.exceptionDetails) {
    const desc = res.exceptionDetails.exception?.description ||
      res.exceptionDetails.text ||
      JSON.stringify(res.exceptionDetails);
    throw new Error(desc);
  }
  return res.result?.value;
}

async function openExtensionPage(path) {
  if (!extensionId) throw new Error('Extension ID not discovered yet');
  const url = `chrome-extension://${extensionId}/${path}`;
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  const ctx = await waitForContext(sessionId, (c) => c.auxData?.isDefault === true, 10000);
  return { sessionId, contextId: ctx.id, targetId };
}

async function checkAutoSelect(sessionId, model) {
  if (!model?.id) throw new Error('no model id');
  const ctxId = await contentContext(sessionId);
  await evalIn(sessionId, ctxId, `chrome.storage.local.set(${JSON.stringify({
    enabled: true, modeId: model.id, target: model.label || '', levelIndex: -1,
  })})`);
  await sleep(5000);
  const t = await evalIn(sessionId, ctxId, `(async () => {
    await chrome.storage.local.set({ applied: '', seen: null });
    return Date.now();
  })()`);
  contextsBySession.get(sessionId)?.delete(ctxId);
  await send('Page.reload', {}, sessionId);
  const newCtxId = await contentContext(sessionId, 20000, ctxId);
  const deadline = Date.now() + 20000;
  let seen = null;
  while (Date.now() < deadline) {
    seen = await evalIn(sessionId, newCtxId, "chrome.storage.local.get('seen').then(r => r.seen)");
    if (seen && seen.reason === 'ok' && seen.at > t) return;
    await sleep(500);
  }
  throw new Error(JSON.stringify(seen));
}

// Gemini renders its model button some time after the content script starts, as the extension's
// own run waits for it; a popup command only comes once the page is up, so wait the same way.
function listOptionsWhenReady(sessionId, contextId) {
  return evalIn(sessionId, contextId, 'waitFor(findModelPicker, 20000, 250).then(() => listOptions())');
}

let allPassed = true;

async function runCheck(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message || err}`);
    allPassed = false;
    return false;
  }
}

const proc = spawn(EDGE_BIN, [
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  `--lang=${lang}`,
  '--window-size=1400,900',
  `--remote-debugging-port=${PORT}`,
  `--load-extension=${extDir}`,
  'about:blank',
], { stdio: 'ignore' });

async function cleanup() {
  if (keepOpen) return;
  try { await send('Browser.close'); } catch {}
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) return;
    await sleep(200);
  }
  if (proc.exitCode === null) {
    try { proc.kill(); } catch {}
  }
}

process.on('SIGINT', async () => { await cleanup(); process.exit(1); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(1); });

async function main() {
  try {
    const wsUrl = await getWebSocketDebuggerUrl(15000);
    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      const sess = msg.sessionId;
      if (msg.method === 'Runtime.executionContextCreated') {
        const ctx = msg.params?.context;
        if (sess && ctx) {
          if (!contextsBySession.has(sess)) contextsBySession.set(sess, new Map());
          contextsBySession.get(sess).set(ctx.id, ctx);
          for (const waiter of contextWaiters) {
            if (waiter.sessionId === sess && waiter.predicate(ctx)) {
              clearTimeout(waiter.timer);
              contextWaiters.delete(waiter);
              waiter.resolve(ctx);
            }
          }
        }
      } else if (msg.method === 'Runtime.executionContextDestroyed') {
        if (sess && msg.params?.executionContextId) contextsBySession.get(sess)?.delete(msg.params.executionContextId);
      } else if (msg.method === 'Runtime.executionContextsCleared') {
        if (sess) contextsBySession.get(sess)?.clear();
      }
    };

    if (sidebar) {
      console.log('Trong cửa sổ Edge vừa mở: bật sidebar, thêm gemini.google.com làm app, mở nó.');
      let sidebarSessionId = null;
      let sidebarCtxId = null;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const { targetInfos } = await send('Target.getTargets');
        const target = targetInfos?.find((t) => t.url && t.url.startsWith('https://gemini.google.com'));
        if (target) {
          const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
          sidebarSessionId = sessionId;
          await send('Runtime.enable', {}, sessionId);
          await send('Page.enable', {}, sessionId);
          break;
        }
        await sleep(1000);
      }

      const sidebarInjectedPassed = await runCheck('sidebar-injected', async () => {
        if (!sidebarSessionId) throw new Error('No gemini.google.com target found within 180s');
        const rem = Math.max(5000, deadline - Date.now());
        sidebarCtxId = await contentContext(sidebarSessionId, Math.min(rem, 20000));
      });

      let storageCmdPassed = false;
      if (sidebarInjectedPassed) {
        storageCmdPassed = await runCheck('storage-cmd', async () => {
          const { sessionId: popSessionId, contextId: popCtxId } = await openExtensionPage('popup.html');
          const start = Date.now();
          let text = '';
          while (Date.now() - start < 45000) {
            text = (await evalIn(popSessionId, popCtxId, "document.getElementById('status')?.textContent || ''")).trim();
            if (text && text !== 'Đang lấy danh sách từ Gemini…') break;
            await sleep(500);
          }
          if (!text || text === 'Đang lấy danh sách từ Gemini…') throw new Error('Timeout waiting for status');
          if (text.startsWith('Không kết nối được')) throw new Error(text);
        });
      }

      if (sidebarInjectedPassed && storageCmdPassed) {
        await runCheck('auto-select', async () => {
          const opts = await listOptionsWhenReady(sidebarSessionId, sidebarCtxId);
          if (!opts?.ok) throw new Error(opts?.lastError || 'listOptions failed');
          const model = opts.models?.find((m) => m.id);
          if (!model) throw new Error('no model id');
          await checkAutoSelect(sidebarSessionId, model);
        });
      }
    } else {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Runtime.enable', {}, sessionId);
      await send('Page.enable', {}, sessionId);
      if (width) {
        await send('Emulation.setDeviceMetricsOverride', {
          width, height: 900, deviceScaleFactor: 0, mobile: false,
        }, sessionId);
      }
      await send('Page.navigate', { url: 'https://gemini.google.com/app' }, sessionId);

      let tabCtxId = null;
      await runCheck('injected', async () => {
        tabCtxId = await contentContext(sessionId, 20000);
      });

      let pinnedModel = null;
      await runCheck('list-options', async () => {
        if (!tabCtxId) tabCtxId = await contentContext(sessionId, 5000);
        const res = await listOptionsWhenReady(sessionId, tabCtxId);
        if (!res?.ok) throw new Error(res?.lastError || 'listOptions returned ok=false');
        pinnedModel = res.models?.find((m) => m.id);
        if (!pinnedModel) throw new Error('no model with non-empty id');
      });

      await runCheck('auto-select', async () => {
        if (!pinnedModel?.id) throw new Error('no model id');
        await checkAutoSelect(sessionId, pinnedModel);
      });

      await runCheck('message-status', async () => {
        const { sessionId: popSessionId, contextId: popCtxId } = await openExtensionPage('popup.html');
        const res = await evalIn(popSessionId, popCtxId, `chrome.tabs.query({ url: 'https://gemini.google.com/*' })
          .then(([t]) => {
            if (!t) throw new Error('No Gemini tab found');
            return chrome.tabs.sendMessage(t.id, { type: 'status' });
          })`);
        if (typeof res?.enabled !== 'boolean') {
          throw new Error(`expected object with boolean enabled, got ${JSON.stringify(res)}`);
        }
      });

      await runCheck('icons', async () => {
        const { sessionId: popSessionId, contextId: popCtxId } = await openExtensionPage('popup.html');
        const manifest = await evalIn(popSessionId, popCtxId, 'chrome.runtime.getManifest()');
        const iconPaths = [
          ...Object.values(manifest.icons || {}),
          ...(typeof manifest.action?.default_icon === 'string'
            ? [manifest.action.default_icon]
            : Object.values(manifest.action?.default_icon || {})),
        ];
        if (iconPaths.length === 0) throw new Error('No icons found in manifest');
        for (const p of iconPaths) {
          if (!p.endsWith('.png')) throw new Error(`icon path does not end with .png: ${p}`);
        }
        for (const p of iconPaths) {
          const res = await evalIn(popSessionId, popCtxId, `(async () => {
            const r = await fetch(chrome.runtime.getURL(${JSON.stringify(p)}));
            return { ok: r.ok, ct: r.headers.get('content-type') };
          })()`);
          if (!res.ok || !res.ct?.includes('image/png')) {
            throw new Error(`fetch(${p}) returned ok=${res.ok}, content-type=${res.ct}`);
          }
        }
      });
    }
  } catch (err) {
    console.error('Fatal harness error:', err);
    allPassed = false;
  } finally {
    await cleanup();
    process.exit(allPassed ? 0 : 1);
  }
}

main();