import { TagMatchMode, TagFilter } from "./types";
import { normalizeTag } from "./utils";

export interface FacetManagerCallbacks {
  onRefresh: () => void;
  onClearSearch: () => void;
}

export class FacetManager {
  private selected = new Map<string, TagMatchMode>();
  private excluded = new Set<string>();
  private callbacks: FacetManagerCallbacks;

  constructor(callbacks: FacetManagerCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Get selected facets
   */
  getSelected(): Map<string, TagMatchMode> {
    return new Map(this.selected);
  }

  /**
   * Get excluded facets
   */
  getExcluded(): Set<string> {
    return new Set(this.excluded);
  }

  /**
   * Check if a facet is selected
   */
  isSelected(tag: string): boolean {
    return this.selected.has(tag);
  }

  /**
   * Check if a facet is excluded
   */
  isExcluded(tag: string): boolean {
    return this.excluded.has(tag);
  }

  /**
   * Add a facet with smart mode selection
   */
  addFacet(tag: string, includeDescendantsByDefault: boolean, hasTagChildren: (tag: string) => boolean): void {
    const n = normalizeTag(tag);
    if (!n) return;

    let mode: TagMatchMode = "exact";
    if (includeDescendantsByDefault && hasTagChildren(n)) {
      mode = "prefix";
    }
    this.selected.set(n, mode);
    
    this.callbacks.onClearSearch();
    this.callbacks.onRefresh();
  }

  /**
   * Add a facet in exact mode
   */
  addFacetExact(tag: string): void {
    const n = normalizeTag(tag);
    if (!n) return;
    
    this.selected.set(n, "exact" as TagMatchMode);
    
    this.callbacks.onClearSearch();
    this.callbacks.onRefresh();
  }

  /**
   * Remove a facet
   */
  removeFacet(tag: string): void {
    const n = normalizeTag(tag);
    this.selected.delete(n);
    this.callbacks.onRefresh();
  }

  /**
   * Toggle between exact and prefix mode for a facet
   */
  toggleFacetMode(tag: string): void {
    const n = normalizeTag(tag);
    const current = this.selected.get(n);
    if (!current) return;
    
    const next: TagMatchMode = current === "exact" ? "prefix" : "exact";
    this.selected.set(n, next);
    
    this.callbacks.onClearSearch();
    this.callbacks.onRefresh();
  }

  /**
   * Add/remove from excluded set
   */
  toggleExcluded(tag: string): void {
    const n = normalizeTag(tag);
    if (this.excluded.has(n)) {
      this.excluded.delete(n);
    } else {
      this.excluded.add(n);
    }
    
    this.callbacks.onClearSearch();
    this.callbacks.onRefresh();
  }

  /**
   * Replace current facets with the provided list
   */
  setFacets(tags: string[], includeDescendantsByDefault: boolean): void {
    const normalized = tags.map(t => normalizeTag(t)).filter(Boolean);
    this.selected.clear();
    this.excluded.clear();
    
    for (const tag of normalized) {
      const mode: TagMatchMode = includeDescendantsByDefault ? "prefix" : "exact";
      this.selected.set(tag, mode);
    }
    
    this.callbacks.onClearSearch();
    this.callbacks.onRefresh();
  }

  /**
   * Clear all facets and exclusions
   */
  clearAll(): void {
    this.selected.clear();
    this.excluded.clear();
    this.callbacks.onRefresh();
  }

  /**
   * Get tag filters for file matching
   */
  getTagFilters(): TagFilter[] {
    return Array.from(this.selected.entries()).map(([tag, mode]) => ({
      tag,
      mode: mode === 'exact' ? 'exact' : 'prefix'
    }));
  }

  /**
   * Check if a file matches the given tag filters
   */
  fileMatches(filters: TagFilter[], fileTags: string[]): boolean {
    // fileTags is the normalized list returned by collectTags() (no # prefix)
    return filters.every(f => {
      const tag = f.tag; // already normalized
      return f.mode === "exact"
        ? fileTags.includes(tag)
        : fileTags.some(t => t === tag || t.startsWith(tag + "/"));
    });
  }

  /**
   * Check if a tag has children in the current co-tags
   */
  hasTagChildren(tag: string, allTags: string[]): boolean {
    // allTags returns normalized values
    return allTags.some(t => t !== tag && t.startsWith(tag + "/"));
  }

  /**
   * Check if a tag node or any of its descendants are currently selected
   */
  hasSelectedDescendants(node: { full: string }): boolean {
    // Check if this exact tag is selected
    if (this.selected.has(node.full) || this.excluded.has(node.full)) {
      return true;
    }
    
    // Check if any descendant tags are selected
    for (const [selectedTag] of this.selected) {
      if (selectedTag.startsWith(node.full + "/")) {
        return true;
      }
    }
    
    // Check if any excluded tags are descendants
    for (const excludedTag of this.excluded) {
      if (excludedTag.startsWith(node.full + "/")) {
        return true;
      }
    }
    
    return false;
  }
}
