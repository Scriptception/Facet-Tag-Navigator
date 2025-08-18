export function withoutHash(tag: string): string {
  return tag.startsWith("#") ? tag.slice(1) : tag;
}

export function normalize(tag: string): string {
  // normalize to lowercase; keep slashes for nesting
  return withoutHash(tag).trim().replace(/\s+/g, "-").toLowerCase();
}

export function intersectSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  if (a.size > b.size) return intersectSets(b, a);
  const out = new Set<T>();
  for (const v of a) if (b.has(v)) out.add(v);
  return out;
}

export function unionAll<T>(sets: Iterable<Set<T>>): Set<T> {
  const out = new Set<T>();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}

export function sortedByCountDesc(map: Map<string, number>): [string, number][] {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function firstSegment(tag: string): string {
  const i = tag.indexOf("/");
  return i === -1 ? tag : tag.slice(0, i);
}

