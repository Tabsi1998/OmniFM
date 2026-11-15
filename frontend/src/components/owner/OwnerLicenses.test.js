import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../i18n.js';
import OwnerAdmin from '../OwnerAdmin.js';
import { fmtDate } from './ownerUi.js';

// The owner console's license manager (#531): create, edit, extend, expire
// at once, link servers and delete. Each sends the fields the API expects,
// says whether it worked, and the list changes only after the API said yes.

const KEY = 'OMNI-TEST-1';
const GUILD = '123456789012345678';
const OTHER_GUILD = '234567890123456789';
const NEW_KEY = 'OMNI-NEW-2';

function row(overrides = {}) {
  return {
    licenseKey: KEY, id: KEY, plan: 'pro', planName: 'Pro', seats: 2, seatsUsed: 1, active: true, expired: false, daysLeft: 16,
    expiresAt: '2026-12-01T15:30:00.000Z', createdAt: '2026-09-01T00:00:00.000Z', email: 'kunde@example.com', note: 'Stammkunde',
    linkedServerIds: [GUILD],
    linkedServers: [{ id: GUILD, name: 'Radio Club', known: true, valid: true, licenseResolved: true, effectivePlan: 'pro' }],
    ...overrides,
  };
}

// A small license API: GETs answer from `api.licenses`; a write is recorded,
// may wait for `api.wait`, fails with `api.fail`, else `api.apply` changes the list.
let api;

const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const licenseReads = () => api.reads.filter((route) => route === '/api/admin/licenses').length;
const table = () => screen.getByTestId('licenses-table').textContent;
const message = () => screen.getByTestId('license-message');

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('omnifm_admin_token', 'test-token');
  window.history.replaceState(null, '', '/admin?section=licenses');
  api = { licenses: [row()], reads: [], writes: [], wait: null, fail: null, apply: (list) => list };
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const route = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const method = init.method || 'GET';
    if (route === '/api/admin/session') return respond(404, {});
    if (method === 'GET') {
      api.reads.push(route);
      if (route === '/api/admin/licenses') return respond(200, { licenses: api.licenses, count: api.licenses.length });
      if (route === '/api/admin/guilds') return respond(200, { guilds: [{ id: GUILD, name: 'Radio Club' }], count: 1 });
      return respond(200, {});
    }
    const write = { method, route, body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers };
    api.writes.push(write);
    if (api.wait) await api.wait;
    if (api.fail) return respond(api.fail.status, { error: api.fail.error });
    api.licenses = api.apply(api.licenses, write);
    const key = decodeURIComponent(route.split('/').pop());
    return respond(200, { ok: true, license: api.licenses.find((entry) => entry.licenseKey === key) || null });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

async function openConsole() {
  render(<I18nProvider><OwnerAdmin /></I18nProvider>);
  await screen.findByTestId(`license-row-${KEY}`);
}

async function click(testId) {
  await act(async () => { fireEvent.click(screen.getByTestId(testId)); });
}

function type(testId, value) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

async function openEdit() {
  await openConsole();
  await click(`license-edit-${KEY}`);
  expect(screen.getByTestId('license-form').textContent).toContain(KEY);
}

// The owner's token and the CSRF mark go with every write.
function expectOwnerHeaders(write) {
  expect(write.headers['X-Admin-Token']).toBe('test-token');
  expect(write.headers['X-OmniFM-CSRF']).toBe('owner-intent');
}

describe('license manager: create', () => {
  function fillNewLicense(serverId = OTHER_GUILD) {
    type('license-input-email', 'neu@example.com');
    type('license-input-tier', 'ultimate');
    type('license-input-seats', '3');
    type('license-input-months', '6');
    type('license-input-note', 'Testkunde');
    type('license-input-guild', serverId);
  }

  it('sends the new license with its server and shows it once the API said yes', async () => {
    api.apply = (list) => [...list, row({ licenseKey: NEW_KEY, id: NEW_KEY, plan: 'ultimate', planName: 'Ultimate', email: 'neu@example.com', linkedServerIds: [OTHER_GUILD], linkedServers: [] })];
    let release;
    api.wait = new Promise((resolve) => { release = resolve; });
    await openConsole();
    await click('license-create-button');
    fillNewLicense();
    await click('license-save-new');

    expect(api.writes).toHaveLength(1);
    const [write] = api.writes;
    expect(write.method).toBe('POST');
    expect(write.route).toBe('/api/admin/licenses');
    expect(write.body).toEqual({ email: 'neu@example.com', tier: 'ultimate', months: 6, seats: 3, note: 'Testkunde', guildId: OTHER_GUILD });
    expectOwnerHeaders(write);
    // While the API works: the button waits, the list stays as it was.
    expect(screen.getByTestId('license-save-new').disabled).toBe(true);
    expect(screen.queryByTestId(`license-row-${NEW_KEY}`)).toBeNull();

    await act(async () => { release(); });
    await screen.findByTestId(`license-row-${NEW_KEY}`);
    expect(message().textContent).toContain('Lizenz erstellt.');
    expect(message().className).toContain('green');
    expect(screen.queryByTestId('license-form')).toBeNull();
  });

  it('shows the API error, keeps the form and leaves the list as it was', async () => {
    api.fail = { status: 400, error: 'Bitte eine gültige E-Mail-Adresse angeben.' };
    await openConsole();
    const before = table();
    const reads = licenseReads();
    await click('license-create-button');
    fillNewLicense();
    await click('license-save-new');

    await waitFor(() => expect(message().textContent).toContain('Bitte eine gültige E-Mail-Adresse angeben.'));
    expect(message().className).toContain('red');
    expect(screen.getByTestId('license-input-email').value).toBe('neu@example.com');
    expect(table()).toBe(before);
    expect(licenseReads()).toBe(reads);
  });

  it('blocks a server ID that is not a Discord guild ID', async () => {
    await openConsole();
    await click('license-create-button');
    const save = () => screen.getByTestId('license-save-new');
    for (const invalid of ['1', '1234567890123456', '12345678901234567890123', '12345678901234567a']) {
      type('license-input-guild', invalid);
      expect(save().disabled, invalid).toBe(true);
    }
    await click('license-save-new');
    expect(api.writes).toEqual([]);

    type('license-input-guild', '');
    expect(save().disabled).toBe(false);
    type('license-input-guild', GUILD);
    expect(save().disabled).toBe(false);
  });
});

describe('license manager: edit, extend, expire', () => {
  it('saves the changed fields of the license', async () => {
    api.apply = (list) => list.map((entry) => (entry.licenseKey === KEY ? { ...entry, email: 'neu@example.com', plan: 'ultimate', planName: 'Ultimate', seats: 3 } : entry));
    await openEdit();
    type('license-input-email', 'neu@example.com');
    type('license-input-tier', 'ultimate');
    type('license-input-seats', '3');
    type('license-input-note', 'Neu');
    type('license-input-expiry', '2027-01-31');
    await click('license-save-edit');

    await waitFor(() => expect(message().textContent).toContain('Änderungen gespeichert.'));
    const [write] = api.writes;
    expect(write.method).toBe('PATCH');
    expect(write.route).toBe(`/api/admin/licenses/${KEY}`);
    expect(write.body).toEqual({ email: 'neu@example.com', tier: 'ultimate', seats: 3, note: 'Neu', expiresAt: '2027-01-31' });
    expectOwnerHeaders(write);
    expect(screen.getByTestId(`license-row-${KEY}`).textContent).toContain('neu@example.com');
  });

  it('leaves the expiry alone when only another field changed', async () => {
    await openEdit();
    type('license-input-note', 'Nur die Notiz');
    await click('license-save-edit');

    await waitFor(() => expect(api.writes).toHaveLength(1));
    // The date field shows only the day; sending it back would move the end to midnight.
    expect(api.writes[0].body).toEqual({ email: 'kunde@example.com', tier: 'pro', seats: 2, note: 'Nur die Notiz' });
  });

  it.each([
    ['license-extend-1m', { extendMonths: 1 }, '+1 Monat'],
    ['license-extend-3m', { extendMonths: 3 }, '+3 Monate'],
    ['license-extend-12m', { extendMonths: 12 }, '+12 Monate'],
    ['license-shorten-1m', { extendMonths: -1 }, '−1 Monat'],
  ])('%s sends %o and shows the new end in the list', async (button, body, note) => {
    const end = '2027-03-15T15:30:00.000Z';
    api.apply = (list) => list.map((entry) => (entry.licenseKey === KEY ? { ...entry, expiresAt: end } : entry));
    await openEdit();
    expect(table()).not.toContain(fmtDate(end));
    await click(button);

    await waitFor(() => expect(message().textContent).toContain(note));
    expect(api.writes.map((write) => [write.method, write.route, write.body])).toEqual([['PATCH', `/api/admin/licenses/${KEY}`, body]]);
    expect(message().className).toContain('green');
    await waitFor(() => expect(table()).toContain(fmtDate(end)));
  });

  it('lets a license expire at once', async () => {
    api.apply = (list) => list.map((entry) => (entry.licenseKey === KEY ? { ...entry, expired: true, active: false, daysLeft: 0 } : entry));
    await openEdit();
    expect(screen.getByTestId(`license-row-${KEY}`).textContent).toContain('Aktiv');
    await click('license-expire-now');

    await waitFor(() => expect(message().textContent).toContain('Sofort deaktiviert (abgelaufen)'));
    expect(api.writes.map((write) => write.body)).toEqual([{ expireNow: true }]);
    await waitFor(() => expect(screen.getByTestId(`license-row-${KEY}`).textContent).toContain('Abgelaufen'));
  });
});

describe('license manager: servers', () => {
  it('links a server and shows it once the API said yes', async () => {
    api.apply = (list) => list.map((entry) => (entry.licenseKey === KEY
      ? { ...entry, linkedServerIds: [GUILD, OTHER_GUILD], linkedServers: [...entry.linkedServers, { id: OTHER_GUILD, name: 'Jazz Lounge', known: true, valid: true, licenseResolved: true, effectivePlan: 'pro' }] }
      : entry));
    await openEdit();
    type('license-guild-input', OTHER_GUILD);
    await click('license-guild-add');

    await waitFor(() => expect(message().textContent).toContain('Server verknüpft'));
    expect(api.writes.map((write) => [write.method, write.route, write.body])).toEqual([['PATCH', `/api/admin/licenses/${KEY}`, { addServerId: OTHER_GUILD }]]);
    await waitFor(() => expect(table()).toContain('Jazz Lounge'));
    expect(screen.getByTestId('license-guild-input').value).toBe('');
  });

  it('blocks a server ID that is not a Discord guild ID', async () => {
    await openEdit();
    const add = () => screen.getByTestId('license-guild-add');
    expect(add().disabled).toBe(true);
    for (const invalid of ['1', '1234567890123456', '12345678901234567890123', 'abc']) {
      type('license-guild-input', invalid);
      expect(add().disabled, invalid).toBe(true);
    }
    await click('license-guild-add');
    expect(api.writes).toEqual([]);
    type('license-guild-input', OTHER_GUILD);
    expect(add().disabled).toBe(false);
  });

  it('removes a linked server', async () => {
    api.apply = (list) => list.map((entry) => (entry.licenseKey === KEY ? { ...entry, linkedServerIds: [], linkedServers: [], seatsUsed: 0 } : entry));
    await openEdit();
    expect(table()).toContain('Radio Club');
    await click(`license-guild-remove-${GUILD}`);

    await waitFor(() => expect(message().textContent).toContain('Server entfernt'));
    expect(api.writes.map((write) => write.body)).toEqual([{ removeServerId: GUILD }]);
    await waitFor(() => expect(table()).not.toContain('Radio Club'));
  });
});

describe('license manager: a failed change', () => {
  it.each([
    ['license-save-edit', 'Seats können nicht unter die 1 verknüpften Server reduziert werden.'],
    ['license-extend-1m', 'Lizenz nicht gefunden.'],
    ['license-expire-now', 'Keine Datenbank verbunden.'],
    ['license-guild-add', 'Diese Lizenz hat 2 Seat(s), angefordert wurden 3 Server.'],
    [`license-guild-remove-${GUILD}`, 'Keine Datenbank verbunden.'],
  ])('%s shows the API error and leaves the list as it was', async (button, error) => {
    api.fail = { status: 400, error };
    await openEdit();
    const before = table();
    const reads = licenseReads();
    if (button === 'license-guild-add') type('license-guild-input', OTHER_GUILD);
    await click(button);

    await waitFor(() => expect(message().textContent).toContain(error));
    expect(message().className).toContain('red');
    expect(api.writes).toHaveLength(1);
    expect(table()).toBe(before);
    expect(licenseReads()).toBe(reads);
    expect(screen.getByTestId('license-form')).toBeTruthy();
  });
});

describe('license manager: delete', () => {
  it.each([['the form', 'license-delete'], ['the list', `license-delete-${KEY}`]])('deletes from %s after the question, then drops the row', async (_where, button) => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.apply = (list) => list.filter((entry) => entry.licenseKey !== KEY);
    await openEdit();
    await click(button);

    expect(confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(message().textContent).toContain('Lizenz archiviert und aus dem aktiven Betrieb entfernt.'));
    const [write] = api.writes;
    expect([write.method, write.route, write.body]).toEqual(['DELETE', `/api/admin/licenses/${KEY}`, undefined]);
    expectOwnerHeaders(write);
    await waitFor(() => expect(screen.queryByTestId(`license-row-${KEY}`)).toBeNull());
    expect(screen.queryByTestId('license-form')).toBeNull();
  });

  it('sends nothing when the question is answered with no', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openConsole();
    await click(`license-delete-${KEY}`);
    expect(api.writes).toEqual([]);
    expect(screen.getByTestId(`license-row-${KEY}`)).toBeTruthy();
  });

  it('shows the API error and keeps the license in the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.fail = { status: 409, error: 'Lizenz konnte vor dem Löschen nicht archiviert werden.' };
    await openConsole();
    const before = table();
    const reads = licenseReads();
    await click(`license-delete-${KEY}`);

    await waitFor(() => expect(message().textContent).toContain('Lizenz konnte vor dem Löschen nicht archiviert werden.'));
    expect(message().className).toContain('red');
    expect(table()).toBe(before);
    expect(licenseReads()).toBe(reads);
  });
});
