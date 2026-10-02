// OmniFM: owner console: a partner's logo uploaded to this server (#486).
// The picture goes to /api/admin/pictures; its reference "upload:<id>" takes
// the place of the logo address. The website then serves it itself, without
// fetching it from the partner's server.
import { useState } from 'react';
import { Upload } from 'lucide-react';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = 'image/png,image/jpeg,image/webp,image/gif';

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Die Datei ließ sich nicht lesen.'));
    reader.readAsDataURL(file);
  });
}

export default function SponsorLogoUpload({ index, value, apiSend, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');

  const pick = async (file) => {
    setError('');
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('Das Bild ist größer als 2 MB.');
      return;
    }
    setBusy(true);
    try {
      const data = await readAsDataUrl(file);
      const result = await apiSend('/api/admin/pictures', 'POST', { data });
      setPreview(data);
      onUploaded(result.ref);
    } catch (err) {
      setError(err.message || 'Hochladen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  // Uploaded earlier and saved: the website's own address shows it.
  const shown = preview || (String(value || '').startsWith('upload:') ? `/api/image/sponsor/${index}` : '');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '0 0 14px' }}>
      <label className="oa-btn ghost" style={{ cursor: busy ? 'wait' : 'pointer', height: 32 }}>
        <Upload size={14} /> {busy ? 'Lädt …' : 'Logo hochladen'}
        <input
          type="file"
          accept={TYPES}
          hidden
          disabled={busy}
          aria-label={`Logo für Partner ${index + 1} hochladen`}
          onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ''; }}
          data-testid={`cfg-sponsor-${index}-upload`}
        />
      </label>
      {shown && <img src={shown} alt="" style={{ maxHeight: 32, maxWidth: 140, objectFit: 'contain' }} data-testid={`cfg-sponsor-${index}-preview`} />}
      {String(value || '').startsWith('upload:') && <span className="oa-sub" data-testid={`cfg-sponsor-${index}-uploaded`}>Hochgeladen; kommt von diesem Server.</span>}
      {error && <span className="oa-sub" role="alert" style={{ color: '#ff8fab' }}>{error}</span>}
    </div>
  );
}
