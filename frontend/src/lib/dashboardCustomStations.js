function normalizeStationTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];

  const tags = [];
  const seen = new Set();
  for (const rawTag of rawTags) {
    const value = String(rawTag || "").trim();
    if (!value) continue;
    const lookup = value.toLowerCase();
    if (seen.has(lookup)) continue;
    seen.add(lookup);
    tags.push(value);
  }

  return tags;
}

export function normalizeDashboardCustomStation(rawStation) {
  const station = rawStation && typeof rawStation === 'object' ? rawStation : {};
  return {
    key: String(station.key || '').trim(),
    name: String(station.name || station.key || '').trim(),
    url: String(station.url || '').trim(),
    genre: String(station.genre || '').trim(),
    folder: String(station.folder || '').trim(),
    tags: normalizeStationTags(station.tags),
    // The stored logo (#340); only an https link or one on this website.
    logoUrl: /^(https:\/\/|\/api\/station-logos\/)/.test(String(station.logoUrl || '')) ? String(station.logoUrl) : null,
  };
}

export function listDashboardCustomStationFolders(stations) {
  const folders = new Set();
  for (const station of Array.isArray(stations) ? stations : []) {
    const folder = String(station?.folder || '').trim();
    if (folder) folders.add(folder);
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

export function filterDashboardCustomStations(stations, { search = '', folder = '' } = {}) {
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const normalizedFolder = String(folder || '').trim().toLowerCase();

  return (Array.isArray(stations) ? stations : [])
    .map(normalizeDashboardCustomStation)
    .filter((station) => !normalizedFolder || station.folder.toLowerCase() === normalizedFolder)
    .filter((station) => {
      if (!normalizedSearch) return true;
      const haystack = [
        station.key,
        station.name,
        station.url,
        station.genre,
        station.folder,
        ...station.tags,
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => {
      const folderCompare = a.folder.localeCompare(b.folder);
      if (folderCompare !== 0) return folderCompare;
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) return nameCompare;
      return a.key.localeCompare(b.key);
    });
}

export function groupDashboardCustomStations(stations) {
  const groups = [];
  const buckets = new Map();

  for (const station of Array.isArray(stations) ? stations : []) {
    const normalized = normalizeDashboardCustomStation(station);
    const groupKey = normalized.folder;
    if (!buckets.has(groupKey)) {
      const group = { folder: groupKey, stations: [] };
      buckets.set(groupKey, group);
      groups.push(group);
    }
    buckets.get(groupKey).stations.push(normalized);
  }

  return groups;
}
