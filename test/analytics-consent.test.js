import assert from "node:assert/strict";
import test from "node:test";

import {
  CONSENT_STORAGE_KEY,
  GA_MEASUREMENT_ID,
  GOOGLE_TAG_SCRIPT_ID,
  applyConsent,
  disableGoogleAnalytics,
  loadGoogleAnalytics,
  readStoredConsent,
  writeStoredConsent,
} from "../frontend/src/lib/analyticsConsent.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function createBrowserStub() {
  const scripts = new Map();
  const cookies = [];
  const document = {
    cookie: "",
    head: {
      appendChild(script) {
        scripts.set(script.id, script);
      },
    },
    createElement(tagName) {
      return {
        tagName,
        async: false,
        id: "",
        src: "",
        dataset: {},
        getAttribute(name) {
          if (name === "data-omnifm-static") return this.dataset.omnifmStatic === "true" ? "true" : null;
          return this[name] || null;
        },
        remove() {
          scripts.delete(this.id);
        },
      };
    },
    getElementById(id) {
      return scripts.get(id) || null;
    },
  };
  Object.defineProperty(document, "cookie", {
    get() {
      return cookies.join("; ");
    },
    set(value) {
      cookies.push(String(value));
    },
  });

  const window = {
    localStorage: createStorage(),
    location: { hostname: "omnifm.xyz" },
  };

  global.window = window;
  global.document = document;

  return {
    document,
    window,
    scripts,
    cleanup() {
      delete global.window;
      delete global.document;
    },
  };
}

test("analytics consent storage normalizes necessary and analytics categories", () => {
  const storage = createStorage();
  assert.equal(readStoredConsent(storage), null);

  const stored = writeStoredConsent({ analytics: true }, storage);
  assert.equal(stored.necessary, true);
  assert.equal(stored.analytics, true);
  assert.equal(typeof stored.updatedAt, "string");

  const loaded = readStoredConsent(storage);
  assert.equal(loaded.necessary, true);
  assert.equal(loaded.analytics, true);
  assert.equal(Boolean(storage.getItem(CONSENT_STORAGE_KEY)), true);
});

test("analytics is not loaded when consent is denied", () => {
  const browser = createBrowserStub();
  try {
    applyConsent({ analytics: false });
    assert.equal(browser.scripts.has(GOOGLE_TAG_SCRIPT_ID), false);
    assert.equal(browser.window[`ga-disable-${GA_MEASUREMENT_ID}`], true);
    assert.equal(typeof browser.window.gtag, "function");
    assert.equal(browser.window.dataLayer.length, 1);
    assert.equal(browser.window.dataLayer[0][0], "consent");
    assert.equal(browser.window.dataLayer[0][2].analytics_storage, "denied");
  } finally {
    browser.cleanup();
  }
});

test("analytics can load Google tag dynamically and withdrawal disables it", () => {
  const browser = createBrowserStub();
  try {
    assert.equal(browser.document.getElementById(GOOGLE_TAG_SCRIPT_ID), null);

    assert.equal(loadGoogleAnalytics(), true);
    const script = browser.document.getElementById(GOOGLE_TAG_SCRIPT_ID);
    assert.ok(script);
    assert.equal(script.src, "https://www.googletagmanager.com/gtag/js?id=G-J5X0ZZ5E3Z");
    assert.equal(browser.window[`ga-disable-${GA_MEASUREMENT_ID}`], false);
    assert.ok(browser.window.dataLayer.some((entry) => entry[0] === "config" && entry[1] === GA_MEASUREMENT_ID));

    disableGoogleAnalytics();
    assert.equal(browser.document.getElementById(GOOGLE_TAG_SCRIPT_ID), null);
    assert.equal(browser.window[`ga-disable-${GA_MEASUREMENT_ID}`], true);
    assert.ok(browser.document.cookie.includes("_ga=;"));
  } finally {
    browser.cleanup();
  }
});

test("withdrawal keeps the static Google tag available for Google setup checks", () => {
  const browser = createBrowserStub();
  try {
    const staticScript = browser.document.createElement("script");
    staticScript.id = GOOGLE_TAG_SCRIPT_ID;
    staticScript.async = true;
    staticScript.dataset.omnifmStatic = "true";
    staticScript.src = "https://www.googletagmanager.com/gtag/js?id=G-J5X0ZZ5E3Z";
    browser.document.head.appendChild(staticScript);

    disableGoogleAnalytics();
    assert.equal(browser.document.getElementById(GOOGLE_TAG_SCRIPT_ID), staticScript);
    assert.equal(browser.window[`ga-disable-${GA_MEASUREMENT_ID}`], true);
    assert.ok(browser.window.dataLayer.some((entry) => entry[0] === "consent" && entry[2].analytics_storage === "denied"));
  } finally {
    browser.cleanup();
  }
});
