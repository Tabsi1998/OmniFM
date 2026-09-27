// The server dashboard's requests (#374). The Node API refuses every change
// to /api/dashboard/* and the logout without this header (CSRF guard,
// enforceDashboardMutationIntent in src/api/server.js); a foreign page cannot
// send it. The rule here is the server's rule.
import { buildApiUrl } from './api.js';

export const DASHBOARD_CSRF_HEADER = 'X-OmniFM-CSRF';
export const DASHBOARD_CSRF_INTENT = 'dashboard-intent';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function needsDashboardIntent(path, method = 'GET') {
  if (!MUTATION_METHODS.has(String(method || 'GET').toUpperCase())) return false;
  const pathname = String(path || '').split('?')[0];
  if (pathname === '/api/auth/logout') return true;
  return pathname.startsWith('/api/dashboard/') && pathname !== '/api/dashboard/telemetry';
}

/** One dashboard request: JSON back, an Error with .status on failure. */
export async function dashboardApiRequest(path, options = {}, fetchImpl = globalThis.fetch) {
  const method = String(options.method || 'GET').toUpperCase();
  const response = await fetchImpl(buildApiUrl(path), {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    method,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(needsDashboardIntent(path, method) ? { [DASHBOARD_CSRF_HEADER]: DASHBOARD_CSRF_INTENT } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || payload?.detail || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}
