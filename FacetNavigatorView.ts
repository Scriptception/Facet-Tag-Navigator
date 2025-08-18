import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { TagIndexer } from "./TagIndexer";
import { FacetNavigatorSettings, SavedView } from "./types";
import { firstSegment, normalize, sortedByCountDesc } from "./utils";

export const VIEW_TYPE_FACET_NAV = "facet-navigator-view";

export class FacetNavigatorView extends ItemView {
  private indexer: TagIndexer;
  private settings: FacetNavigatorSettings;

  private selected = new Set<string>();    // current facets (AND)
  private currentFiles = new Set<string>(); // result set
  private searchQuery = "";                // current search filter

  // UI roots
  private rootEl!: HTMLElement;
  private barEl!: HTMLElement;
  private controlsEl!: HTMLElement;
  private searchEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private coTagsEl!: HTMLElement;
  private resultsEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, app: App, indexer: TagIndexer, settings: FacetNavigatorSettings) {
    super(leaf);
    this.app = app;
    this.indexer = indexer;
    this.settings = settings;
  }

  getViewType() { return VIEW_TYPE_FACET_NAV; }
  getDisplayText() { return "Facet Navigator"; }
  getIcon() { return "filter"; }

  async onOpen() {
    this.rootEl = this.containerEl.createDiv({ cls: "facet-nav" });

    // Bar = chips + controls
    this.barEl = this.rootEl.createDiv({ cls: "facet-bar" });
    this.controlsEl = this.rootEl.createDiv({ cls: "facet-controls" });

    // Controls: Save View / Export / Clear
    const btnSave = this.controlsEl.createEl("button", { text: "Save View" });
    btnSave.addEventListener("click", () => this.saveView());
    const btnExport = this.controlsEl.createEl("button", { text: "Export Query" });
    btnExport.addEventListener("click", () => this.exportQuery());
    const btnClear = this.controlsEl.createEl("button", { text: "Clear" });
    btnClear.addEventListener("click", () => this.clearAll());

    // Search box above everything
    this.searchEl = this.rootEl.createDiv({ cls: "search-section" });
    const searchContainer = this.searchEl.createDiv({ cls: "search-container" });
    this.searchInput = searchContainer.createEl("input", { 
      type: "text", 
      placeholder: "Search tags...",
      cls: "search-input"
    });
    
    // Add search functionality
    this.searchInput.addEventListener("input", (e) => {
      const query = (e.target as HTMLInputElement).value.toLowerCase();
      this.searchQuery = query;
      this.filterCoTags(query);
    });

    // Main: left co-tags, right results
    const main = this.rootEl.createDiv({ cls: "facet-main" });
    
    this.coTagsEl = main.createDiv({ cls: "co-tags" });
    this.resultsEl = main.createDiv({ cls: "results" });

    // Initial render
    this.refresh();
  }

  async onClose() {}

  /** External: reset selection */
  clearAll() {
    this.selected.clear();
    this.searchQuery = ""; // Clear search query when clearing all facets
    this.searchInput.value = ""; // Clear search input field
    this.refresh();
  }

  /** Add a facet */
  addFacet(tag: string) {
    const n = normalize(tag);
    if (!n) return;
    this.selected.add(n);
    this.refresh();
  }

  /** Remove a facet */
  removeFacet(tag: string) {
    const n = normalize(tag);
    this.selected.delete(n);
    this.refresh();
  }

  /** Build the currentFiles and repaint panels */
  refresh() {
    if (!this.indexer.isReady()) {
      this.resultsEl.setText("Indexing…");
      return;
    }

    // Compute result set from selected facets
    if (this.selected.size === 0) {
      // If nothing selected: show union of all files with any tag, so we can surface global co-tags.
      const allFiles = new Set<string>();
      for (const tag of this.indexer.allTags()) {
        const set = this.indexer.filesWithAll([tag]);
        for (const f of set) allFiles.add(f);
      }
      this.currentFiles = allFiles;
    } else {
      this.currentFiles = this.indexer.filesWithAll(Array.from(this.selected));
    }

    this.renderBar();
    this.renderCoTags();
    this.renderResults();
  }

  private renderBar() {
    this.barEl.empty();

    if (this.selected.size === 0) {
      const hint = this.barEl.createSpan({ text: "Select a tag from the left to start drilling down.", cls: "muted" });
      hint.style.marginRight = "auto";
    }

    for (const t of this.selected) {
      const chip = this.barEl.createDiv({ cls: "facet-chip" });
      chip.createSpan({ text: t });
      const x = chip.createSpan({ text: "✕", cls: "remove" });
      x.addEventListener("click", () => this.removeFacet(t));
    }
  }

  private renderCoTags() {
    this.coTagsEl.empty();

    // Frequencies excluding currently selected
    const coFreq = this.indexer.coTagFrequencies(this.currentFiles, this.selected);
    const entries = sortedByCountDesc(coFreq);
    if (entries.length === 0) {
      this.coTagsEl.createDiv({ text: "No co-tags. Adjust selection.", cls: "muted" });
      return;
    }

    // Filter by search query if present
    const filteredEntries = this.searchQuery 
      ? entries.filter(([tag]) => tag.toLowerCase().includes(this.searchQuery.toLowerCase()))
      : entries;

    if (filteredEntries.length === 0) {
      this.coTagsEl.createDiv({ text: "No tags match the search query.", cls: "muted" });
      return;
    }

    // Group either by namespace (segment[0]) or by root segment
    const groups = new Map<string, [string, number][]>();
    const grouper = (t: string) => this.settings.groupMode === "namespace" ? firstSegment(t) : firstSegment(t);

    for (const [tag, n] of filteredEntries) {
      const k = grouper(tag);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push([tag, n]);
    }

    for (const [g, list] of groups) {
      const section = this.coTagsEl.createDiv({ cls: "group" });
      section.createEl("h4", { text: g });

      for (const [tag, count] of list.slice(0, this.settings.maxCoTags)) {
        const row = section.createDiv({ cls: "tag-row" });
        const label = row.createSpan({ text: tag });
        const badge = row.createSpan({ text: String(count), cls: "badge" });

        row.addEventListener("click", () => this.addFacet(tag));
        label.setAttr("title", "Click to add as facet");
      }
    }
  }

  private renderResults() {
    this.resultsEl.empty();

    const total = this.currentFiles.size;
    const head = this.resultsEl.createDiv();
    head.createEl("h4", { text: `Results (${total})` });

    if (total === 0) {
      this.resultsEl.createDiv({ text: "No notes match the current facets.", cls: "muted" });
      return;
    }

    // Render items
    const files = Array.from(this.currentFiles)
      .map(p => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile)
      .sort((a, b) => a.basename.localeCompare(b.basename));

    for (const f of files) {
      const item = this.resultsEl.createDiv({ cls: "result-item" });
      const link = item.createEl("a", { text: f.basename, href: "#" });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        this.app.workspace.getLeaf(true).openFile(f);
      });

      const meta = item.createDiv({ cls: "result-meta" });
      meta.setText(`${f.path}`);
    }
  }

  /** Persist current selection as a Saved View */
  private saveView() {
    const name = prompt("Save current facets as view name:");
    if (!name) return;
    const tags = Array.from(this.selected);
    if (tags.length === 0) { new Notice("Select at least one tag."); return; }

    const existing = this.settings.savedViews.find(v => v.name === name);
    if (existing) existing.tags = tags;
    else this.settings.savedViews.push({ name, tags });

    // @ts-ignore
    this.app.plugins.getPlugin("facet-navigator")?.saveSettings?.();
    new Notice(`Saved view: ${name}`);
  }

  /** Generate a core search query */
  private exportQuery() {
    if (this.selected.size === 0) { new Notice("No facets selected."); return; }
    const q = Array.from(this.selected).map(t => `tag:#${t}`).join(" ");
    navigator.clipboard.writeText(q).catch(() => {/* ignore */});
    new Notice("Copied search query to clipboard.");
  }

  /** Filter co-tags based on search query */
  private filterCoTags(query: string) {
    this.searchQuery = query;
    this.renderCoTags();
  }
}

