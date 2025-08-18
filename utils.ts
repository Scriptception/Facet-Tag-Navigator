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

// Tag tree utilities for hierarchical co-tag display
export interface TagTreeNode {
  label: string;             // segment label, e.g. "cyberdefenders"
  full: string;              // full path up to this node, e.g. "category/ctf/cyberdefenders"
  count: number;             // rolled-up count (sum of all descendants)
  exactCount: number;        // count for this exact tag (0 if none)
  children: Map<string, TagTreeNode>;
}

// Build a hierarchical tree from a frequency map of tags.
// freq: Map<"a/b/c", count>. Parents are created and get rolled-up counts.
export function buildTagTree(
  freq: Map<string, number>,
  delimiter = "/"
): Map<string, TagTreeNode> {
  const roots = new Map<string, TagTreeNode>();

  for (const [tag, n] of freq) {
    const parts = tag.split(delimiter).filter(Boolean);
    if (!parts.length) continue;

    let acc = "";
    let layer = roots;

    for (let i = 0; i < parts.length; i++) {
      acc = i === 0 ? parts[0] : `${acc}${delimiter}${parts[i]}`;
      const seg = parts[i];

      let node = layer.get(seg);
      if (!node) {
        node = { label: seg, full: acc, count: 0, exactCount: 0, children: new Map() };
        layer.set(seg, node);
      }

      node.count += n;                    // roll-up
      if (i === parts.length - 1) node.exactCount += n;  // leaf contributes exact count

      layer = node.children;
    }
  }
  return roots;
}

// Optional: sort helpers for stable rendering
export function sortNodes(
  nodes: Iterable<TagTreeNode>,
  mode: "count" | "alpha" = "count"
): TagTreeNode[] {
  const arr = Array.from(nodes);
  if (mode === "alpha") return arr.sort((a, b) => a.label.localeCompare(b.label));
  return arr.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

