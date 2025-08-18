import { App, CachedMetadata, MetadataCache, TFile, debounce, Plugin } from "obsidian";
import { FileId } from "./types";
import { normalize } from "./utils";

export class TagIndexer {
  private app: App;
  private plugin: Plugin;
  private delimiter = "/";
  private ready = false;

  // exact: only as authored; rolled-up: parents + exact
  private exactTagToFiles = new Map<string, Set<FileId>>();
  private tagToFiles = new Map<string, Set<FileId>>();
  private fileToExactTags = new Map<FileId, Set<string>>();

  constructor(app: App, plugin: Plugin) { 
    this.app = app; 
    this.plugin = plugin;
  }

  isReady() { return this.ready; }

  async rebuild() {
    this.exactTagToFiles.clear();
    this.tagToFiles.clear();
    this.fileToExactTags.clear();
    for (const f of this.app.vault.getMarkdownFiles()) this.indexFile(f);
    this.ready = true;
  }

  attachWatchers(onReady: () => void) {
    const { metadataCache: mc, vault } = this.app;
    const safeRebuild = debounce(async () => { await this.rebuild(); onReady(); }, 250, true);

    // Initial resolution
    this.plugin.registerEvent(mc.on("resolved", safeRebuild));

    // File changed
    this.plugin.registerEvent(mc.on("changed", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.indexFile(file);
      onReady();
    }));

    // File deleted
    this.plugin.registerEvent(vault.on("delete", (f) => {
      if (!(f instanceof TFile) || f.extension !== "md") return;
      this.removeFile(f.path);
      onReady();
    }));

    // File created
    this.plugin.registerEvent(vault.on("create", (f) => {
      if (!(f instanceof TFile) || f.extension !== "md") return;
      this.indexFile(f);
      onReady();
    }));

    // File renamed
    this.plugin.registerEvent(vault.on("rename", (f, oldPath) => {
      if (!(f instanceof TFile) || f.extension !== "md") return;
      this.removeFile(oldPath);
      this.indexFile(f);
      onReady();
    }));
  }

  private collectTags(cache: CachedMetadata | null): string[] {
    if (!cache) return [];
    const set = new Set<string>();
    for (const t of cache.tags ?? []) if (t?.tag) set.add(normalize(t.tag));
    const fm: any = cache.frontmatter;
    const push = (v: any) => { if (!v) return; Array.isArray(v) ? v.forEach(x => set.add(normalize(String(x)))) : set.add(normalize(String(v))); };
    if (fm) push(fm.tags ?? fm.tag);
    return Array.from(set);
  }

  private indexFile(file: TFile) {
    const fileId = file.path;
    const cache = this.app.metadataCache.getFileCache(file);
    const nextExact = new Set(this.collectTags(cache));

    // diff old vs new to minimize churn
    const prevExact = this.fileToExactTags.get(fileId) ?? new Set();

    // remove prev
    for (const t of prevExact) {
      const b = this.exactTagToFiles.get(t); if (b) { b.delete(fileId); if (!b.size) this.exactTagToFiles.delete(t); }
      // rolled-up parents
      for (const p of this.parentsOf(t)) {
        const bb = this.tagToFiles.get(p); if (bb) { bb.delete(fileId); if (!bb.size) this.tagToFiles.delete(p); }
      }
    }

    // add new
    this.fileToExactTags.set(fileId, nextExact);
    for (const t of nextExact) {
      let be = this.exactTagToFiles.get(t); if (!be) this.exactTagToFiles.set(t, be = new Set());
      be.add(fileId);
      for (const p of this.parentsOf(t)) {
        let br = this.tagToFiles.get(p); if (!br) this.tagToFiles.set(p, br = new Set());
        br.add(fileId);
      }
    }
  }

  private removeFile(fileId: FileId) {
    const exact = this.fileToExactTags.get(fileId); if (!exact) return;
    for (const t of exact) {
      const be = this.exactTagToFiles.get(t); if (be) { be.delete(fileId); if (!be.size) this.exactTagToFiles.delete(t); }
      for (const p of this.parentsOf(t)) {
        const br = this.tagToFiles.get(p); if (br) { br.delete(fileId); if (!br.size) this.tagToFiles.delete(p); }
      }
    }
    this.fileToExactTags.delete(fileId);
  }

  private parentsOf(tag: string): string[] {
    const parts = tag.split(this.delimiter).filter(Boolean);
    const out: string[] = [];
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc = i === 0 ? parts[0] : `${acc}${this.delimiter}${parts[i]}`;
      out.push(acc);
    }
    return out;
  }

  allTags(): string[] { return Array.from(this.tagToFiles.keys()).sort(); }

  filesWithAll(tags: string[], exacts: Set<string>): Set<FileId> {
    if (!tags.length) return new Set();
    const sets = tags.map(t => {
      const key = t.toLowerCase();
      return exacts.has(key) ? (this.exactTagToFiles.get(key) ?? new Set<FileId>())
                             : (this.tagToFiles.get(key) ?? new Set<FileId>());
    }).sort((a,b) => a.size - b.size);
    return sets.reduce((acc, s) => acc ? intersect(acc, s) : new Set(s)) as Set<FileId>;
    function intersect(a: Set<FileId>, b: Set<FileId>) {
      if (a.size > b.size) return intersect(b, a);
      const out = new Set<FileId>(); for (const v of a) if (b.has(v)) out.add(v); return out;
    }
  }

  exactTagsForFile(fileId: FileId): Set<string> {
    return this.fileToExactTags.get(fileId) ?? new Set();
  }

  coTagFrequencies(currentFiles: Set<FileId>, exclude: Set<string>): Map<string, number> {
    const freq = new Map<string, number>();
    for (const fid of currentFiles) {
      const tags = this.fileToExactTags.get(fid); if (!tags) continue;
      for (const t of tags) { if (exclude.has(t)) continue; freq.set(t, (freq.get(t) ?? 0) + 1); }
    }
    return freq;
  }
}

