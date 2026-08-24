import { useEffect, useState } from 'react';
import { buildApiUrl } from './api.js';

// Bitrate pro Tarif (ehrlich, keine erfundenen Werte).
const TIER_BITRATE = { free: '64 kbps', pro: '128 kbps', ultimate: '320 kbps' };

// Liefert ECHTE Sender aus dem Katalog (/api/stations) für Marketing-Showcases.
// Keine erfundenen Sender/Hörer/Server mehr.
export function useShowcaseStations(limit = 8) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let stop = false;
    fetch(buildApiUrl('/api/stations'))
      .then((r) => r.json())
      .then((d) => {
        if (stop) return;
        const list = Array.isArray(d) ? d : (d && d.stations) || [];
        const clean = list.filter((s) => s && s.name);
        if (!clean.length) return;
        // Über den ganzen Katalog verteilt auswählen (Free + Pro Mix).
        const step = Math.max(1, Math.floor(clean.length / limit));
        const picked = [];
        for (let i = 0; i < clean.length && picked.length < limit; i += step) {
          const s = clean[i];
          const tier = (s.tier || 'free').toLowerCase();
          picked.push({ name: s.name, tier, bitrate: TIER_BITRATE[tier] || 'Live' });
        }
        setItems(picked);
      })
      .catch(() => {});
    return () => { stop = true; };
  }, [limit]);
  return items;
}
