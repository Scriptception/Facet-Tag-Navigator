import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { TagIndexer } from "./TagIndexer";
import { FacetNavigatorSettings, SavedView } from "./types";
import { buildTagTree, sortNodes, TagTreeNode } from "./utils";
import { InputModal } from "./InputModal";

export const VIEW_TYPE_FACET_NAV = "facet-navigator-view";

export class FacetNavigatorView extends ItemView {
  private indexer: TagIndexer;
  private settings: FacetNavigatorSettings;

  // Facet selection: Map<tag, "exact"|"descendants"> for exact vs nested mode
  private selected = new Map<string, "exact" | "descendants">();
  private excluded = new Set<string>(); // NOT facets
  private currentFiles = new Set<string>(); // result set
  private searchQuery = ""; // current search filter

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
    this.excluded.clear();
    this.searchQuery = "";
    if (this.searchInput) this.searchInput.value = "";
    this.refresh();
  }

  /** Add a facet with default mode based on settings */
  addFacet(tag: string) {
    const n = tag.toLowerCase();
    if (!n) return;
    
    const mode = this.settings.includeDescendantsByDefault ? "descendants" : "exact";
    this.selected.set(n, mode);
    
    // Clear search input when adding a facet
    this.searchQuery = "";
    if (this.searchInput) {
      this.searchInput.value = "";
    }
    
    this.refresh();
  }

  /** Add a facet in exact mode */
  addFacetExact(tag: string) {
    const n = tag.toLowerCase();
    if (!n) return;
    
    this.selected.set(n, "exact");
    
    // Clear search input when adding a facet
    this.searchQuery = "";
    if (this.searchInput) {
      this.searchInput.value = "";
    }
    
    this.refresh();
  }

  /** Remove a facet */
  removeFacet(tag: string) {
    const n = tag.toLowerCase();
    this.selected.delete(n);
    this.refresh();
  }

  /** Toggle between exact and descendants mode for a facet */
  toggleFacetMode(tag: string) {
    const n = tag.toLowerCase();
    const current = this.selected.get(n);
    if (!current) return;
    
    const newMode = current === "exact" ? "descendants" : "exact";
    this.selected.set(n, newMode);
    
    // Clear search input when toggling facet modes
    this.searchQuery = "";
    if (this.searchInput) {
      this.searchInput.value = "";
    }
    
    this.refresh();
  }

  /** Add/remove from excluded set */
  toggleExcluded(tag: string) {
    const n = tag.toLowerCase();
    if (this.excluded.has(n)) {
      this.excluded.delete(n);
    } else {
      this.excluded.add(n);
    }
    
    // Clear search input when toggling excluded facets
    this.searchQuery = "";
    if (this.searchInput) {
      this.searchInput.value = "";
    }
    
    this.refresh();
  }

  /** Replace current facets with the provided list and refresh once */
  setFacets(tags: string[]) {
    const normalized = tags.map(t => t.toLowerCase()).filter(Boolean);
    this.selected.clear();
    this.excluded.clear();
    
    for (const tag of normalized) {
      const mode = this.settings.includeDescendantsByDefault ? "descendants" : "exact";
      this.selected.set(tag, mode);
    }
    
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
      if (this.settings.startEmpty) {
        // Show no results, just co-tag panel derived from allTags()
        this.currentFiles = new Set();
      } else {
        // Legacy behavior: show union of all files with any tag
        const allFiles = new Set<string>();
        for (const tag of this.indexer.allTags()) {
          const set = this.indexer.filesWithAll([tag], new Set());
          for (const f of set) allFiles.add(f);
        }
        this.currentFiles = allFiles;
      }
    } else {
      // Get included files
      const includedTags = Array.from(this.selected.keys());
      const exactTags = new Set(
        Array.from(this.selected.entries())
          .filter(([_, mode]) => mode === "exact")
          .map(([tag, _]) => tag)
      );
      
      this.currentFiles = this.indexer.filesWithAll(includedTags, exactTags);
      
      // Subtract excluded files
      if (this.excluded.size > 0) {
        const excludedFiles = this.indexer.filesWithAll(Array.from(this.excluded), new Set());
        for (const fileId of excludedFiles) {
          this.currentFiles.delete(fileId);
        }
      }
    }

    this.renderBar();
    this.renderCoTags();
    this.renderResults();
  }

  private renderBar() {
    this.barEl.empty();

    if (this.selected.size === 0 && this.excluded.size === 0) {
      const hint = this.barEl.createSpan({ 
        text: "Select a tag from the left to start drilling down.", 
        cls: "muted" 
      });
      hint.style.marginRight = "auto";
      return;
    }

    // Render included facets
    for (const [tag, mode] of this.selected) {
      const chip = this.barEl.createDiv({ cls: "facet-chip" });
      const label = chip.createSpan({ text: tag });
      const modeIndicator = chip.createSpan({ 
        text: mode === "exact" ? " (exact)" : " (nested)", 
        cls: "mode-indicator" 
      });
      const x = chip.createSpan({ text: "✕", cls: "remove" });
      
      // Right-click to toggle mode
      chip.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.toggleFacetMode(tag);
      });
      
      // Click to remove
      x.addEventListener("click", () => this.removeFacet(tag));
      
      // Tooltip
      chip.setAttr("title", `Right-click to toggle ${mode === "exact" ? "nested" : "exact"} mode`);
    }

    // Render excluded facets
    for (const tag of this.excluded) {
      const chip = this.barEl.createDiv({ cls: "facet-chip excluded" });
      chip.createSpan({ text: `NOT ${tag}` });
      const x = chip.createSpan({ text: "✕", cls: "remove" });
      x.addEventListener("click", () => this.toggleExcluded(tag));
      chip.setAttr("title", "Excluded facet - click to remove");
    }
  }

  private renderCoTags() {
    this.coTagsEl.empty();

    // Build frequency map excluding selected and excluded facets
    const exclude = new Set([...this.selected.keys(), ...this.excluded]);
    const coFreq = this.indexer.coTagFrequencies(this.currentFiles, exclude);
    
    if (coFreq.size === 0) {
      this.coTagsEl.createDiv({ text: "No co-tags. Adjust selection.", cls: "muted" });
      return;
    }

    // Filter by search query if present
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

    // Build hierarchical tree
    const treeRoots = buildTagTree(filteredFreq, "/");

    if (this.settings.showNamespaceHeaders) {
      // Group by namespace
      const groupKeys = Array.from(treeRoots.keys()).sort((a, b) => a.localeCompare(b));
      
      for (const ns of groupKeys) {
        const nsNode = treeRoots.get(ns)!;
        const section = this.coTagsEl.createDiv({ cls: "group" });
        section.createEl("h4", { text: ns });
        
        // Render children of the namespace
        const children = sortNodes(nsNode.children.values(), this.settings.coTagSort);
        const expandDefault = Boolean(this.searchQuery) || this.selected.size > 0 || this.excluded.size > 0;
        for (const child of children) {
          this.renderTreeNode(section, child, 0, expandDefault);
        }
      }
    } else {
      // Flat list
      const allNodes = Array.from(treeRoots.values());
      const sortedNodes = sortNodes(allNodes, this.settings.coTagSort);
      const expandDefault = Boolean(this.searchQuery) || this.selected.size > 0 || this.excluded.size > 0;
      
      for (const node of sortedNodes) {
        this.renderTreeNode(this.coTagsEl, node, 0, expandDefault);
      }
    }
  }

  /**
   * Render a TagTreeNode (and its descendants) as clickable rows.
   * Clicking any node adds that node.full as a facet.
   */
  private renderTreeNode(container: HTMLElement, node: TagTreeNode, depth: number, expandDefault: boolean) {
    const row = container.createDiv({ cls: "tag-row" });
    row.style.paddingLeft = `${depth * 14}px`;

    // Disclosure affordance if the node has children
    const hasKids = node.children.size > 0;
    const caret = hasKids ? row.createSpan({ text: "▸ " }) : row.createSpan({ text: "  " });
    caret.style.opacity = hasKids ? "0.8" : "0";

    const label = row.createSpan({ text: node.label });
    const badge = row.createSpan({ text: String(node.count), cls: "badge" });

    // Tooltip shows the full tag path and mode info
    const exactNote = node.exactCount === 0 ? " (no exact tags; rolled-up)" : "";
    label.setAttr("title", `${node.full}${exactNote}\nClick to add facet\nRight-click to toggle exact/nested mode\nAlt+click to exclude`);

    // Handle expand/collapse first
    let expanded = expandDefault;
    let childWrap: HTMLElement | null = null;
    
    if (hasKids) {
      childWrap = container.createDiv();
      childWrap.style.display = expanded ? "" : "none";

      // Render children
      const kids = sortNodes(node.children.values(), this.settings.coTagSort);
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

    // Right-click to toggle exact/nested mode
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleFacetMode(node.full);
    });

    // Alt+click to exclude
    row.addEventListener("auxclick", (e) => {
      if (e.button === 1) { // middle click
        e.preventDefault();
        this.toggleExcluded(node.full);
      }
    });
  }

  private renderResults() {
    this.resultsEl.empty();

    const total = this.currentFiles.size;
    const head = this.resultsEl.createDiv();
    head.createEl("h4", { text: `Results (${total})` });

    if (total === 0) {
      if (this.selected.size === 0 && this.settings.startEmpty) {
        this.resultsEl.createDiv({ 
          text: "Select a tag to start browsing. Use the left panel to explore available tags.", 
          cls: "muted" 
        });
      } else {
        this.resultsEl.createDiv({ text: "No notes match the current facets.", cls: "muted" });
      }
      return;
    }

    // Virtualize results
    const files = Array.from(this.currentFiles)
      .map(p => this.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile)
      .sort((a, b) => a.basename.localeCompare(b.basename));

    const pageSize = this.settings.resultsPageSize;
    let rendered = 0;

    const renderMore = () => {
      const end = Math.min(rendered + pageSize, files.length);
      for (let i = rendered; i < end; i++) {
        this.renderResultItem(list, files[i]);
      }
      rendered = end;
    };

    const list = this.resultsEl.createDiv();
    renderMore();

    if (rendered < files.length) {
      const more = this.resultsEl.createEl("button", { 
        text: `Load more (${files.length - rendered})`,
        cls: "load-more-btn"
      });
      more.onclick = () => { 
        more.remove(); 
        renderMore(); 
        if (rendered < files.length) {
          this.resultsEl.append(more);
        }
      };
    }
  }

  private renderResultItem(container: HTMLElement, file: TFile) {
    const item = container.createDiv({ cls: "result-item" });
    
    const link = item.createEl("a", { text: file.basename, href: "#" });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.workspace.getLeaf(true).openFile(file);
    });

    const meta = item.createDiv({ cls: "result-meta" });
    meta.setText(`${file.path}`);

    // Show tags for this file
    const fileTags = this.indexer.exactTagsForFile(file.path);
    if (fileTags.size > 0) {
      const tagsContainer = item.createDiv({ cls: "file-tags" });
      for (const tag of Array.from(fileTags).slice(0, 5)) { // Limit to 5 tags
        const tagChip = tagsContainer.createSpan({ text: tag, cls: "file-tag" });
        tagChip.addEventListener("click", () => this.addFacet(tag));
        tagChip.setAttr("title", `Click to add ${tag} as a facet`);
      }
      if (fileTags.size > 5) {
        tagsContainer.createSpan({ text: `+${fileTags.size - 5} more`, cls: "more-tags" });
      }
    }
  }

  /** Persist current selection as a Saved View */
  private saveView() {
    const tags = Array.from(this.selected.keys());
    if (tags.length === 0) { 
      new Notice("Select at least one tag."); 
      return; 
    }

    const suggested = `view-${new Date().toISOString().slice(0,10)}`;
    
    new InputModal(this.app, "Saved view name", suggested, (name) => {
      const existing = this.settings.savedViews.find(v => v.name === name);
      if (existing) {
        existing.tags = tags;
        if (this.excluded.size > 0) {
          existing.exclude = Array.from(this.excluded);
        }
      } else {
        const newView: SavedView = { 
          name, 
          tags,
          exclude: this.excluded.size > 0 ? Array.from(this.excluded) : undefined
        };
        this.settings.savedViews.push(newView);
      }

      // Persist settings via the owning plugin
      // @ts-ignore
      this.app.plugins.getPlugin("facet-tag-navigator")?.saveSettings?.();
      new Notice(`Saved view: ${name}`);
    }).open();
  }

  /** Generate a core search query */
  private exportQuery() {
    if (this.selected.size === 0) { 
      new Notice("No facets selected."); 
      return; 
    }
    
    const included = Array.from(this.selected.entries())
      .map(([tag, mode]) => mode === "exact" ? `tag:#${tag}` : `tag:#${tag}*`);
    const excluded = Array.from(this.excluded).map(tag => `-tag:#${tag}`);
    
    const q = [...included, ...excluded].join(" ");
    navigator.clipboard.writeText(q).catch(() => {/* ignore */});
    new Notice("Copied search query to clipboard.");
  }

  /** Filter co-tags based on search query */
  private filterCoTags(query: string) {
    this.searchQuery = query;
    this.renderCoTags();
  }

  /** Check if a tag node or any of its descendants are currently selected */
  private hasSelectedDescendants(node: TagTreeNode): boolean {
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
    
    // Recursively check children
    for (const child of node.children.values()) {
      if (this.hasSelectedDescendants(child)) {
        return true;
      }
    }
    
    return false;
  }
}

