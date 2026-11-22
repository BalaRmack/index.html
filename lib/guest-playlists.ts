/** Плейлисты гостя: те же операции, что и в Supabase, но в localStorage браузера. */
export type GuestPlaylist = { id: string; name: string; created_at: string; cover_url?: string | null; track_ids: string[] };

const STORAGE_KEY = 'nocturne.playlists.v1';
export const MAX_PLAYLISTS = 40;
export const MAX_TRACKS = 500;
const MAX_NAME = 100;
const MAX_COVER = 220_000; // data URL маленького превью (240px JPEG) ≈ 15–40 КБ

const str = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isDataUrl = (value: string) => /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(value);

/** Данные из localStorage — недоверенные: фильтруем построчно, чтобы битая запись не уронила приложение. */
export function sanitizePlaylists(raw: unknown): GuestPlaylist[] {
  const rows = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return rows
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}))
    .filter((entry) => {
      const id = str(entry.id, 60);
      const name = str(entry.name, MAX_NAME);
      return !!id && !!name && !seen.has(id) && !!seen.add(id);
    })
    .slice(0, MAX_PLAYLISTS)
    .map((entry) => {
      const ids = Array.isArray(entry.track_ids) ? entry.track_ids.map((id) => str(id, 120)).filter(Boolean) : [];
      const unique = [...new Set(ids)].slice(0, MAX_TRACKS);
      const cover = str(entry.cover_url, MAX_COVER);
      return {
        id: str(entry.id, 60),
        name: str(entry.name, MAX_NAME),
        created_at: str(entry.created_at, 40) || new Date(0).toISOString(),
        cover_url: isDataUrl(cover) ? cover : null,
        track_ids: unique,
      };
    });
}

export function readGuestPlaylists(): GuestPlaylist[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    return sanitizePlaylists(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function writeGuestPlaylists(items: readonly GuestPlaylist[]): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizePlaylists(items)));
    return true;
  } catch {
    return false;
  }
}

/** Возвращает новый список; пустое имя и дубликат названия отклоняются (caller покажет подсказку). */
export function createPlaylist(items: readonly GuestPlaylist[], name: string, id: string): { items: GuestPlaylist[]; playlist: GuestPlaylist | null } {
  const title = str(name, MAX_NAME);
  if (!title || items.some((item) => item.name.toLowerCase() === title.toLowerCase())) return { items: [...items], playlist: null };
  const playlist: GuestPlaylist = { id, name: title, created_at: new Date().toISOString(), cover_url: null, track_ids: [] };
  return { items: [playlist, ...items].slice(0, MAX_PLAYLISTS), playlist };
}

export function renamePlaylist(items: readonly GuestPlaylist[], id: string, name: string): GuestPlaylist[] {
  const title = str(name, MAX_NAME);
  if (!title) return [...items];
  return items.map((item) => (item.id === id ? { ...item, name: title } : item));
}

export function removePlaylist(items: readonly GuestPlaylist[], id: string): GuestPlaylist[] {
  return items.filter((item) => item.id !== id);
}

export function setPlaylistCover(items: readonly GuestPlaylist[], id: string, cover: string | null): GuestPlaylist[] {
  const value = cover && isDataUrl(cover) && cover.length <= MAX_COVER ? cover : null;
  return items.map((item) => (item.id === id ? { ...item, cover_url: value } : item));
}

export function toggleTrackInPlaylist(items: readonly GuestPlaylist[], id: string, trackId: string): { items: GuestPlaylist[]; added: boolean } {
  const track = str(trackId, 120);
  if (!track) return { items: [...items], added: false };
  let added = false;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    const exists = item.track_ids.includes(track);
    if (exists) return { ...item, track_ids: item.track_ids.filter((x) => x !== track) };
    if (item.track_ids.length >= MAX_TRACKS) return item;
    added = true;
    return { ...item, track_ids: [track, ...item.track_ids] };
  });
  return { items: next, added };
}

export function tracksInPlaylist(items: readonly GuestPlaylist[], id: string | null | undefined): string[] {
  if (!id) return [];
  return items.find((item) => item.id === id)?.track_ids ?? [];
}
