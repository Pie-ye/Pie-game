import { mountStylesheet } from '../util.js';
import { mountIcons as mountIconNodes } from '../icons.js';

const abortedResult = () => ({
  response: { ok: false, status: 0, aborted: true },
  payload: {},
});

export function createBridge(gameId) {
  let root = null;
  let sdk = null;
  let controller = null;
  let releaseStyles = null;
  let bodyAddon = null;
  let generation = 0;
  const rootListeners = [];
  const documentListeners = [];
  const cleanupHandlers = [];
  const state = { user: null, casino: null };

  function onRoot(type, handler, options) {
    rootListeners.push({ type, handler, options });
  }

  function onDocument(type, handler, options) {
    documentListeners.push({ type, handler, options });
  }

  function onUnmount(handler) {
    cleanupHandlers.push(handler);
  }

  function $(selector) {
    if (root) {
      const found = root.querySelector(selector);
      if (found) return found;
    }
    if (bodyAddon) {
      if (bodyAddon.matches(selector)) return bodyAddon;
      return bodyAddon.querySelector(selector);
    }
    return null;
  }

  function $$(selector) {
    const found = root ? Array.from(root.querySelectorAll(selector)) : [];
    if (bodyAddon) {
      if (bodyAddon.matches(selector)) found.push(bodyAddon);
      found.push(...bodyAddon.querySelectorAll(selector));
    }
    return found;
  }

  function currentCasinoUserId() {
    return state.user && state.user.id;
  }

  function ensureCasinoState() {
    if (!state.casino) {
      state.casino = {
        userId: currentCasinoUserId(),
        tab: gameId,
        balance: Number(sdk && sdk.getBalance()) || 0,
        slots: { config: null, spinning: false, last: null, bet: 5 },
      };
    }
    return state.casino;
  }

  function mountIcons() {
    if (root) mountIconNodes(root);
    if (bodyAddon) mountIconNodes(bodyAddon);
  }

  function toast(message) {
    if (sdk) sdk.toast(message);
  }

  function casinoRoundId() {
    return sdk ? sdk.roundId() : '';
  }

  function refreshCasinoHistory() {
    if (sdk) sdk.refreshHistory();
  }

  function setCasinoBalance(value) {
    const balance = Number(value) || 0;
    if (state.casino) state.casino.balance = balance;
    if (sdk) sdk.setBalance(balance);
    const output = $('.pg-balance-value');
    if (output) output.textContent = balance.toLocaleString('zh-TW');
  }

  function isAbortedResponse(response) {
    return Boolean(response && response.aborted);
  }

  async function api(path, options = {}) {
    const activeSdk = sdk;
    const activeGeneration = generation;
    if (!activeSdk || !controller) return abortedResult();

    const next = { ...options, signal: controller.signal };
    if (typeof next.body === 'string') {
      try {
        next.body = JSON.parse(next.body);
      } catch (_) {
        // Preserve non-JSON request bodies.
      }
    }

    let result;
    try {
      result = await activeSdk.api(path, next);
    } catch (_) {
      result = {
        response: { ok: false, status: 0 },
        payload: { error: '連線失敗，請檢查網路後重試' },
      };
    }

    if (activeGeneration !== generation || activeSdk !== sdk) return abortedResult();
    return result;
  }

  async function refreshBalance() {
    const { response, payload } = await api('/api/casino/slots/config');
    if (!isAbortedResponse(response) && response.ok && payload && payload.balance != null) {
      setCasinoBalance(payload.balance);
    }
  }

  function setBodyAddon(element) {
    if (bodyAddon && bodyAddon !== element) bodyAddon.remove();
    bodyAddon = element;
  }

  function unmount() {
    const wasMounted = Boolean(root || sdk || controller || bodyAddon);
    generation += 1;
    if (wasMounted) {
      for (const handler of cleanupHandlers) handler();
    }
    if (controller) controller.abort();
    for (const item of documentListeners) {
      document.removeEventListener(item.type, item.handler, item.options);
    }
    if (root) {
      for (const item of rootListeners) {
        root.removeEventListener(item.type, item.handler, item.options);
      }
    }
    if (bodyAddon) bodyAddon.remove();
    bodyAddon = null;
    if (root) {
      for (const animation of root.getAnimations ? root.getAnimations({ subtree: true }) : []) {
        animation.cancel();
      }
      root.classList.remove(`pg-official-${gameId}`);
      root.replaceChildren();
    }
    if (releaseStyles) releaseStyles();
    releaseStyles = null;
    controller = null;
    sdk = null;
    root = null;
    state.user = null;
    state.casino = null;
  }

  function mount(target, officialSdk, options) {
    unmount();
    root = target;
    sdk = officialSdk;
    generation += 1;
    controller = new AbortController();
    state.user = officialSdk.user || null;
    state.casino = null;
    root.classList.add(`pg-official-${gameId}`);
    root.innerHTML = `<div class="official-balance">餘額 <strong class="pg-balance-value">${Number(officialSdk.getBalance()).toLocaleString('zh-TW')}</strong> 金幣</div><div id="${options.panelId}"${options.live ? ' aria-live="polite"' : ''}></div>`;
    releaseStyles = mountStylesheet(options.styleUrl);
    if (options.createBodyAddon) {
      const addon = options.createBodyAddon();
      setBodyAddon(addon);
      if (addon && !addon.isConnected) document.body.appendChild(addon);
      mountIcons();
    }
    for (const item of rootListeners) root.addEventListener(item.type, item.handler, item.options);
    for (const item of documentListeners) {
      document.addEventListener(item.type, item.handler, item.options);
    }
    options.render();
  }

  return {
    state,
    $,
    $$,
    api,
    casinoRoundId,
    currentCasinoUserId,
    ensureCasinoState,
    isAbortedResponse,
    mount,
    mountIcons,
    onDocument,
    onRoot,
    onUnmount,
    refreshBalance,
    refreshCasinoHistory,
    setCasinoBalance,
    toast,
    unmount,
  };
}
