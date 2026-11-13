// OmniFM: owner console: can the owner's browser play a station directly?
// Split out of components/OwnerAdmin.js. A stream often needs a few seconds
// until the first audio is there, and a browser opens only a handful of
// connections at once: with too little time or too many stations at the same
// moment a working station showed up as "Nur Discord" (#538).
const BROWSER_PROBE_TIMEOUT_MS = 12_000;
const BROWSER_PROBE_CONCURRENCY = 3;

// Echte Browser-Abspielbarkeit: Audio-Element laden und auf canplay/error hören.
export const probeBrowserPlayable = (url) => new Promise((resolve) => {
  if (!url) { resolve(false); return; }
  const a = new Audio();
  a.muted = true;
  a.preload = 'auto';
  let done = false;
  let timer = null;
  const cleanup = () => {
    a.removeEventListener('canplay', onOk);
    a.removeEventListener('loadeddata', onOk);
    a.removeEventListener('error', onErr);
    try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* noop */ }
    if (timer) clearTimeout(timer);
  };
  const finish = (ok) => { if (done) return; done = true; cleanup(); resolve(ok); };
  const onOk = () => finish(true);
  const onErr = () => finish(false);
  a.addEventListener('canplay', onOk);
  a.addEventListener('loadeddata', onOk);
  a.addEventListener('error', onErr);
  timer = setTimeout(() => finish(false), BROWSER_PROBE_TIMEOUT_MS);
  try { a.src = url; a.load(); } catch { finish(false); }
});

/** Probes [{ key, url }] a few at a time; returns { key: playable }. */
export const probeBrowserBatch = async (items) => {
  const flags = {};
  for (let i = 0; i < items.length; i += BROWSER_PROBE_CONCURRENCY) {
    const group = items.slice(i, i + BROWSER_PROBE_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(group.map((it) => probeBrowserPlayable(it.url)));
    group.forEach((it, gi) => { flags[it.key] = results[gi]; });
  }
  return flags;
};
