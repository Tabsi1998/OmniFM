const frontendEnv = import.meta.env || {};
const explicitApiBase = String(
  frontendEnv.VITE_BACKEND_URL || frontendEnv.REACT_APP_BACKEND_URL || ''
).trim().replace(/\/+$/, '');
const localDevBackendPort = String(
  frontendEnv.VITE_BACKEND_PORT || frontendEnv.REACT_APP_BACKEND_PORT || '8001'
).trim() || '8001';

function resolveApiBase() {
  if (explicitApiBase) return explicitApiBase;
  if (typeof window === 'undefined') return '';

  const protocol = String(window.location.protocol || '').toLowerCase();
  const hostname = String(window.location.hostname || '').trim();
  const port = String(window.location.port || '').trim();
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isBrowserDevServer = isLocalHost && port === '3000';
  if (!isBrowserDevServer || (protocol !== 'http:' && protocol !== 'https:')) {
    return '';
  }

  return `${protocol}//${hostname}:${localDevBackendPort}`;
}

const API_BASE = resolveApiBase();

function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

export { API_BASE, buildApiUrl };
