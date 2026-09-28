// OmniFM: server dashboard settings: the favourite stations of the now-playing panel.
// Split out of components/DashboardSettings.js (#296); its state stays there.
import { ArrowUp, ArrowDown, X, Radio } from 'lucide-react';
import { PLAN_LIMITS } from '../../../../src/config/plan-features.js';

export default function SettingsFavorites({
  availableFavoriteStations,
  favoriteLimit,
  favoriteStations,
  moveFavorite,
  setFavoriteStations,
  stationPreviewMap,
  t,
}) {
  return (
    <div data-testid="settings-favorites" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Radio size={18} color="#FACC15" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Favoriten-Leiste', 'Favourite bar')}</h3>
      </div>
      <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          `Bis zu ${favoriteLimit} Sender als Schnellknöpfe im Now-Playing-Panel (Free ${PLAN_LIMITS.free.favorites}, Pro ${PLAN_LIMITS.pro.favorites}, Ultimate ${PLAN_LIMITS.ultimate.favorites}). Mit ⭐ im Sender-Browser geht es auch direkt in Discord. Bei einem kleineren Plan werden überzählige ausgeblendet, nicht gelöscht.`,
          `Up to ${favoriteLimit} stations as quick buttons in the now-playing panel (Free ${PLAN_LIMITS.free.favorites}, Pro ${PLAN_LIMITS.pro.favorites}, Ultimate ${PLAN_LIMITS.ultimate.favorites}). The ⭐ menu in the station browser works in Discord too. On a smaller plan extra ones are hidden, not deleted.`
        )}
      </p>
      <div data-testid="favorites-list" style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {favoriteStations.length === 0 && (
          <div style={{ color: '#71717A', fontSize: 13 }}>{t('Noch keine Favoriten.', 'No favourites yet.')}</div>
        )}
        {favoriteStations.map((stationKey, index) => {
          const preview = stationPreviewMap.get(String(stationKey).toLowerCase());
          const hidden = index >= favoriteLimit;
          return (
            <div key={stationKey} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #1A1A2E', background: '#050505', padding: '8px 12px', opacity: hidden ? 0.55 : 1 }}>
              <span style={{ color: '#FACC15', fontWeight: 700, width: 18 }}>{index + 1}</span>
              <span style={{ flex: 1, color: '#E4E4E7', fontSize: 13 }}>{preview?.label || stationKey}</span>
              {hidden && <span style={{ fontSize: 11, color: '#A1A1AA', border: '1px solid #27272A', padding: '2px 8px' }}>{t('ausgeblendet', 'hidden')}</span>}
              <button type="button" onClick={() => moveFavorite(index, -1)} disabled={index === 0} style={{ border: 0, background: 'transparent', color: '#A1A1AA', cursor: index === 0 ? 'not-allowed' : 'pointer' }}><ArrowUp size={14} /></button>
              <button type="button" onClick={() => moveFavorite(index, 1)} disabled={index === favoriteStations.length - 1} style={{ border: 0, background: 'transparent', color: '#A1A1AA', cursor: index === favoriteStations.length - 1 ? 'not-allowed' : 'pointer' }}><ArrowDown size={14} /></button>
              <button type="button" data-testid={`favorite-remove-${index}`} onClick={() => setFavoriteStations(favoriteStations.filter((key) => key !== stationKey))} style={{ border: 0, background: 'transparent', color: '#FCA5A5', cursor: 'pointer' }}><X size={14} /></button>
            </div>
          );
        })}
      </div>
      <select
        data-testid="favorite-add-select"
        value=""
        disabled={favoriteStations.length >= favoriteLimit}
        onChange={(e) => { if (e.target.value) setFavoriteStations([...favoriteStations, e.target.value]); }}
        style={{ width: '100%', maxWidth: 420, height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
      >
        <option value="">{favoriteStations.length >= favoriteLimit ? t(`Voll – höchstens ${favoriteLimit}`, `Full – at most ${favoriteLimit}`) : t('Sender als Favorit hinzufügen...', 'Add a station as favourite...')}</option>
        {availableFavoriteStations.map((station) => <option key={station.value} value={station.value}>{station.label}</option>)}
      </select>
    </div>
  );
}
