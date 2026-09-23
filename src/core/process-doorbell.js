// Doorbell between the processes of the split runtime (#213).
//
// MongoDB stays the source of truth for worker commands and their results. A
// ring over the IPC channel of the split supervisor only tells the other
// processes to look now instead of at their next poll. Without the channel (a
// process started on its own, the monolith, tests) nothing rings and polling
// carries on as before.

const DOORBELL_MESSAGE_TYPE = "omnifm:doorbell";

const listenersByProcess = new WeakMap();

function isDoorbellConnected(proc = process) {
  return typeof proc?.send === "function" && proc.connected === true;
}

function ringDoorbell(topic, detail = {}, proc = process) {
  if (!isDoorbellConnected(proc)) return false;
  try {
    // With a callback, a closed channel reports to it instead of emitting
    // "error" on the process.
    proc.send({ type: DOORBELL_MESSAGE_TYPE, topic: String(topic || ""), detail }, () => {});
    return true;
  } catch {
    return false;
  }
}

function getListeners(proc) {
  let listeners = listenersByProcess.get(proc);
  if (listeners) return listeners;
  listeners = new Map();
  listenersByProcess.set(proc, listeners);
  proc.on("message", (message) => {
    if (!message || message.type !== DOORBELL_MESSAGE_TYPE) return;
    const handlers = listeners.get(message.topic);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(message.detail || {});
      } catch {
        // A failing listener must not stop the others.
      }
    }
  });
  // The channel must not keep a process alive that wants to exit.
  proc.channel?.unref?.();
  return listeners;
}

function onDoorbell(topic, handler, proc = process) {
  if (!isDoorbellConnected(proc) || typeof handler !== "function") return () => {};
  const listeners = getListeners(proc);
  const key = String(topic || "");
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(handler);
  return () => {
    listeners.get(key)?.delete(handler);
  };
}

/**
 * Resolves after timeoutMs, or earlier when a ring of the topic matches.
 * Returns true when a ring woke it.
 */
function waitForDoorbell(topic, { timeoutMs = 500, match = () => true, proc = process } = {}) {
  return new Promise((resolve) => {
    let stop = () => {};
    const timer = setTimeout(() => {
      stop();
      resolve(false);
    }, Math.max(0, Number(timeoutMs) || 0));
    stop = onDoorbell(topic, (detail) => {
      if (!match(detail)) return;
      clearTimeout(timer);
      stop();
      resolve(true);
    }, proc);
  });
}

/** Supervisor side: pass a ring of one child on to every other child. */
function relayDoorbellMessage(children, sender, message) {
  if (!message || message.type !== DOORBELL_MESSAGE_TYPE) return 0;
  let delivered = 0;
  for (const child of children) {
    if (!child || child === sender || child.connected !== true || typeof child.send !== "function") continue;
    try {
      child.send(message, () => {});
      delivered += 1;
    } catch {
      // A child that is exiting cannot take the message; it polls after its restart.
    }
  }
  return delivered;
}

export {
  DOORBELL_MESSAGE_TYPE,
  isDoorbellConnected,
  onDoorbell,
  relayDoorbellMessage,
  ringDoorbell,
  waitForDoorbell,
};
