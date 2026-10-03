// OmniFM: the dashboard's overview listens instead of asking (#502). One
// stream of Server-Sent Events per tab: the server sends the first state at
// once and then whatever changed. A hidden tab closes it and opens it again
// when shown. Where the stream does not work (an older server, a proxy that
// collects the messages), the overview asks every 30 seconds instead.
import { buildApiUrl } from './api.js';

export const LIVE_FALLBACK_MS = 30_000;
export const LIVE_FIRST_MESSAGE_MS = 10_000;

/**
 * @param {string} guildId
 * @param {{ onData: (data: any) => void, poll: () => unknown, EventSourceImpl?: any, doc?: any, timers?: any }} options
 * @returns {() => void} stop
 */
export function watchDashboardLive(guildId, {
  onData,
  poll,
  EventSourceImpl = globalThis.EventSource,
  doc = globalThis.document,
  timers = globalThis,
}) {
  let source = null;
  let firstTimer = null;
  let pollTimer = null;
  let stopped = false;
  let fallen = typeof EventSourceImpl !== 'function';

  const hidden = () => doc?.visibilityState === 'hidden';

  const closeSource = () => {
    timers.clearTimeout(firstTimer);
    source?.close();
    source = null;
  };
  const stopPolling = () => {
    timers.clearInterval(pollTimer);
    pollTimer = null;
  };
  const fallBack = () => {
    fallen = true;
    closeSource();
    if (stopped || pollTimer || hidden()) return;
    poll();
    pollTimer = timers.setInterval(poll, LIVE_FALLBACK_MS);
  };

  const open = () => {
    if (stopped || hidden() || source) return;
    if (fallen) {
      fallBack();
      return;
    }
    const stream = new EventSourceImpl(buildApiUrl(`/api/dashboard/live?serverId=${encodeURIComponent(guildId)}`), { withCredentials: true });
    source = stream;
    // A proxy that collects the messages never delivers the first one.
    firstTimer = timers.setTimeout(fallBack, LIVE_FIRST_MESSAGE_MS);
    stream.addEventListener('live', (event) => {
      timers.clearTimeout(firstTimer);
      try {
        onData(JSON.parse(event.data));
      } catch {
        // a broken message changes nothing
      }
    });
    stream.onerror = () => {
      // While CONNECTING the browser tries again by itself; CLOSED means an
      // error answer (signed out, an older server): then ask instead.
      if (source === stream && stream.readyState === EventSourceImpl.CLOSED) fallBack();
    };
  };

  const onVisibility = () => {
    if (hidden()) {
      closeSource();
      stopPolling();
    } else if (fallen) {
      fallBack();
    } else {
      open();
    }
  };

  doc?.addEventListener?.('visibilitychange', onVisibility);
  open();
  return () => {
    stopped = true;
    closeSource();
    stopPolling();
    doc?.removeEventListener?.('visibilitychange', onVisibility);
  };
}
