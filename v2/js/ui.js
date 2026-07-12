/**
 * ui.js
 * All DOM injection, rendering, and micro-interactions for the ordering engine.
 * cart.js owns state; this file only reacts to "kanha:cart-updated" and
 * translates taps into cart.js calls. No alert()/confirm() anywhere.
 */
(function () {
  const CFG = window.KANHA_CONFIG;
  const Cart = window.KanhaCart;
  const Validate = window.KanhaValidate;
  const Api = window.KanhaApi;

  let currentStep = 1;
  let drawerEl, backdropEl, toastEl, footerCartBtn, footerDefault;

  function slugify(str) {
    return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  function money(n) {
    return `${CFG.currency} ${Number(n).toFixed(0)}`;
  }

  /* ---------------- Item row enhancement ---------------- */

  function enhanceMenuRows() {
    const sections = document.querySelectorAll("section.category");
    sections.forEach(section => {
      const sectionId = section.id || slugify(section.querySelector(".cat-title")?.textContent || "item");
      const rows = section.querySelectorAll(".item-row");
      rows.forEach(row => {
        const priceEl = row.querySelector(".item-price");
        const nameEl = row.querySelector(".item-name");
        if (!priceEl || !nameEl) return;

        const nameClone = nameEl.cloneNode(true);
        const descEl = nameClone.querySelector(".item-desc");
        if (descEl) descEl.remove();
        const name = nameClone.textContent.trim();
        const price = parseFloat(priceEl.textContent.trim()) || 0;
        const id = `${sectionId}__${slugify(name)}`;

        row.setAttribute("data-cart-id", id);
        row.setAttribute("data-cart-name", name);
        row.setAttribute("data-cart-price", price);

        const cta = document.createElement("div");
        cta.className = "item-cta";
        priceEl.parentNode.insertBefore(cta, priceEl);
        cta.appendChild(priceEl);

        const widget = document.createElement("div");
        widget.className = "cart-widget";
        widget.innerHTML = `
          <button class="add-btn" type="button" aria-label="Add ${name}">+ Add</button>
          <div class="stepper" hidden>
            <button class="qty-btn minus" type="button" aria-label="Decrease quantity">&minus;</button>
            <span class="qty-num">0</span>
            <button class="qty-btn plus" type="button" aria-label="Increase quantity">+</button>
          </div>
        `;
        cta.appendChild(widget);

        widget.querySelector(".add-btn").addEventListener("click", () => {
          Cart.addItem(id, name, price);
          showToast(`Added ${name}`);
        });
        widget.querySelector(".minus").addEventListener("click", () => Cart.decrementItem(id));
        widget.querySelector(".plus").addEventListener("click", () => Cart.addItem(id, name, price));
      });
    });
  }

  function syncMenuRowWidgets() {
    document.querySelectorAll(".item-row[data-cart-id]").forEach(row => {
      const id = row.getAttribute("data-cart-id");
      const qty = Cart.getQty(id);
      const addBtn = row.querySelector(".add-btn");
      const stepper = row.querySelector(".stepper");
      if (!addBtn || !stepper) return;
      if (qty > 0) {
        addBtn.hidden = true;
        stepper.hidden = false;
        stepper.querySelector(".qty-num").textContent = qty;
      } else {
        addBtn.hidden = false;
        stepper.hidden = true;
      }
    });
  }

  /* ---------------- Sticky footer ---------------- */

  function buildFooterCartBar() {
    const bar = document.querySelector(".action-bar");
    if (!bar) return;
    footerDefault = document.createElement("div");
    footerDefault.className = "footer-default";
    // Move existing buttons into this wrapper so we can toggle them as one unit
    while (bar.firstChild) footerDefault.appendChild(bar.firstChild);
    bar.appendChild(footerDefault);

    footerCartBtn = document.createElement("button");
    footerCartBtn.type = "button";
    footerCartBtn.className = "footer-cart-bar";
    footerCartBtn.innerHTML = `
      <span class="footer-cart-count">🛒 View Cart (<span class="fc-count">0</span>)</span>
      <span class="footer-cart-total">Total: <span class="fc-total">${CFG.currency} 0</span></span>
    `;
    footerCartBtn.addEventListener("click", () => openDrawer(1));
    bar.appendChild(footerCartBtn);
  }

  function syncFooter(snapshot) {
    if (!footerDefault || !footerCartBtn) return;
    const hasItems = snapshot.count > 0;
    footerDefault.style.display = hasItems ? "none" : "flex";
    footerCartBtn.style.display = hasItems ? "flex" : "none";
    footerCartBtn.querySelector(".fc-count").textContent = snapshot.count;
    footerCartBtn.querySelector(".fc-total").textContent = money(snapshot.total);
  }

  /* ---------------- Drawer (bottom sheet) ---------------- */

  function buildDrawer() {
    backdropEl = document.createElement("div");
    backdropEl.className = "kanha-backdrop";
    backdropEl.addEventListener("click", closeDrawer);

    drawerEl = document.createElement("div");
    drawerEl.className = "kanha-drawer";
    drawerEl.innerHTML = `
      <div class="drawer-handle"></div>
      <div class="drawer-header">
        <button class="drawer-back" type="button" aria-label="Back" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <span class="drawer-title">Your order</span>
        <button class="drawer-close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="drawer-body">
        <div class="drawer-step" data-step="1">
          <div class="drawer-cart-list"></div>
          <div class="drawer-subtotal-row">
            <span>Total</span>
            <span class="drawer-total-amt">${CFG.currency} 0</span>
          </div>
        </div>

        <div class="drawer-step" data-step="2" hidden>
          <label class="d-label">Your name
            <input type="text" class="d-input" id="kanhaName" placeholder="e.g. Rahul" maxlength="60">
          </label>
          <div class="d-fulfillment">
            <button type="button" class="d-pill active" data-value="Pickup">Pickup</button>
            <button type="button" class="d-pill" data-value="Delivery">Delivery</button>
          </div>
          <label class="d-label" id="kanhaAddressWrap" hidden>Delivery address
            <textarea class="d-input" id="kanhaAddress" rows="2" placeholder="Building, street, area"></textarea>
          </label>
          <label class="d-label">Phone <span class="d-optional">(optional)</span>
            <input type="tel" class="d-input" id="kanhaPhone" placeholder="05XXXXXXXX">
          </label>
          <label class="d-label">Notes <span class="d-optional">(optional)</span>
            <textarea class="d-input" id="kanhaNotes" rows="2" placeholder="Spice level, allergies, etc."></textarea>
          </label>
          <div class="d-error" id="kanhaFormError" hidden></div>
        </div>

        <div class="drawer-step" data-step="3" hidden>
          <div class="drawer-review"></div>
          <div class="d-error drawer-review-error" hidden></div>
        </div>
      </div>

      <div class="drawer-footer">
        <button type="button" class="drawer-primary-btn">Continue</button>
      </div>
    `;

    document.body.appendChild(backdropEl);
    document.body.appendChild(drawerEl);

    drawerEl.querySelector(".drawer-close").addEventListener("click", closeDrawer);
    drawerEl.querySelector(".drawer-back").addEventListener("click", () => goToStep(currentStep - 1));
    drawerEl.querySelector(".drawer-primary-btn").addEventListener("click", handlePrimaryAction);

    drawerEl.querySelectorAll(".d-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        drawerEl.querySelectorAll(".d-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        const addrWrap = drawerEl.querySelector("#kanhaAddressWrap");
        addrWrap.hidden = pill.dataset.value !== "Delivery";
      });
    });

    loadSavedCustomer();
  }

  function openDrawer(step) {
    backdropEl.classList.add("open");
    drawerEl.classList.add("open");
    document.body.style.overflow = "hidden";
    goToStep(step || 1);
  }

  function closeDrawer() {
    backdropEl.classList.remove("open");
    drawerEl.classList.remove("open");
    document.body.style.overflow = "";
  }

  function goToStep(step) {
    currentStep = Math.max(1, Math.min(3, step));
    drawerEl.querySelectorAll(".drawer-step").forEach(s => {
      s.hidden = Number(s.dataset.step) !== currentStep;
    });
    drawerEl.querySelector(".drawer-back").hidden = currentStep === 1;

    const titles = { 1: "Your order", 2: "Your details", 3: "Review & send" };
    const btnLabels = { 1: "Continue", 2: "Review Order", 3: "Order on WhatsApp" };
    drawerEl.querySelector(".drawer-title").textContent = titles[currentStep];
    drawerEl.querySelector(".drawer-primary-btn").textContent = btnLabels[currentStep];

    if (currentStep === 1) {
      renderCartList(Cart.getSnapshot());
    }
    if (currentStep === 3) {
      renderReview();
      applyCooldownToButton();
    }
  }

  function handlePrimaryAction() {
    if (currentStep === 1) {
      if (Cart.getSnapshot().count === 0) return;
      goToStep(2);
    } else if (currentStep === 2) {
      const name = Validate.sanitizeText(document.getElementById("kanhaName").value, 60);
      const phoneRaw = document.getElementById("kanhaPhone").value.trim();
      const errorEl = document.getElementById("kanhaFormError");

      if (!name) {
        errorEl.textContent = "Please enter your name so we know who the order is for.";
        errorEl.hidden = false;
        return;
      }
      if (!Validate.isValidPhone(phoneRaw)) {
        errorEl.textContent = "That phone number doesn't look right — double check or leave it blank.";
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      goToStep(3);
    } else if (currentStep === 3) {
      submitOrder();
    }
  }

  function getCustomerFromForm() {
    const fulfillment = drawerEl.querySelector(".d-pill.active")?.dataset.value || "Pickup";
    return {
      name: Validate.sanitizeText(document.getElementById("kanhaName").value, 60),
      phone: document.getElementById("kanhaPhone").value.trim(),
      fulfillment,
      address: fulfillment === "Delivery" ? Validate.sanitizeText(document.getElementById("kanhaAddress").value, 200) : "",
      notes: Validate.sanitizeText(document.getElementById("kanhaNotes").value, 200)
    };
  }

  function renderReview() {
    const snapshot = Cart.getSnapshot();
    const customer = getCustomerFromForm();
    const reviewEl = drawerEl.querySelector(".drawer-review");

    reviewEl.innerHTML = `
      <div class="review-items">
        ${snapshot.items.map(i => `
          <div class="review-row">
            <span>${i.qty} &times; ${i.name}</span>
            <span>${money(i.qty * i.price)}</span>
          </div>`).join("")}
      </div>
      <div class="review-total-row"><span>Total</span><span>${money(snapshot.total)}</span></div>
      <div class="review-customer">
        <div><strong>${customer.name}</strong> &middot; ${customer.fulfillment}</div>
        ${customer.address ? `<div>${customer.address}</div>` : ""}
        ${customer.phone ? `<div>${customer.phone}</div>` : ""}
        ${customer.notes ? `<div class="review-notes">"${customer.notes}"</div>` : ""}
      </div>
    `;
  }

  function remainingCooldown() {
    try {
      const last = parseInt(localStorage.getItem(CFG.storageKeys.lastOrderAt) || "0", 10);
      const elapsed = (Date.now() - last) / 1000;
      return Math.max(0, Math.ceil(CFG.orderCooldownSeconds - elapsed));
    } catch (e) {
      return 0;
    }
  }

  let cooldownInterval;
  function applyCooldownToButton() {
    const btn = drawerEl.querySelector(".drawer-primary-btn");
    const remaining = remainingCooldown();
    clearInterval(cooldownInterval);

    if (remaining <= 0) {
      btn.disabled = false;
      btn.textContent = "Order on WhatsApp";
      return;
    }

    btn.disabled = true;
    const tick = () => {
      const r = remainingCooldown();
      if (r <= 0) {
        btn.disabled = false;
        btn.textContent = "Order on WhatsApp";
        clearInterval(cooldownInterval);
      } else {
        btn.textContent = `Please wait ${r}s…`;
      }
    };
    tick();
    cooldownInterval = setInterval(tick, 1000);
  }

  async function submitOrder() {
    if (remainingCooldown() > 0) return; // guarded by the disabled button anyway

    const snapshot = Cart.getSnapshot();
    const customer = getCustomerFromForm();
    saveCustomer(customer);

    const btn = drawerEl.querySelector(".drawer-primary-btn");
    const errorEl = drawerEl.querySelector(".drawer-review-error");
    btn.disabled = true;
    btn.textContent = "Preparing order…";
    if (errorEl) errorEl.hidden = true;

    const result = await Api.sendOrder(snapshot, customer);

    if (!result.success) {
      btn.disabled = false;
      btn.textContent = "Order on WhatsApp";
      if (errorEl) {
        errorEl.textContent = result.error || "Something went wrong. Please try again, or call us directly.";
        errorEl.hidden = false;
      }
      return; // keep drawer + cart intact so they can retry
    }

    // Success: window.location.href to wa.me has already been triggered inside
    // Api.sendOrder. Record the cooldown, clear the cart, and reset the UI —
    // by the time the customer returns to the tab, WhatsApp has the message
    // pre-filled. NOTE: this is not yet "sent" — the customer still has to
    // tap Send inside WhatsApp, so the toast must not claim it's done.
    try { localStorage.setItem(CFG.storageKeys.lastOrderAt, String(Date.now())); } catch (e) {}
    Cart.clearCart();
    showToast("Opening WhatsApp — tap Send to confirm");
    closeDrawer();
    goToStep(1);
  }

  function saveCustomer(customer) {
    try {
      localStorage.setItem(CFG.storageKeys.customer, JSON.stringify(customer));
    } catch (e) { /* non-critical */ }
  }

  function loadSavedCustomer() {
    try {
      const raw = localStorage.getItem(CFG.storageKeys.customer);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (c.name) document.getElementById("kanhaName").value = c.name;
      if (c.phone) document.getElementById("kanhaPhone").value = c.phone;
      if (c.fulfillment === "Delivery") {
        drawerEl.querySelectorAll(".d-pill").forEach(p => p.classList.toggle("active", p.dataset.value === "Delivery"));
        document.getElementById("kanhaAddressWrap").hidden = false;
        if (c.address) document.getElementById("kanhaAddress").value = c.address;
      }
    } catch (e) { /* non-critical */ }
  }

  function renderCartList(snapshot) {
    const listEl = drawerEl.querySelector(".drawer-cart-list");
    if (snapshot.items.length === 0) {
      listEl.innerHTML = `<div class="drawer-empty">Your cart is empty.</div>`;
      return;
    }
    listEl.innerHTML = snapshot.items.map(i => `
      <div class="drawer-cart-row" data-id="${i.id}">
        <span class="dc-name">${i.name}</span>
        <div class="dc-controls">
          <button class="qty-btn minus" type="button" aria-label="Decrease">&minus;</button>
          <span class="qty-num">${i.qty}</span>
          <button class="qty-btn plus" type="button" aria-label="Increase">+</button>
        </div>
        <span class="dc-price">${money(i.qty * i.price)}</span>
      </div>
    `).join("");

    listEl.querySelectorAll(".drawer-cart-row").forEach(row => {
      const id = row.dataset.id;
      const item = snapshot.items.find(i => i.id === id);
      row.querySelector(".minus").addEventListener("click", () => Cart.decrementItem(id));
      row.querySelector(".plus").addEventListener("click", () => Cart.addItem(id, item.name, item.price));
    });

    drawerEl.querySelector(".drawer-total-amt").textContent = money(snapshot.total);
  }

  /* ---------------- Toast ---------------- */

  function buildToast() {
    toastEl = document.createElement("div");
    toastEl.className = "kanha-toast";
    document.body.appendChild(toastEl);
  }

  let toastTimer;
  function showToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  /* ---------------- Wire it all up ---------------- */

  function onCartUpdated(e) {
    const snapshot = e.detail;
    syncMenuRowWidgets();
    syncFooter(snapshot);
    if (drawerEl && drawerEl.classList.contains("open") && currentStep === 1) {
      renderCartList(snapshot);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    enhanceMenuRows();
    // cart.js fires "kanha:cart-updated" on its own DOMContentLoaded listener,
    // which is registered (and therefore runs) before this one — so that first
    // sync attempt happens before the widgets above even exist and is a no-op.
    // Re-sync explicitly here so any cart restored from localStorage is
    // reflected immediately, instead of only correcting itself on next tap.
    syncMenuRowWidgets();
    buildFooterCartBar();
    buildDrawer();
    buildToast();
    syncFooter(Cart.getSnapshot());
  });

  window.addEventListener("kanha:cart-updated", onCartUpdated);
  window.addEventListener("kanha:cart-limit-reached", (e) => {
    const reason = e.detail && e.detail.reason;
    if (reason === "itemQty") {
      showToast(`Max ${CFG.maxQtyPerItem} of this item per order — call us for more.`);
    } else if (reason === "cartValue") {
      showToast(`This order is getting large — please call us to confirm it directly.`);
    } else {
      showToast(`You can add up to ${CFG.maxCartLineItems} different items per order.`);
    }
  });
})();
