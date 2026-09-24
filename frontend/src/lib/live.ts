import { API_URL, UNAUTHORIZED_EVENT } from "./api";

/**
 * One shared EventSource to /api/admin/events for the whole console tab.
 *
 * The server only says *which* data changed ("tickets", "messages", …); screens refetch through the
 * normal API. After a reconnect we broadcast "*" so every screen catches up on anything missed.
 * EventSource sends the session cookie (withCredentials) but can't send headers, so API-key mode
 * never enables this and keeps polling instead.
 */
export type LiveStatus = "off" | "connecting" | "live";
type Listener = (topics: string[]) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let source: EventSource | null = null;
let status: LiveStatus = "off";
let enabled = false;
let hadConnection = false;
let retryTimer: number | undefined;

function setStatus(next: LiveStatus) {
  if (next === status) return;
  status = next;
  statusListeners.forEach((l) => l());
}

function emit(topics: string[]) {
  listeners.forEach((l) => l(topics));
}

function close() {
  source?.close();
  source = null;
  window.clearTimeout(retryTimer);
  setStatus("off");
}

function connect() {
  if (source || !enabled || typeof window === "undefined" || typeof EventSource === "undefined") return;
  setStatus("connecting");
  const es = new EventSource(`${API_URL}/api/admin/events`, { withCredentials: true });
  source = es;

  es.addEventListener("ready", () => {
    setStatus("live");
    if (hadConnection) emit(["*"]); // reconnected: refetch whatever changed while we were away
    hadConnection = true;
  });
  es.addEventListener("change", (e) => {
    try {
      emit((JSON.parse((e as MessageEvent<string>).data) as { topics: string[] }).topics);
    } catch {
      /* malformed frame: ignore, the next one will do */
    }
  });
  es.addEventListener("signed_out", () => {
    close();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  });
  es.onerror = () => {
    // CONNECTING: the browser is already retrying (network blip, API restart).
    // CLOSED: it gave up (e.g. a 401), so back off and try again ourselves.
    if (es.readyState === EventSource.CLOSED) {
      source = null;
      setStatus("off");
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connect, 15000);
    } else {
      setStatus("connecting");
    }
  };
}

/** Turned on by the auth layer once the console is signed in (or auth is off). */
export function setLiveEnabled(value: boolean) {
  if (value === enabled) return;
  enabled = value;
  if (enabled && listeners.size) connect();
  if (!enabled) close();
}

export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
  };
}

export function getLiveStatus(): LiveStatus {
  return status;
}

export function subscribeLiveStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}
