import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { TagIndexer } from "./TagIndexer";
import { FacetNavigatorSettings, SavedView } from "./types";
import { firstSegment, normalize, sortedByCountDesc, buildTagTree, sortNodes, TagTreeNode } from "./utils";
import { InputModal } from "./InputModal";

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
    console.log(`addFacet called with tag: ${tag}`);
    const n = normalize(tag);
    console.log(`Normalized tag: ${n}`);
    if (!n) {
      console.log(`Tag normalization failed for: ${tag}`);
      return;
    }
    this.selected.add(n);
    console.log(`Added tag to selected set. Current selected:`, Array.from(this.selected));
    this.refresh();
    console.log(`Refresh called`);
  }

  /** Remove a facet */
  removeFacet(tag: string) {
    const n = normalize(tag);
    this.selected.delete(n);
    this.refresh();
  }

  /** Replace current facets with the provided list and refresh once */
  setFacets(tags: string[]) {
    const normalized = tags
      .map(t => normalize(t))
      .filter((t): t is string => Boolean(t));
    this.selected = new Set(normalized);
    // Reset any search filter and input UI
    this.searchQuery = "";
    if (this.searchInput) this.searchInput.value = "";
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

    // 1) Build frequency map excluding selected facets
    const exclude = new Set(this.selected.keys());
    const coFreq = this.indexer.coTagFrequencies(this.currentFiles, exclude);
    if (coFreq.size === 0) {
      this.coTagsEl.createDiv({ text: "No co-tags. Adjust selection.", cls: "muted" });
      return;
    }

    // 2) Filter by search query if present
    let filteredFreq = coFreq;
    if (this.searchQuery) {
      filteredFreq = new Map();
      for (const [tag, count] of coFreq) {
        if (tag.toLowerCase().includes(this.searchQuery.toLowerCase())) {
          filteredFreq.set(tag, count);
        }
      }
      if (filteredFreq.size === 0) {
        this.coTagsEl.createDiv({ text: "No tags match the search query.", cls: "muted" });
        return;
      }
    }

    // 3) Build a full tree from current co-tags
    const treeRoots = buildTagTree(filteredFreq, "/");

    // 4) Group by the first segment (namespace), preserving your existing structure
    const groupKeys = Array.from(treeRoots.keys()).sort((a, b) => a.localeCompare(b));

    for (const ns of groupKeys) {
      const nsNode = treeRoots.get(ns)!;

      const section = this.coTagsEl.createDiv({ cls: "group" });
      section.createEl("h4", { text: ns });

      // Render children of the namespace as the first visible level:
      const children = sortNodes(nsNode.children.values(), "count");
      const expandDefault = Boolean(this.searchQuery);
      for (const child of children) {
        this.renderTreeNode(section, child, 0, expandDefault);
      }
    }
  }

  /**
   * Render a TagTreeNode (and its descendants) as clickable rows.
   * Clicking any node adds that node.full as a facet (parent matches descendants via roll-up index).
   */
  private renderTreeNode(container: HTMLElement, node: TagTreeNode, depth: number, expandDefault: boolean) {
    const row = container.createDiv({ cls: "tag-row" });
    row.style.paddingLeft = `${depth * 14}px`;

    // Optional: disclosure affordance if the node has children
    const hasKids = node.children.size > 0;
    const caret = hasKids ? row.createSpan({ text: "▸ " }) : row.createSpan({ text: "  " });
    caret.style.opacity = hasKids ? "0.8" : "0";

    const label = row.createSpan({ text: node.label });
    const badge = row.createSpan({ text: String(node.count), cls: "badge" });

    // Tooltip shows the full tag path; clarify if the node has no exact matches
    const exactNote = node.exactCount === 0 ? " (no exact tags; rolled-up)" : "";
    label.setAttr("title", `${node.full}${exactNote}`);

    // Handle expand/collapse first
    let expanded = expandDefault;
    let childWrap: HTMLElement | null = null;
    if (hasKids) {
      childWrap = container.createDiv(); // created regardless; we toggle display
      childWrap.style.display = expanded ? "" : "none";

      // Render children (initially collapsed)
      const kids = sortNodes(node.children.values(), "count");
      for (const kid of kids) {
        this.renderTreeNode(childWrap, kid, depth + 1, expandDefault);
      }

      const toggleExpand = () => {
        expanded = !expanded;
        if (childWrap) childWrap.style.display = expanded ? "" : "none";
        caret.setText(expanded ? "▾ " : "▸ ");
      };

      // Click to expand/collapse with timeout to distinguish from double-click
      let clickTimeout: number | null = null;
      row.addEventListener("click", () => {
        if (clickTimeout !== null) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
          // Do nothing here; dblclick handler will add the facet
          return;
        }
        clickTimeout = setTimeout(() => {
          clickTimeout = null;
          toggleExpand();
        }, 200);
      });

      // Double-click to add facet (and prevent the expand action)
      row.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Cancel pending single-click expand
        if (clickTimeout !== null) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
        }
        this.addFacet(node.full);
      });
    } else {
      // Non-expandable items: single click adds the tag
      row.addEventListener("click", () => {
        this.addFacet(node.full);
      });
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
    const tags = Array.from(this.selected);
    if (tags.length === 0) { 
      new Notice("Select at least one tag."); 
      return; 
    }

    const suggested = `view-${new Date().toISOString().slice(0,10)}`;
    
    new InputModal(this.app, "Saved view name", suggested, (name) => {
      const existing = this.settings.savedViews.find(v => v.name === name);
      if (existing) existing.tags = tags;
      else this.settings.savedViews.push({ name, tags });

      console.log(`Saving view "${name}" with tags:`, tags);
      console.log(`Current saved views:`, this.settings.savedViews);

      // Persist settings via the owning plugin (id must match manifest.json)
      // @ts-ignore
      this.app.plugins.getPlugin("facet-tag-navigator")?.saveSettings?.();
      new Notice(`Saved view: ${name}`);
    }).open();
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

