/**
 * config.js
 * Central business configuration for the Kanha's ordering engine.
 * Edit values here — nothing else in the codebase should hardcode these.
 */
window.KANHA_CONFIG = {
  // WhatsApp number the order text is sent to, digits only (country code, no + or leading 00)
  whatsappNumber: "971505745808",

  // Restaurant display name, used in the pre-filled WhatsApp message header
  restaurantName: "Kanha's Veg Restaurant",

  currency: "AED",

  // OPTIONAL: paste your n8n Production Webhook URL here. Once set, every order
  // is POSTed here, awaited for a response (validation + Google Sheets row +
  // a generated Order ID) BEFORE WhatsApp opens, so the order ID can be
  // included in the WhatsApp message. If left empty, or if the request times
  // out, the site falls back to a local order ID and still lets the
  // customer complete their order — see api.js for the fallback contract.
  n8nWebhookUrl: "",

  // How long we wait for n8n before falling back to a local order ID.
  // Keep this short: iOS Safari can lose the "user tapped this" permission
  // to open WhatsApp if too much time passes between the tap and the
  // redirect, so a slow webhook should not be allowed to stall the order.
  n8nTimeoutMs: 6000,

  // Minimum seconds between two completed orders from the same browser,
  // to guard against accidental double-submits or deliberate spam.
  orderCooldownSeconds: 60,

  // Soft cap on number of distinct line items in one order, to keep the
  // WhatsApp deep-link URL a safe length on all devices/browsers.
  maxCartLineItems: 40,

  // Hard cap on quantity of a single dish in one order. Guards against
  // fat-finger taps and abuse (e.g. holding the + button).
  maxQtyPerItem: 20,

  // Hard cap on total order value (AED), as a last line of defense against
  // an abnormally large or manipulated cart before it reaches WhatsApp/n8n.
  maxCartValue: 2000,

  // localStorage keys — versioned so future structural changes don't collide
  // with a customer's old cached cart.
  storageKeys: {
    cart: "kanhas_cart_v1",
    customer: "kanhas_customer_v1",
    lastOrderAt: "kanhas_last_order_at_v1"
  }
};
