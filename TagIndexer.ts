import { App, CachedMetadata, MetadataCache, TFile, debounce } from "obsidian";
import { FileId } from "./types";
import { normalize, withoutHash } from "./utils";

/**
 * Maintains fast lookups:
 *  - tag -> Set(fileId)
 *  - fileId -> Set(tags)
 */
export class TagIndexer {
  private app: App;
  private tagToFiles = new Map<string, Set<FileId>>();
  private fileToTags = new Map<FileId, Set<string>>();
  private ready = false;

  constructor(app: App) {
    this.app = app;
  }

  isReady() { return this.ready; }

  /** Rebuild everything (onload and big changes) */
  async rebuild() {
    this.tagToFiles.clear();
    this.fileToTags.clear();

    const files = this.app.vault.getMarkdownFiles();
    for (const f of files) {
      try { this.indexFile(f); } catch { /* skip */ }
    }
    this.ready = true;
  }

  /** Incremental update (metadata changed or file deleted) */
  attachWatchers(onReady: () => void) {
    const mc = this.app.metadataCache;

    const safeRebuild = debounce(async () => {
      await this.rebuild();
      onReady();
    }, 500, true);

    // On initial cache resolution
    // @ts-ignore - undocumented hook is widely used
    mc.on("resolved", safeRebuild);

    // Per-file changes
    mc.on("changed", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.indexFile(file);
      onReady();
    });

    // Deleted
    // @ts-ignore - undocumented hook
    mc.on("deleted", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.removeFile(file.path);
      onReady();
    });
  }

  /** Pull all tags (inline + frontmatter) for a file */
  private collectTags(cache: CachedMetadata | null): string[] {
    if (!cache) return [];
    const set = new Set<string>();

    // Inline tags
    const inline = cache.tags ?? [];
    for (const t of inline) {
      if (t?.tag) set.add(normalize(t.tag));
    }

    // Frontmatter: tags / tag
    const fm: any = cache.frontmatter;
    if (fm) {
      const push = (v: any) => {
        if (!v) return;
        if (Array.isArray(v)) v.forEach(x => set.add(normalize(String(x))));
        else set.add(normalize(String(v)));
      };
      push(fm.tags ?? fm.tag);
    }
    return Array.from(set);
  }

  private indexFile(file: TFile) {
    const fileId = file.path;
    const cache = this.app.metadataCache.getFileCache(file);
    const tags = this.collectTags(cache);

    // remove old
    const old = this.fileToTags.get(fileId);
    if (old) {
      for (const tag of old) {
        const bucket = this.tagToFiles.get(tag);
        if (bucket) {
          bucket.delete(fileId);
          if (bucket.size === 0) this.tagToFiles.delete(tag);
        }
      }
    }

    // add new
    const tagSet = new Set(tags);
    this.fileToTags.set(fileId, tagSet);
    for (const tag of tags) {
      let bucket = this.tagToFiles.get(tag);
      if (!bucket) this.tagToFiles.set(tag, (bucket = new Set()));
      bucket.add(fileId);
    }
  }

  private removeFile(fileId: FileId) {
    const old = this.fileToTags.get(fileId);
    if (!old) return;
    for (const tag of old) {
      const bucket = this.tagToFiles.get(tag);
      if (bucket) {
        bucket.delete(fileId);
        if (bucket.size === 0) this.tagToFiles.delete(tag);
      }
    }
    this.fileToTags.delete(fileId);
  }

  /** All known tags */
  allTags(): string[] {
    return Array.from(this.tagToFiles.keys()).sort();
  }

  /** Files having ALL the given tags (AND) */
  filesWithAll(tags: string[]): Set<FileId> {
    if (tags.length === 0) return new Set(); // caller decides default
    
    // For each tag, get files that match either the exact tag or any nested tags
    const sets = tags.map((tag) => {
      const normalizedTag = normalize(tag);
      const exactMatch = this.tagToFiles.get(normalizedTag) ?? new Set<FileId>();
      
      // Also include files with nested tags (e.g., if tag is "area/cybersecurity", 
      // also include "area/cybersecurity/ctf", "area/cybersecurity/news", etc.)
      const nestedMatches = new Set<FileId>();
      for (const [existingTag, fileSet] of this.tagToFiles.entries()) {
        if (existingTag.startsWith(normalizedTag + "/") || existingTag === normalizedTag) {
          for (const fileId of fileSet) {
            nestedMatches.add(fileId);
          }
        }
      }
      
      return nestedMatches;
    });
    
    // Start with smallest for faster intersection
    sets.sort((a, b) => a.size - b.size);
    return sets.reduce((acc, s) => (acc ? intersect(acc, s) : new Set(s))) as Set<FileId>;

    function intersect(a: Set<FileId>, b: Set<FileId>): Set<FileId> {
      if (a.size > b.size) return intersect(b, a);
      const out = new Set<FileId>();
      for (const v of a) if (b.has(v)) out.add(v);
      return out;
    }
  }

  /** Get tags for a file */
  tagsForFile(fileId: FileId): Set<string> {
    return this.fileToTags.get(fileId) ?? new Set();
  }

  /** Co-tag frequencies for the current result set (excluding selected) */
  coTagFrequencies(currentFiles: Set<FileId>, exclude: Set<string>): Map<string, number> {
    const freq = new Map<string, number>();
    for (const fid of currentFiles) {
      const tags = this.fileToTags.get(fid);
      if (!tags) continue;
      for (const t of tags) {
        if (exclude.has(t)) continue;
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }
    return freq;
  }
}

