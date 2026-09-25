import { useCallback, useEffect, useState } from 'react';
import { Palette } from 'lucide-react';
import { AVATAR_BOX, BANNER_BOX, prepareProfileImage } from '../lib/profileImage.js';

const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 };
const labelStyle = { display: 'block', fontSize: 11, color: '#71717A', margin: '10px 0 4px', textTransform: 'uppercase', letterSpacing: '0.08em' };

function WorkerProfileCard({ worker, limits, t, onSave }) {
  const [avatar, setAvatar] = useState(null);
  const [banner, setBanner] = useState(null);
  const [bio, setBio] = useState(worker.custom?.bio || '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    setAvatar(null);
    setBanner(null);
    setBio(worker.custom?.bio || '');
  }, [worker]);

  const pick = (setter, box) => async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setter(await prepareProfileImage(file, box));
      setNote('');
    } catch {
      setNote(t('Das Bild ließ sich nicht lesen.', 'The picture could not be read.'));
    }
  };

  const submit = async (body) => {
    setBusy(true);
    setNote('');
    try {
      await onSave({ slot: worker.slot, ...body });
      setNote(body.reset ? t('Zurückgesetzt.', 'Reset.') : t('Übernommen.', 'Applied.'));
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changes = {};
  if (avatar) changes.avatar = avatar;
  if (banner) changes.banner = banner;
  if (bio !== (worker.custom?.bio || '')) changes.bio = bio;
  const hasChanges = Object.keys(changes).length > 0;
  const hasCustom = worker.custom?.avatar || worker.custom?.banner || worker.custom?.bio;

  return (
    <div data-testid={`bot-profile-${worker.slot}`} style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
      {banner && <img src={banner} alt="" style={{ width: '100%', aspectRatio: '5 / 2', objectFit: 'cover', marginBottom: 10 }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img
          src={avatar || worker.avatarUrl || '/favicon.ico'}
          alt=""
          style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid #1A1A2E', background: '#111' }}
        />
        <div>
          <div style={{ color: '#fff', fontWeight: 700 }}>{worker.name}</div>
          <div style={{ color: '#71717A', fontSize: 12 }}>
            {hasCustom ? t('Eigenes Aussehen auf diesem Server', 'Own look on this server') : t('Standard-Aussehen', 'Default look')}
          </div>
        </div>
      </div>
      <label style={labelStyle}>{t('Avatar (PNG, JPG, GIF, WebP)', 'Avatar (PNG, JPG, GIF, WebP)')}</label>
      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={pick(setAvatar, AVATAR_BOX)} style={inputStyle} />
      <label style={labelStyle}>{t('Banner', 'Banner')}</label>
      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={pick(setBanner, BANNER_BOX)} style={inputStyle} />
      <label style={labelStyle}>{t('Bio', 'Bio')} ({bio.length}/{limits.bioLength || 190})</label>
      <textarea
        value={bio}
        maxLength={limits.bioLength || 190}
        onChange={(event) => setBio(event.target.value)}
        rows={3}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy || !hasChanges}
          onClick={() => submit(changes)}
          style={{ height: 36, padding: '0 14px', border: 'none', background: hasChanges ? '#10B981' : '#1A1A2E', color: hasChanges ? '#042f2e' : '#52525B', fontWeight: 700, cursor: hasChanges && !busy ? 'pointer' : 'not-allowed' }}
        >
          {busy ? t('Übernehme...', 'Applying...') : t('Übernehmen', 'Apply')}
        </button>
        {hasCustom && (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit({ reset: true })}
            style={{ height: 36, padding: '0 14px', border: '1px solid #1A1A2E', background: 'transparent', color: '#A1A1AA', cursor: busy ? 'not-allowed' : 'pointer' }}
          >
            {t('Zurücksetzen', 'Reset')}
          </button>
        )}
      </div>
      {note && <div style={{ marginTop: 8, fontSize: 12, color: '#A1A1AA' }}>{note}</div>}
    </div>
  );
}

export default function DashboardBotProfile({ apiRequest, selectedGuildId, t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!selectedGuildId) return;
    try {
      setData(await apiRequest(`/api/dashboard/bot-profile?serverId=${encodeURIComponent(selectedGuildId)}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [apiRequest, selectedGuildId]);

  useEffect(() => { load(); }, [load]);

  const save = async (body) => {
    const result = await apiRequest(`/api/dashboard/bot-profile?serverId=${encodeURIComponent(selectedGuildId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    setData((current) => ({ ...(current || {}), workers: result?.workers || current?.workers || [] }));
  };

  if (!data) return error ? <div style={{ color: '#FCA5A5', fontSize: 13 }}>{error}</div> : null;
  const available = data.available === true;

  return (
    <div data-testid="settings-bot-profile" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: available ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Palette size={18} color="#EC4899" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Bot-Aussehen', 'Bot look')}</h3>
        {!available && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>ULTIMATE</span>}
      </div>
      <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          'Jeder Worker kann auf deinem Server einen eigenen Avatar, ein Banner und eine Bio haben – zum Beispiel im Vereinslook. Das gilt nur hier, auf anderen Servern bleibt OmniFM, wie es ist. Discord erlaubt nur wenige Änderungen hintereinander.',
          'Every worker can have its own avatar, banner and bio on your server – in your club look, for example. It only applies here; on other servers OmniFM stays as it is. Discord allows only a few changes in a row.'
        )}
      </p>
      {!available && (
        <p style={{ color: '#A1A1AA', fontSize: 13 }}>
          {t('Das gibt es mit Ultimate. Beim Wechsel auf einen kleineren Plan bekommt der Bot automatisch wieder sein Standard-Aussehen.', 'This comes with Ultimate. On a smaller plan the bot gets its default look back automatically.')}
        </p>
      )}
      {available && (data.workers || []).length === 0 && (
        <p style={{ color: '#A1A1AA', fontSize: 13 }}>{t('Auf diesem Server ist noch kein Worker eingeladen.', 'No worker is invited on this server yet.')}</p>
      )}
      {available && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {(data.workers || []).map((worker) => (
            <WorkerProfileCard key={worker.slot} worker={worker} limits={data.limits || {}} t={t} onSave={save} />
          ))}
        </div>
      )}
    </div>
  );
}
