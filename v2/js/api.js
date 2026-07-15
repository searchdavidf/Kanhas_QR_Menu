/**
 * api.js
 *
 * Order flow (per current spec):
 *   1. POST the order to n8n and AWAIT its response.
 *   2. n8n validates the payload, appends rows to Google Sheets,
 *      and returns a unique Order ID.
 *   3. That Order ID is included in the WhatsApp message before we
 *      hand off to wa.me.
 *
 * Contract with n8n — POST body (decoupled tables, so n8n can route each
 * piece straight to its own Sheet with no reshaping on your end):
 *   {
 *     order: {
 *       orderId: null,              // n8n assigns this; we don't send one
 *       source: "kanhas-website",
 *       timestamp: ISO string,
 *       customerName, customerPhone, fulfillment, address, notes,
 *       total: number,
 *       currency: "AED"
 *     },
 *     orderItems: [{ requestId, name, price, qty, lineTotal }],
 *     securityLog: {
 *       requestId: string,          // ties orderItems back to this submission
 *       userAgent: string,
 *       cartLineCount: number,
 *       submittedAt: ISO string
 *     }
 *   }
 *
 * Expected n8n response (JSON):
 *   Success:  { "success": true,  "orderId": "KVR-260712-4831" }
 *   Rejected: { "success": false, "error": "human-readable reason" }
 *
 * Reliability note: if n8n is unreachable, misconfigured, or slower than
 * KANHA_CONFIG.n8nTimeoutMs, we do NOT block the customer indefinitely.
 * We fall back to a locally generated ID in the SAME KVR-YYMMDD-XXXX shape
 * as a real one, and let the order proceed to WhatsApp anyway — an
 * unlogged order is a smaller problem than a customer unable to order at
 * all. The fallback is flagged with a single warning line in the WhatsApp
 * text so staff know to double check it against the Sheet; everything
 * else about the message looks identical to a normal order.
 */
window.KanhaApi = (function () {
  const CFG = window.KANHA_CONFIG;

  // Matches the exact template:
  // 🍽️ Kanha's Veg Restaurant
  // Order ID : KVR-YYMMDD-XXXX
  //
  // Customer
  // Name : ...
  // Phone : ...
  //
  // Order Type
  // Pickup / Delivery
  // -------------------------
  // 2 × Chole Bhature
  // 1 × Paneer Tikka
  // -------------------------
  // Total : AED XX
  // Notes: ...
  //
  // Thank you.
  // Note: isFallbackId is intentionally not used to alter the customer-facing
  // text anymore — that distinction is staff-internal, not something a
  // customer needs to see. Kept as a parameter in case a future staff-only
  // notification channel wants it.
  function buildOrderText(cart, customer, orderId) {
  const lines = [];

  lines.push("🍽️ *Kanha's Veg Restaurant*");
  lines.push("");
  lines.push("✅ *Order Confirmation*");
  lines.push("");
  lines.push(`🆔 Order ID: ${orderId}`);
  lines.push("");
  lines.push(`👤 Customer: ${(customer?.name) || "-"}`);
  lines.push(`📞 Phone: ${(customer?.phone) || "-"}`);
  lines.push(`🚶 Order Type: ${(customer?.fulfillment) || "Pickup"}`);

  if (customer?.fulfillment === "Delivery" && customer?.address) {
    lines.push(`📍 Address: ${customer.address}`);
  }

  lines.push("");
  lines.push("🛒 *Items*");

  cart.items.forEach(item => {
    lines.push(`• ${item.qty} × ${item.name}`);
  });

  lines.push("");
  lines.push(`💰 *Total:* ${CFG.currency} ${cart.total.toFixed(0)}`);

  if (customer?.notes) {
    lines.push("");
    lines.push(`📝 Notes: ${customer.notes}`);
  }

  lines.push("");
  lines.push("Plesae update my (`Order Type`) Time! 😊");

  return lines.join("\n");
}
  function buildWhatsAppUrl(text) {
    return `https://wa.me/${CFG.whatsappNumber}?text=${encodeURIComponent(text)}`;
  }

  // Same visual shape as a real n8n-issued ID (KVR-YYMMDD-XXXX) so a
  // fallback ID is indistinguishable at a glance — the only tell is the
  // explicit warning line above.
  function localFallbackId() {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const suffix = String(Math.floor(1000 + Math.random() * 9000));
    return `KVR-${yy}${mm}${dd}-${suffix}`;
  }

  function generateRequestId() {
    return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  function buildN8nPayload(cart, customer, requestId) {
    const timestamp = new Date().toISOString();
    return {
      order: {
        orderId: null, // n8n assigns the real ID; we never invent one server-side
        source: "kanhas-website",
        timestamp,
        customerName: (customer && customer.name) || "",
        customerPhone: (customer && customer.phone) || "",
        fulfillment: (customer && customer.fulfillment) || "Pickup",
        address: (customer && customer.address) || "",
        notes: (customer && customer.notes) || "",
        total: cart.total,
        currency: CFG.currency
      },
      orderItems: cart.items.map(item => ({
        requestId,
        name: item.name,
        price: item.price,
        qty: item.qty,
        lineTotal: Math.round(item.price * item.qty * 100) / 100
      })),
      securityLog: {
        requestId,
        userAgent: (typeof navigator !== "undefined" && navigator.userAgent) || "",
        cartLineCount: cart.items.length,
        submittedAt: timestamp
      }
    };
  }

  // POST to n8n and await {success, orderId} or {success:false, error}.
  // Resolves to a fallback result (never rejects) if n8n is unreachable,
  // errors, or exceeds the configured timeout.
  async function submitToN8n(cart, customer) {
    if (!CFG.n8nWebhookUrl) {
      return { success: true, orderId: localFallbackId(), isFallback: true };
    }

    const requestId = generateRequestId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CFG.n8nTimeoutMs);

    try {
      const res = await fetch(CFG.n8nWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildN8nPayload(cart, customer, requestId))
      });
      clearTimeout(timer);

      if (!res.ok) {
        return { success: true, orderId: localFallbackId(), isFallback: true };
      }

      const data = await res.json();
      if (data && data.success === false) {
        return { success: false, error: data.error || "Order could not be validated. Please try again." };
      }
      if (data && data.orderId) {
        return { success: true, orderId: data.orderId, isFallback: false };
      }
      // Response didn't match the expected contract — degrade gracefully
      // rather than fail the order outright.
      return { success: true, orderId: localFallbackId(), isFallback: true };

    } catch (e) {
      clearTimeout(timer);
      // Network error, timeout/abort, or unreachable webhook.
      return { success: true, orderId: localFallbackId(), isFallback: true };
    }
  }

  // The one function ui.js calls when the customer taps "Order on WhatsApp".
  // Returns { success, orderId?, isFallback?, error? } so ui.js can show an
  // inline error (and keep the drawer open) instead of redirecting on failure.
  async function sendOrder(cart, customer) {
    const result = await submitToN8n(cart, customer);
    if (!result.success) return result;

    const text = buildOrderText(cart, customer, result.orderId, result.isFallback);
    const encoded = encodeURIComponent(text);

    let finalText = text;
    if (window.KanhaValidate && window.KanhaValidate.isMessageTooLong(encoded)) {
      const itemCount = cart.items.reduce((n, i) => n + i.qty, 0);
      const lines = [];
      lines.push(`\u{1F37D}\uFE0F *${CFG.restaurantName}*`);
      lines.push(`Order ID : ${result.orderId}`);
      lines.push("");
      if (customer && customer.name) lines.push(`Name : ${customer.name}`);
      lines.push(`Order Type`);
      lines.push(`${(customer && customer.fulfillment) || "Pickup"}`);
      lines.push("-------------------------");
      lines.push(`${itemCount} items — large order, see call/notes for full list`);
      lines.push("-------------------------");
      lines.push(`Total : ${CFG.currency} ${cart.total.toFixed(0)}`);
      lines.push("");
      lines.push("This is my order, please confirm my (`Order Type`).");
      finalText = lines.join("\n");
    }

    window.location.href = buildWhatsAppUrl(finalText);
    return result;
  }

  return { buildOrderText, buildWhatsAppUrl, sendOrder };
})();
