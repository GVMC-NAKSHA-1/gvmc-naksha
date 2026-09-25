// OGC API – Features paging helpers (limit / offset / bbox → SQL + links).

export const MAX_LIMIT = 1000;
export const DEFAULT_LIMIT = 100;

export function parsePaging(limit?: string, offset?: string) {
  const l = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(limit ?? '', 10) || DEFAULT_LIMIT));
  const o = Math.max(0, Number.parseInt(offset ?? '', 10) || 0);
  return { limit: l, offset: o };
}

/** "minLon,minLat,maxLon,maxLat" → numbers, or null. Throws on malformed input. */
export function parseBbox(bbox?: string): [number, number, number, number] | null {
  if (!bbox) return null;
  const v = bbox.split(',').map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n)) || v[0] > v[2] || v[1] > v[3])
    throw new Error('bbox must be minLon,minLat,maxLon,maxLat');
  return v as [number, number, number, number];
}

export function pageLinks(baseUrl: string, query: Record<string, string | undefined>, limit: number, offset: number, matched: number) {
  const url = (o: number) => {
    const qs = new URLSearchParams(
      Object.entries({ ...query, limit: String(limit), offset: String(o) }).filter(([, v]) => v != null) as [string, string][],
    );
    return `${baseUrl}?${qs}`;
  };
  const links = [{ rel: 'self', type: 'application/geo+json', href: url(offset) }];
  if (offset + limit < matched) links.push({ rel: 'next', type: 'application/geo+json', href: url(offset + limit) });
  if (offset > 0) links.push({ rel: 'prev', type: 'application/geo+json', href: url(Math.max(0, offset - limit)) });
  return links;
}
