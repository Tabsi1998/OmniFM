import { validateCustomStationUrlWithDns } from "../custom-stations.js";

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

function isRedirectResponse(response) {
  return REDIRECT_STATUS_CODES.has(Number(response?.status || 0));
}

function resolveRedirectLocation(currentUrl, locationHeader) {
  const rawLocation = String(locationHeader || "").trim();
  if (!rawLocation) return null;
  try {
    return new URL(rawLocation, currentUrl).toString();
  } catch {
    return null;
  }
}

function normalizeFetchMethod(method) {
  return String(method || "GET").trim().toUpperCase() || "GET";
}

async function validateFetchUrl(rawUrl, validateUrl = validateCustomStationUrlWithDns) {
  const validation = await validateUrl(rawUrl);
  if (!validation?.ok) {
    throw new Error(validation?.error || "URL wurde blockiert.");
  }
  return validation.url || validation.config?.url || String(rawUrl || "").trim();
}

async function fetchWithValidatedRedirects(rawUrl, fetchOptions = {}, {
  fetchImpl = globalThis.fetch,
  maxRedirects = 5,
  validateUrl = validateCustomStationUrlWithDns,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch ist in dieser Runtime nicht verfuegbar.");
  }

  const method = normalizeFetchMethod(fetchOptions.method);
  let currentUrl = await validateFetchUrl(rawUrl, validateUrl);
  let redirects = 0;

  while (true) {
    const response = await fetchImpl(currentUrl, {
      ...fetchOptions,
      method,
      redirect: "manual",
    });

    if (!isRedirectResponse(response)) {
      return { response, finalUrl: currentUrl, redirects };
    }

    if (method !== "GET" && method !== "HEAD") {
      throw new Error("Redirects fuer diese HTTP-Methode sind nicht erlaubt.");
    }

    if (redirects >= maxRedirects) {
      throw new Error("Zu viele Redirects.");
    }

    const nextUrl = resolveRedirectLocation(currentUrl, response.headers?.get?.("location"));
    if (!nextUrl) {
      throw new Error("Redirect ohne gueltige Location.");
    }

    currentUrl = await validateFetchUrl(nextUrl, validateUrl);
    redirects += 1;
  }
}

async function resolveValidatedRedirectUrl(rawUrl, options = {}) {
  const { finalUrl } = await fetchWithValidatedRedirects(rawUrl, {
    method: options.method || "HEAD",
    headers: options.headers,
    signal: options.signal,
  }, options);
  return finalUrl;
}

export {
  fetchWithValidatedRedirects,
  resolveRedirectLocation,
  resolveValidatedRedirectUrl,
};
