import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, Plus, Trash2, Pencil, Save, X, ExternalLink } from 'lucide-react';
import {
  normalizeDashboardCustomStation,
  listDashboardCustomStationFolders,
  filterDashboardCustomStations,
  groupDashboardCustomStations,
} from '../lib/dashboardCustomStations.js';
import { buildDashboardCustomStationsHint } from '../lib/dashboardOnboarding.js';
import DashboardOnboardingHint from './DashboardOnboardingHint.js';

function StationRow({ station, onDelete, onEdit, t, testId }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: station.name,
    url: station.url,
    genre: station.genre || '',
    folder: station.folder || '',
    tagsText: Array.isArray(station.tags) ? station.tags.join(', ') : '',
  });

  useEffect(() => {
    setForm({
      name: station.name,
      url: station.url,
      genre: station.genre || '',
      folder: station.folder || '',
      tagsText: Array.isArray(station.tags) ? station.tags.join(', ') : '',
    });
  }, [station]);

  const handleSave = async () => {
    setSaving(true);
    const ok = await onEdit(station.key, {
      name: form.name,
      url: form.url,
      genre: form.genre,
      folder: form.folder,
      tags: form.tagsText,
    });
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <div data-testid={testId} style={{ border: '1px solid #1A1A2E', background: '#0A0A0A', padding: '12px 14px' }}>
      {editing ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <input
              value={form.name}
              onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
              placeholder={t('Name', 'Name')}
              style={{
                height: 36,
                border: '1px solid #1A1A2E',
                background: '#050505',
                color: '#fff',
                padding: '0 8px',
                fontSize: 13,
              }}
            />
            <input
              value={form.url}
              onChange={(e) => setForm((current) => ({ ...current, url: e.target.value }))}
              placeholder={t('Stream-URL', 'Stream URL')}
              style={{
                height: 36,
                border: '1px solid #1A1A2E',
                background: '#050505',
                color: '#fff',
                padding: '0 8px',
                fontSize: 13,
              }}
            />
            <input
              value={form.genre}
              onChange={(e) => setForm((current) => ({ ...current, genre: e.target.value }))}
              placeholder={t('Genre', 'Genre')}
              style={{
                height: 36,
                border: '1px solid #1A1A2E',
                background: '#050505',
                color: '#fff',
                padding: '0 8px',
                fontSize: 13,
              }}
            />
            <input
              value={form.folder}
              onChange={(e) => setForm((current) => ({ ...current, folder: e.target.value }))}
              placeholder={t('Ordner', 'Folder')}
              style={{
                height: 36,
                border: '1px solid #1A1A2E',
                background: '#050505',
                color: '#fff',
                padding: '0 8px',
                fontSize: 13,
              }}
            />
            <input
              value={form.tagsText}
              onChange={(e) => setForm((current) => ({ ...current, tagsText: e.target.value }))}
              placeholder={t('Tags, komma-getrennt', 'Tags, comma-separated')}
              style={{
                height: 36,
                border: '1px solid #1A1A2E',
                background: '#050505',
                color: '#fff',
                padding: '0 8px',
                fontSize: 13,
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button
              data-testid={`${testId}-save`}
              onClick={handleSave}
              disabled={saving}
              style={{
                border: '1px solid rgba(16,185,129,0.4)',
                background: 'rgba(16,185,129,0.1)',
                color: '#10B981',
                minWidth: 86,
                height: 32,
                cursor: saving ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Save size={14} /> {saving ? t('Speichert...', 'Saving...') : t('Speichern', 'Save')}
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              style={{
                border: '1px solid #27272A',
                background: 'transparent',
                color: '#71717A',
                minWidth: 86,
                height: 32,
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <X size={14} /> {t('Abbrechen', 'Cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {station.logoUrl
                  ? <img src={station.logoUrl} alt="" width={28} height={28} loading="lazy" data-testid={`custom-station-logo-${station.key}`} style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                  : <Radio size={14} color="#5865F2" />}
                <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{station.name}</strong>
                {station.genre && <span style={{ fontSize: 11, color: '#52525B', border: '1px solid #1A1A2E', padding: '1px 6px' }}>{station.genre}</span>}
                {station.folder && <span style={{ fontSize: 11, color: '#C4B5FD', border: '1px solid rgba(139,92,246,0.35)', padding: '1px 6px' }}>{station.folder}</span>}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#52525B', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{station.key}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>{station.url}</span>
                <a
                  href={station.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#818CF8', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                >
                  <ExternalLink size={12} /> {t('Oeffnen', 'Open')}
                </a>
              </div>
              {station.tags.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {station.tags.map((tag) => (
                    <span key={`${station.key}-${tag}`} style={{ fontSize: 11, color: '#D4D4D8', border: '1px solid #27272A', padding: '2px 7px' }}>
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button
                data-testid={`${testId}-edit`}
                onClick={() => setEditing(true)}
                style={{
                  border: '1px solid #1A1A2E',
                  background: 'transparent',
                  color: '#A1A1AA',
                  width: 30,
                  height: 30,
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                data-testid={`${testId}-delete`}
                onClick={() => onDelete(station.key)}
                style={{
                  border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(239,68,68,0.08)',
                  color: '#EF4444',
                  width: 30,
                  height: 30,
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardCustomStations({
  apiRequest,
  selectedGuildId,
  t,
  setupStatus = null,
  inviteLinks = null,
}) {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [addForm, setAddForm] = useState({ key: '', name: '', url: '', genre: '', folder: '', tags: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const loadTokenRef = useRef(0);

  const load = useCallback(async () => {
    const loadToken = ++loadTokenRef.current;
    if (!selectedGuildId) {
      setStations([]);
      setError('');
      setMessage('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    setStations([]);
    try {
      const result = await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}`);
      if (loadToken !== loadTokenRef.current) return;
      setStations((result.stations || []).map(normalizeDashboardCustomStation));
    } catch (err) {
      if (loadToken !== loadTokenRef.current) return;
      setError(err.message);
    } finally {
      if (loadToken === loadTokenRef.current) setLoading(false);
    }
  }, [selectedGuildId, apiRequest]);

  useEffect(() => { load(); }, [load]);

  const folderOptions = listDashboardCustomStationFolders(stations);
  const filteredStations = filterDashboardCustomStations(stations, { search, folder: folderFilter });
  const stationGroups = groupDashboardCustomStations(filteredStations);
  const totalTagCount = stations.reduce((count, station) => count + (Array.isArray(station.tags) ? station.tags.length : 0), 0);
  const onboardingHint = buildDashboardCustomStationsHint({
    setupStatus,
    inviteLinks,
    hasStations: stations.length > 0,
    t,
  });

  const addStation = async () => {
    setError('');
    setMessage('');
    const key = addForm.key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!key || !addForm.name.trim() || !addForm.url.trim()) {
      setError(t('Key, Name und URL sind erforderlich.', 'Key, name and URL are required.'));
      return;
    }
    try {
      await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'POST',
        body: JSON.stringify({
          key,
          name: addForm.name.trim(),
          url: addForm.url.trim(),
          genre: addForm.genre.trim(),
          folder: addForm.folder.trim(),
          tags: addForm.tags,
        }),
      });
      setMessage(t('Station hinzugefuegt.', 'Station added.'));
      setAddForm({ key: '', name: '', url: '', genre: '', folder: '', tags: '' });
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const editStation = async (key, updates) => {
    setError('');
    setMessage('');
    try {
      await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PUT',
        body: JSON.stringify({ key, ...updates }),
      });
      setMessage(t('Station aktualisiert.', 'Station updated.'));
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  const deleteStation = async (key) => {
    setError('');
    setMessage('');
    try {
      await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}&key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      setMessage(t('Station gelöscht.', 'Station deleted.'));
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section data-testid="dashboard-custom-stations" style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>
              {t('Custom-Stationen', 'Custom stations')} <span style={{ color: '#52525B', fontSize: 14 }}>({stations.length})</span>
            </h3>
            <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#52525B', border: '1px solid #1A1A2E', padding: '2px 7px' }}>
                {t('Ordner', 'Folders')}: {folderOptions.length}
              </span>
              <span style={{ fontSize: 11, color: '#52525B', border: '1px solid #1A1A2E', padding: '2px 7px' }}>
                {t('Tags', 'Tags')}: {totalTagCount}
              </span>
            </div>
          </div>
          <button
            data-testid="custom-station-add-btn"
            onClick={() => setShowAdd(!showAdd)}
            style={{
              border: '1px solid #5865F2',
              background: showAdd ? 'rgba(88,101,242,0.15)' : 'transparent',
              color: '#fff',
              height: 36,
              padding: '0 14px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}
          >
            <Plus size={14} /> {showAdd ? t('Abbrechen', 'Cancel') : t('Neue Station', 'New station')}
          </button>
        </div>

        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Suche', 'Search')}</label>
            <input
              data-testid="custom-station-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('Nach Name, Key oder Tag suchen', 'Search by name, key, or tag')}
              style={{
                width: '100%',
                height: 40,
                padding: '0 10px',
                border: '1px solid #1A1A2E',
                background: '#050505',
                color: '#fff',
                boxSizing: 'border-box',
                fontSize: 13,
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Ordner-Filter', 'Folder filter')}</label>
            <select
              data-testid="custom-station-folder-filter"
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
              style={{
                width: '100%',
                height: 40,
                padding: '0 10px',
                border: '1px solid #1A1A2E',
                background: '#050505',
                color: '#fff',
                boxSizing: 'border-box',
                fontSize: 13,
              }}
            >
              <option value="">{t('Alle Ordner', 'All folders')}</option>
              {folderOptions.map((folder) => (
                <option key={folder} value={folder}>{folder}</option>
              ))}
            </select>
          </div>
        </div>

        {showAdd && (
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Key', 'Key')}</label>
              <input
                data-testid="custom-station-key-input"
                value={addForm.key}
                onChange={(e) => setAddForm((current) => ({ ...current, key: e.target.value }))}
                placeholder="mein-radio"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 10px',
                  border: '1px solid #1A1A2E',
                  background: '#050505',
                  color: '#fff',
                  boxSizing: 'border-box',
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Name', 'Name')}</label>
              <input
                data-testid="custom-station-name-input"
                value={addForm.name}
                onChange={(e) => setAddForm((current) => ({ ...current, name: e.target.value }))}
                placeholder="Mein Radio"
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 10px',
                  border: '1px solid #1A1A2E',
                  background: '#050505',
                  color: '#fff',
                  boxSizing: 'border-box',
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Stream-URL', 'Stream URL')}</label>
              <input
                data-testid="custom-station-url-input"
                value={addForm.url}
                onChange={(e) => setAddForm((current) => ({ ...current, url: e.target.value }))}
                placeholder="https://..."
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 10px',
                  border: '1px solid #1A1A2E',
                  background: '#050505',
                  color: '#fff',
                  boxSizing: 'border-box',
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Genre', 'Genre')}</label>
              <input
                data-testid="custom-station-genre-input"
                value={addForm.genre}
                onChange={(e) => setAddForm((current) => ({ ...current, genre: e.target.value }))}
                placeholder={t('Optional', 'Optional')}
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 10px',
                  border: '1px solid #1A1A2E',
                  background: '#050505',
                  color: '#fff',
                  boxSizing: 'border-box',
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Ordner', 'Folder')}</label>
              <input
                data-testid="custom-station-folder-input"
                value={addForm.folder}
                onChange={(e) => setAddForm((current) => ({ ...current, folder: e.target.value }))}
                placeholder={t('Optional', 'Optional')}
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 10px',
                  border: '1px solid #1A1A2E',
                  background: '#050505',
                  color: '#fff',
                  boxSizing: 'border-box',
                  fontSize: 13,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Tags', 'Tags')}</label>
              <input
                data-testid="custom-station-tags-input"
                value={addForm.tags}
                onChange={(e) => setAddForm((current) => ({ ...current, tags: e.target.value }))}
                placeholder={t('z. B. chill, news', 'e.g. chill, news')}
                style={{
                  width: '100%',
                  height: 40,
                  padding: '0 10px',
                  border: '1px solid #1A1A2E',
                  background: '#050505',
                  color: '#fff',
                  boxSizing: 'border-box',
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                data-testid="custom-station-save-btn"
                onClick={addStation}
                style={{
                  width: '100%',
                  height: 40,
                  border: 'none',
                  background: '#5865F2',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t('Hinzufuegen', 'Add')}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <div data-testid="custom-stations-error" style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>{error}</div>}
      {message && <div data-testid="custom-stations-message" style={{ border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(6,95,70,0.12)', padding: '10px 12px', color: '#6EE7B7', fontSize: 13 }}>{message}</div>}

      {loading && <div style={{ color: '#52525B', textAlign: 'center', padding: 20 }}>{t('Lade...', 'Loading...')}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {!loading && stations.length === 0 && (
          <>
            {onboardingHint ? (
              <DashboardOnboardingHint
                hint={onboardingHint}
                t={t}
                dataTestId="custom-stations-onboarding-hint"
                actions={
                  setupStatus?.firstStreamLive === true && !showAdd
                    ? [{
                      label: t('Erste Station anlegen', 'Create first station'),
                      onClick: () => setShowAdd(true),
                      testId: 'custom-stations-create-first',
                      variant: 'primary',
                    }]
                    : []
                }
              />
            ) : null}
            <div data-testid="custom-stations-empty" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '40px 20px', textAlign: 'center' }}>
              <Radio size={32} color="#27272A" style={{ margin: '0 auto' }} />
              <p style={{ color: '#52525B', marginTop: 10 }}>{t('Keine Custom-Stationen vorhanden.', 'No custom stations yet.')}</p>
              <p style={{ color: '#3F3F46', marginTop: 4, fontSize: 13 }}>{t('Nutze /addstation auf Discord oder fuege hier eine hinzu.', 'Use /addstation on Discord or add one here.')}</p>
            </div>
          </>
        )}

        {!loading && stations.length > 0 && filteredStations.length === 0 && (
          <div data-testid="custom-stations-empty-filter" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '26px 20px', textAlign: 'center', color: '#71717A' }}>
            {t('Keine Station passt zum aktuellen Filter.', 'No station matches the current filter.')}
          </div>
        )}

        {stationGroups.map((group) => (
          <div key={group.folder || '__root__'} style={{ display: 'grid', gap: 6 }}>
            {(group.folder || folderOptions.length > 0) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 2px' }}>
                <div style={{ fontSize: 12, color: group.folder ? '#C4B5FD' : '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {group.folder || t('Ohne Ordner', 'No folder')}
                </div>
                <div style={{ fontSize: 11, color: '#52525B' }}>{group.stations.length}</div>
              </div>
            )}
            {group.stations.map((station) => (
              <StationRow
                key={station.key}
                station={station}
                onDelete={deleteStation}
                onEdit={editStation}
                t={t}
                testId={`custom-station-${station.key}`}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
