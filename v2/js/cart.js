/**
 * cart.js
 * Cart state engine. Pure state + persistence — no DOM code here.
 * ui.js listens to "kanha:cart-updated" to re-render whenever state changes.
 *
 * Cart shape: { [itemId]: { id, name, price, qty } }
 */
(function () {
  const CFG = window.KANHA_CONFIG;
  let state = {};

  // A cart entry is only trusted if every field is the right type and in a
  // sane range. Anything else (missing field, wrong type, negative/absurd
  // number, hand-edited localStorage) is dropped rather than trusted —
  // price in particular flows straight into the order total, so a bad
  // entry here is a real money issue, not just a display glitch.
  function isValidEntry(id, entry) {
    if (!entry || typeof entry !== "object") return false;
    if (entry.id !== id) return false;
    if (typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 120) return false;
    if (typeof entry.price !== "number" || !Number.isFinite(entry.price) || entry.price < 0 || entry.price > 5000) return false;
    if (typeof entry.qty !== "number" || !Number.isInteger(entry.qty) || entry.qty <= 0 || entry.qty > CFG.maxQtyPerItem) return false;
    return true;
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(CFG.storageKeys.cart);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("cart is not a plain object");
      }
      const clean = {};
      let droppedAny = false;
      Object.keys(parsed).forEach(id => {
        if (isValidEntry(id, parsed[id])) {
          clean[id] = parsed[id];
        } else {
          droppedAny = true;
        }
      });
      state = clean;
      // If anything was dropped, re-save immediately so the corrupted/tampered
      // entries don't keep coming back on every future load.
      if (droppedAny) saveToStorage();
    } catch (e) {
      console.warn("Kanha cart: saved cart failed integrity check, starting fresh.", e);
      state = {};
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(CFG.storageKeys.cart, JSON.stringify(state));
    } catch (e) {
      console.warn("Kanha cart: could not persist cart (localStorage unavailable).", e);
    }
  }

  function emitUpdate() {
    window.dispatchEvent(new CustomEvent("kanha:cart-updated", { detail: getSnapshot() }));
  }

  function getSnapshot() {
    const items = Object.values(state).sort((a, b) => a.name.localeCompare(b.name));
    const count = items.reduce((sum, i) => sum + i.qty, 0);
    const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);
    return { items, count, total: Math.round(total * 100) / 100 };
  }

  function addItem(id, name, price) {
    const isNewLine = !state[id];

    if (isNewLine && Object.keys(state).length >= CFG.maxCartLineItems) {
      window.dispatchEvent(new CustomEvent("kanha:cart-limit-reached", { detail: { reason: "lineItems" } }));
      return;
    }

    const currentQty = isNewLine ? 0 : state[id].qty;
    if (currentQty + 1 > CFG.maxQtyPerItem) {
      window.dispatchEvent(new CustomEvent("kanha:cart-limit-reached", { detail: { reason: "itemQty" } }));
      return;
    }

    const projectedTotal = getSnapshot().total + price;
    if (projectedTotal > CFG.maxCartValue) {
      window.dispatchEvent(new CustomEvent("kanha:cart-limit-reached", { detail: { reason: "cartValue" } }));
      return;
    }

    // All checks passed — safe to create the line (if new) and increment.
    if (isNewLine) state[id] = { id, name, price, qty: 0 };
    state[id].qty += 1;
    saveToStorage();
    emitUpdate();
  }

  function decrementItem(id) {
    if (!state[id]) return;
    state[id].qty -= 1;
    if (state[id].qty <= 0) delete state[id];
    saveToStorage();
    emitUpdate();
  }

  function setQty(id, qty) {
    if (!state[id]) return;
    qty = Math.max(0, Math.floor(qty) || 0);
    if (qty === 0) {
      delete state[id];
    } else {
      state[id].qty = qty;
    }
    saveToStorage();
    emitUpdate();
  }

  function removeItem(id) {
    delete state[id];
    saveToStorage();
    emitUpdate();
  }

  function clearCart() {
    state = {};
    saveToStorage();
    emitUpdate();
  }

  function getQty(id) {
    return state[id] ? state[id].qty : 0;
  }

  loadFromStorage();

  window.KanhaCart = {
    addItem,
    decrementItem,
    setQty,
    removeItem,
    clearCart,
    getQty,
    getSnapshot
  };

  // Let the rest of the app render the initial (possibly restored) state
  // once the DOM is ready.
  document.addEventListener("DOMContentLoaded", emitUpdate);
})();
