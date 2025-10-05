import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { TagIndexer } from "./TagIndexer";
import { FacetNavigatorSettings, SavedView, TagMatchMode, TagFilter } from "./types";
import { TagTreeNode, normalizeTag } from "./utils";
import { InputModal } from "./InputModal";
import { ExpansionManager } from "./ExpansionManager";
import { SlashCommandHandler } from "./SlashCommandHandler";
import { KeyboardNavigator, FocusMode } from "./KeyboardNavigator";
import { TagRenderer } from "./TagRenderer";
import { ResultsRenderer } from "./ResultsRenderer";
import { FacetManager } from "./FacetManager";

export const VIEW_TYPE_FACET_NAV = "facet-navigator-view";

export class FacetNavigatorView extends ItemView {
  private indexer: TagIndexer;
  private settings: FacetNavigatorSettings;

  // Modular components
  private facetManager: FacetManager;
  private expansionManager: ExpansionManager;
  private keyboardNavigator: KeyboardNavigator;
  private tagRenderer: TagRenderer;
  private resultsRenderer: ResultsRenderer;
  private slashCommandHandler: SlashCommandHandler;

  // Core state
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
  private btnToggleExpansion!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, app: App, indexer: TagIndexer, settings: FacetNavigatorSettings) {
    super(leaf);
    this.indexer = indexer;
    this.settings = settings;

    // Initialize modular components
    this.facetManager = new FacetManager({
      onRefresh: () => this.refresh(),
      onClearSearch: () => {
        this.searchQuery = "";
        if (this.searchInput) this.searchInput.value = "";
      }
    });

    this.expansionManager = new ExpansionManager();

    this.keyboardNavigator = new KeyboardNavigator({
      onFocusSearch: () => this.focusSearch(),
      onFocusFirstTag: () => this.focusFirstTag(),
      onFocusResults: () => this.focusResults(),
      onSelectCurrentTag: () => this.selectCurrentTag(),
      onExcludeCurrentTag: () => this.excludeCurrentTag(),
      onExpandCurrentTag: () => this.expandCurrentTag(),
      onCollapseCurrentTag: () => this.collapseCurrentTag(),
      onOpenCurrentResult: () => this.openCurrentResult(),
      onSearchEnter: () => this.handleSearchEnter(),
      onSlashCommandStart: (e) => this.slashCommandHandler.startSlashCommand(this.searchInput),
      onFocusNextTag: () => this.focusNextTag(),
      onFocusPreviousTag: () => this.focusPreviousTag(),
      onFocusNextResult: () => this.focusNextResult(),
      onFocusPreviousResult: () => this.focusPreviousResult()
    });

    this.tagRenderer = new TagRenderer({
      onToggleExcluded: (tag) => this.facetManager.toggleExcluded(tag),
      onAddFacet: (tag, mode) => {
        if (mode === "prefix") {
          this.facetManager.addFacet(tag, this.settings.includeDescendantsByDefault, 
            (t) => this.facetManager.hasTagChildren(t, this.indexer.allTags()));
        } else {
          this.facetManager.addFacetExact(tag);
        }
      },
      onToggleFacetMode: (tag) => this.facetManager.toggleFacetMode(tag),
      onToggleExpansion: (node) => {
        this.expansionManager.saveExpansionState(node);
        this.renderCoTags();
      }
    });

    this.resultsRenderer = new ResultsRenderer({
      onToggleExcluded: (tag) => this.facetManager.toggleExcluded(tag),
      onAddFacet: (tag) => this.facetManager.addFacet(tag, this.settings.includeDescendantsByDefault,
        (t) => this.facetManager.hasTagChildren(t, this.indexer.allTags()))
    }, this.indexer);

    this.slashCommandHandler = new SlashCommandHandler({
      onClear: () => this.clearAll(),
      onExpandAll: () => this.expandAllTags(),
      onCollapseAll: () => this.collapseAllTags()
    });

    // Set up keyboard navigator callbacks
    this.keyboardNavigator.setSlashCommandCallbacks({
      onClear: () => this.clearAll(),
      onExpandAll: () => this.expandAllTags(),
      onCollapseAll: () => this.collapseAllTags()
    });
  }

  /** Set up resizable sidebar functionality */
  private setupResizableSidebar(resizerEl: HTMLElement) {
    const STORAGE_KEY = 'facetNav:leftWidthPx';

    const setLeftWidth = (px: number) => {
      const min = 160;         // bounds
      const max = 520;
      const clamped = Math.max(min, Math.min(max, px));
      this.rootEl.style.setProperty('--facet-left', `${clamped}px`);
      localStorage.setItem(STORAGE_KEY, String(clamped));
    };

    const startDrag = (e: MouseEvent) => {
      e.preventDefault();
      resizerEl.classList.add('is-dragging');
      const startX = e.clientX;
      const startWidth = this.coTagsEl.getBoundingClientRect().width;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        setLeftWidth(startWidth + dx);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        resizerEl.classList.remove('is-dragging');
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    resizerEl.addEventListener('mousedown', startDrag);

    // Restore saved width on load
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (!Number.isNaN(saved) && saved > 0) {
      this.rootEl.style.setProperty('--facet-left', `${saved}px`);
    }
  }

  getViewType() { return VIEW_TYPE_FACET_NAV; }
  getDisplayText() { return "Facet Navigator"; }
  getIcon() { return "filter"; }

  async onOpen() {
    this.rootEl = this.containerEl.createDiv({ cls: "facet-nav" });

    const scroll = this.rootEl.createDiv({ cls: "facet-scroll" });

    // Bar = chips + controls
    this.barEl = scroll.createDiv({ cls: "facet-bar" });
    this.controlsEl = scroll.createDiv({ cls: "facet-controls" });

    // Controls: Save View / Export / Clear / Collapse Toggle
    const btnSave = this.controlsEl.createEl("button", { 
      text: "💾", 
      title: "Save View",
      attr: { "data-tooltip": "Save View" }
    });
    btnSave.addEventListener("click", () => this.saveView());
    
    const btnExport = this.controlsEl.createEl("button", { 
      text: "📤", 
      title: "Export Query",
      attr: { "data-tooltip": "Export Query" }
    });
    btnExport.addEventListener("click", () => this.exportQuery());
    
    const btnClear = this.controlsEl.createEl("button", { 
      text: "🗑️", 
      title: "Clear All",
      attr: { "data-tooltip": "Clear All" }
    });
    btnClear.addEventListener("click", () => this.clearAll());
    
    // Collapse/Expand All toggle
    this.btnToggleExpansion = this.controlsEl.createEl("button", { 
      text: "📂", 
      title: "Expand All",
      attr: { "data-tooltip": "Expand All" }
    });
    this.btnToggleExpansion.addEventListener("click", () => this.toggleAllExpansion(this.btnToggleExpansion));

    // Mobile-only filters toggle
    const btnFilters = this.controlsEl.createEl("button", { 
      text: "⚙️", 
      cls: "mobile-only",
      title: "Toggle Filters",
      attr: { "data-tooltip": "Toggle Filters" }
    });
    btnFilters.setAttr("aria-expanded", "true");
    btnFilters.addEventListener("click", () => {
      const hidden = this.coTagsEl.classList.toggle("is-hidden");
      btnFilters.setAttr("aria-expanded", (!hidden).toString());
    });

    // Search box above everything
    this.searchEl = scroll.createDiv({ cls: "search-section search-row" });
    const searchContainer = this.searchEl.createDiv({ cls: "search-container" });
    this.searchInput = searchContainer.createEl("input", { 
      type: "text", 
      placeholder: "Search tags...",
      cls: "search-input"
    });
    
    // Add search functionality
    this.searchInput.addEventListener("input", (e) => {
      const query = (e.target as HTMLInputElement).value;
      this.searchQuery = query;
      
      // Update placeholder for slash commands
      if (query.startsWith('/')) {
        // Don't filter results for slash commands
        this.searchQuery = '';
        this.filterCoTags('');
      } else {
        this.searchInput.placeholder = "Search tags...";
        this.filterCoTags(query.toLowerCase());
      }
    });

    // Main: left co-tags, resizer, right results
    const main = scroll.createDiv({ cls: "facet-main" });
    
    this.coTagsEl = main.createDiv({ cls: "co-tags" });
    
    // Add resize handle between panes
    const resizerEl = main.createDiv({ cls: "facet-resizer" });
    
    this.resultsEl = main.createDiv({ cls: "results" });

    // Set up resizable sidebar functionality
    this.setupResizableSidebar(resizerEl);

    // Initial render
    this.refresh();
    
    // Set up keyboard navigation
    this.setupKeyboardNavigation();
  }

  async onClose() {}

  /** External: reset selection */
  clearAll() {
    this.facetManager.clearAll();
    this.searchQuery = "";
    if (this.searchInput) this.searchInput.value = "";
    // Clear expansion state to ensure collapsed view after clearing
    this.expansionManager.clear();
    // Update toggle button to reflect collapsed state
    if (this.btnToggleExpansion) {
      this.btnToggleExpansion.textContent = "📂";
      this.btnToggleExpansion.setAttribute("title", "Expand All");
      this.btnToggleExpansion.setAttribute("data-tooltip", "Expand All");
    }
    this.refresh();
  }

  /** Add a facet with smart mode selection */
  addFacet(tag: string) {
    this.facetManager.addFacet(tag, this.settings.includeDescendantsByDefault, 
      (t) => this.facetManager.hasTagChildren(t, this.indexer.allTags()));
  }

  /** Add a facet in exact mode */
  addFacetExact(tag: string) {
    this.facetManager.addFacetExact(tag);
  }

  /** Remove a facet */
  removeFacet(tag: string) {
    this.facetManager.removeFacet(tag);
  }

  /** Toggle between exact and prefix mode for a facet */
  toggleFacetMode(tag: string) {
    this.facetManager.toggleFacetMode(tag);
  }

  /** Add/remove from excluded set */
  toggleExcluded(tag: string) {
    this.facetManager.toggleExcluded(tag);
  }

  /** Replace current facets with the provided list and refresh once */
  setFacets(tags: string[]) {
    this.facetManager.setFacets(tags, this.settings.includeDescendantsByDefault);
  }

  /** Check if a file matches the given tag filters */
  private fileMatches(filters: TagFilter[], fileTags: string[]): boolean {
    // fileTags is the normalized list returned by collectTags() (no # prefix)
    return filters.every(f => {
      const tag = f.tag; // already normalized
      return f.mode === "exact"
        ? fileTags.includes(tag)
        : fileTags.some(t => t === tag || t.startsWith(tag + "/"));
    });
  }

  /** Build the currentFiles and repaint panels */
  refresh() {
    if (!this.indexer.isReady()) {
      this.resultsEl.setText("Indexing…");
      return;
    }

    const selected = this.facetManager.getSelected();
    const excluded = this.facetManager.getExcluded();

    if (selected.size === 0) {
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
      // Get included files using new tag matching system
      const filters = this.facetManager.getTagFilters();
      
      // Get all files and filter them using our new matching logic
      const allFiles = this.app.vault.getMarkdownFiles();
      this.currentFiles = new Set();
      
      for (const file of allFiles) {
        // Skip files in excluded folders
        if (this.isFileInExcludedFolder(file.path)) {
          continue;
        }
        
        const fileTags = Array.from(this.indexer.exactTagsForFile(file.path));
        if (this.facetManager.fileMatches(filters, fileTags)) {
          this.currentFiles.add(file.path);
        }
      }
    }

    // Apply exclusions regardless of whether there are selected tags or not
    if (excluded.size > 0) {
      const allFiles = this.app.vault.getMarkdownFiles();
      const filesToRemove = new Set<string>();
      
      for (const file of allFiles) {
        // Skip files in excluded folders
        if (this.isFileInExcludedFolder(file.path)) {
          continue;
        }
        
        const fileTags = Array.from(this.indexer.exactTagsForFile(file.path));
        
        // Check if any file tag matches or is a descendant of excluded tags
        for (const excludedTag of excluded) {
          for (const fileTag of fileTags) {
            if (fileTag === excludedTag || fileTag.startsWith(excludedTag + "/")) {
              filesToRemove.add(file.path);
              break;
            }
          }
          if (filesToRemove.has(file.path)) break;
        }
      }
      
      // Remove excluded files from current set
      for (const fileId of filesToRemove) {
        this.currentFiles.delete(fileId);
      }
    }

    this.renderBar();
    this.renderCoTags();
    this.renderResults();
  }

  private isFileInExcludedFolder(filePath: string): boolean {
    const excludedFolders = this.settings.excludedFolders || [];
    for (const excludedFolder of excludedFolders) {
      if (filePath.startsWith(excludedFolder + "/") || filePath === excludedFolder) {
        return true;
      }
    }
    return false;
  }

  private renderBar() {
    this.barEl.empty();

    const selected = this.facetManager.getSelected();
    const excluded = this.facetManager.getExcluded();

    if (selected.size === 0 && excluded.size === 0) {
      const hint = this.barEl.createSpan({ 
        text: "Select a tag from the left to start drilling down.", 
        cls: "muted" 
      });
      hint.style.marginRight = "auto";
      return;
    }

    // Render included facets
    for (const [tag, mode] of selected) {
      const chip = this.barEl.createDiv({ cls: "facet-chip" });
      const label = chip.createSpan({ text: tag });
      const modeIndicator = chip.createSpan({ 
        text: mode === "exact" ? " (exact)" : " (prefix)", 
        cls: "mode-indicator" 
      });
      const x = chip.createSpan({ text: "✕", cls: "remove" });
      
      // Right-click to toggle mode
      chip.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.facetManager.toggleFacetMode(tag);
      });
      
      // Click to remove
      x.addEventListener("click", () => this.facetManager.removeFacet(tag));
      
      // Tooltip
      chip.setAttr("title", `Right-click to toggle ${mode === "exact" ? "prefix" : "exact"} mode`);
    }

    // Render excluded facets
    for (const tag of excluded) {
      const chip = this.barEl.createDiv({ cls: "facet-chip excluded" });
      chip.createSpan({ text: `NOT ${tag}` });
      const x = chip.createSpan({ text: "✕", cls: "remove" });
      x.addEventListener("click", () => this.facetManager.toggleExcluded(tag));
      chip.setAttr("title", "Excluded facet - click to remove");
    }
  }

  // Note: allVisibleTags is now managed by KeyboardNavigator



  private setupKeyboardNavigation() {
    this.rootEl.addEventListener('keydown', (e) => this.keyboardNavigator.handleKeyDown(e, {
      onFocusSearch: () => this.focusSearch(),
      onFocusFirstTag: () => this.focusFirstTag(),
      onFocusResults: () => this.focusResults(),
      onSelectCurrentTag: () => this.selectCurrentTag(),
      onExcludeCurrentTag: () => this.excludeCurrentTag(),
      onExpandCurrentTag: () => this.expandCurrentTag(),
      onCollapseCurrentTag: () => this.collapseCurrentTag(),
      onOpenCurrentResult: () => this.openCurrentResult(),
      onSearchEnter: () => this.handleSearchEnter(),
      onSlashCommandStart: (e) => this.slashCommandHandler.startSlashCommand(this.searchInput),
      onFocusNextTag: () => this.focusNextTag(),
      onFocusPreviousTag: () => this.focusPreviousTag(),
      onFocusNextResult: () => this.focusNextResult(),
      onFocusPreviousResult: () => this.focusPreviousResult()
    }));
    
    // Focus management
    this.searchInput.addEventListener('focus', () => {
      this.keyboardNavigator.focusSearch();
      this.updateFocusVisuals();
    });
    
    this.searchInput.addEventListener('blur', () => {
      // Don't change focus mode on blur - let tab navigation handle it
    });
  }











  private focusSearch() {
    this.keyboardNavigator.focusSearch();
    this.searchInput.focus();
    this.updateFocusVisuals();
  }

  private focusFirstTag() {
    this.keyboardNavigator.focusFirstTag();
    this.updateFocusVisuals();
  }

  private focusResults() {
    this.keyboardNavigator.focusResults();
    this.updateFocusVisuals();
  }



  private focusNextResult() {
    const resultItems = this.resultsEl.querySelectorAll('.result-item');
    this.keyboardNavigator.focusNextResult(resultItems.length);
    this.updateFocusVisuals();
    this.scrollToFocusedResult();
  }

  private focusPreviousResult() {
    this.keyboardNavigator.focusPreviousResult();
    this.updateFocusVisuals();
    this.scrollToFocusedResult();
  }

  private openCurrentResult() {
    const focusedResultIndex = this.keyboardNavigator.getFocusedResultIndex();
    if (focusedResultIndex >= 0) {
      const resultItems = this.resultsEl.querySelectorAll('.result-item');
      if (focusedResultIndex < resultItems.length) {
        const link = resultItems[focusedResultIndex].querySelector('a');
        if (link) {
          link.click();
        }
      }
    }
  }

  private scrollToFocusedResult() {
    const focusedResultIndex = this.keyboardNavigator.getFocusedResultIndex();
    if (focusedResultIndex >= 0) {
      const resultItems = this.resultsEl.querySelectorAll('.result-item');
      if (focusedResultIndex < resultItems.length) {
        resultItems[focusedResultIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  private focusNextTag() {
    this.keyboardNavigator.focusNextTag();
    this.updateFocusVisuals();
    this.scrollToFocusedTag();
  }

  private focusPreviousTag() {
    this.keyboardNavigator.focusPreviousTag();
    this.updateFocusVisuals();
    this.scrollToFocusedTag();
  }

  private expandCurrentTag() {
    const focusedTag = this.keyboardNavigator.getCurrentFocusedTag();
    if (focusedTag && focusedTag.children.size > 0 && !focusedTag.expanded) {
      focusedTag.expanded = true;
      this.expansionManager.saveExpansionState(focusedTag);
      this.renderCoTags();
    }
  }

  private collapseCurrentTag() {
    const focusedTag = this.keyboardNavigator.getCurrentFocusedTag();
    if (focusedTag && focusedTag.children.size > 0 && focusedTag.expanded) {
      focusedTag.expanded = false;
      this.expansionManager.saveExpansionState(focusedTag);
      this.renderCoTags();
    }
  }

  private selectCurrentTag() {
    const focusedTag = this.keyboardNavigator.getCurrentFocusedTag();
    if (focusedTag) {
      if (focusedTag.children.size > 0) {
        // Parent tag - add as prefix
        this.facetManager.addFacet(focusedTag.full, this.settings.includeDescendantsByDefault,
          (t) => this.facetManager.hasTagChildren(t, this.indexer.allTags()));
      } else {
        // Leaf tag - add as exact
        this.facetManager.addFacetExact(focusedTag.full);
      }
      
      // Store current focus info before refresh
      const currentFocusTag = focusedTag.full;
      const currentFocusIndex = this.keyboardNavigator.getFocusedTagIndex();
      
      // Refresh and then try to restore focus
      this.refresh();
      this.restoreFocusAfterSelection(currentFocusTag, currentFocusIndex);
    }
  }

  private excludeCurrentTag() {
    const focusedTag = this.keyboardNavigator.getCurrentFocusedTag();
    if (focusedTag) {
      const tagToExclude = normalizeTag(focusedTag.full);
      
      // Store current focus info before refresh
      const currentFocusTag = focusedTag.full;
      const currentFocusIndex = this.keyboardNavigator.getFocusedTagIndex();
      
      // Toggle exclusion (same as Alt+click behavior)
      this.facetManager.toggleExcluded(tagToExclude);
      
      // Focus preservation is handled by toggleExcluded -> refresh
      // But we still need to restore focus after the refresh
      setTimeout(() => {
        this.restoreFocusAfterSelection(currentFocusTag, currentFocusIndex);
      }, 0);
    }
  }

  private handleSearchEnter() {
    if (this.searchQuery.trim() === '') return;
    
    // Check for slash commands first
    if (this.handleSlashCommand(this.searchQuery.trim())) {
      return;
    }
    
    // Check for exact match
    const allVisibleTags = this.keyboardNavigator.getVisibleTags();
    const exactMatch = allVisibleTags.find(tag => tag.full === this.searchQuery);
    if (exactMatch) {
      this.selectTagNode(exactMatch);
      return;
    }
    
    // Check for single match
    const matches = allVisibleTags.filter(tag => 
      tag.full.toLowerCase().includes(this.searchQuery.toLowerCase())
    );
    
    if (matches.length === 1) {
      this.selectTagNode(matches[0]);
    } else if (matches.length === 0) {
      new Notice("No tags match the search query.");
    } else {
      new Notice(`Multiple matches found. Narrow down your search to select a specific tag.`);
    }
  }

  private handleSlashCommand(command: string): boolean {
    if (!command.startsWith('/')) return false;
    
    const cmd = command.toLowerCase();
    
    switch (cmd) {
      case '/clear':
        this.clearAll();
        new Notice("Cleared all facets and search");
        return true;
        
      case '/expand':
        this.expandAllTags();
        new Notice("Expanded all tags");
        return true;
        
      case '/collapse':
        this.collapseAllTags();
        new Notice("Collapsed all tags");
        return true;
        
      default:
        // Check for partial matches to provide helpful suggestions
        const availableCommands = ['/clear', '/expand', '/collapse'];
        const suggestions = availableCommands.filter(c => c.startsWith(cmd));
        
        if (suggestions.length > 0) {
          new Notice(`Did you mean: ${suggestions.join(', ')}?`);
        } else {
          new Notice(`Unknown command: ${command}. Available: /clear, /expand, /collapse`);
        }
        return true;
    }
  }

  private expandAllTags() {
    this.expansionManager.expandAll();
    
    // Update button text
    if (this.btnToggleExpansion) {
      this.btnToggleExpansion.textContent = "Collapse All";
    }
    
    // Clear search and re-render
    this.searchQuery = "";
    if (this.searchInput) this.searchInput.value = "";
    this.renderCoTags();
  }

  private collapseAllTags() {
    this.expansionManager.collapseAll();
    
    // Update button text
    if (this.btnToggleExpansion) {
      this.btnToggleExpansion.textContent = "Expand All";
    }
    
    // Clear search and re-render
    this.searchQuery = "";
    if (this.searchInput) this.searchInput.value = "";
    this.renderCoTags();
  }



  private selectTagNode(node: TagTreeNode) {
    if (node.children.size > 0) {
      // Parent tag - add as prefix
      this.facetManager.addFacet(node.full, this.settings.includeDescendantsByDefault,
        (t) => this.facetManager.hasTagChildren(t, this.indexer.allTags()));
    } else {
      // Leaf tag - add as exact
      this.facetManager.addFacetExact(node.full);
    }
  }

  private restoreFocusAfterSelection(previousFocusTag: string, previousFocusIndex: number) {
    // Try to find the same tag in the new list
    const allVisibleTags = this.keyboardNavigator.getVisibleTags();
    const newIndex = allVisibleTags.findIndex(tag => tag.full === previousFocusTag);
    
    if (newIndex >= 0) {
      // Same tag found, focus it
      this.keyboardNavigator.setFocusedTagIndex(newIndex);
    } else {
      // Tag no longer available, try to focus a reasonable alternative
      if (allVisibleTags.length > 0) {
        // Try to keep similar index position, but clamp to available range
        this.keyboardNavigator.setFocusedTagIndex(Math.min(previousFocusIndex, allVisibleTags.length - 1));
      } else {
        // No tags available, clear focus
        this.keyboardNavigator.setFocusedTagIndex(-1);
      }
    }
    
    // Update visuals and ensure focused tag is visible
    this.updateFocusVisuals();
    this.scrollToFocusedTag();
  }

  private updateFocusVisuals() {
    // Remove focus from all tags and results
    this.coTagsEl.querySelectorAll('.tag-row').forEach(row => {
      row.classList.remove('focused');
    });
    this.resultsEl.querySelectorAll('.result-item').forEach(item => {
      item.classList.remove('focused');
    });
    
    // Add focus to current tag
    const focusMode = this.keyboardNavigator.getFocusMode();
    const focusedTagIndex = this.keyboardNavigator.getFocusedTagIndex();
    
    const allVisibleTags = this.keyboardNavigator.getVisibleTags();
    if (focusMode === 'tags' && focusedTagIndex >= 0 && focusedTagIndex < allVisibleTags.length) {
      const focusedTag = allVisibleTags[focusedTagIndex];
      const tagRow = this.coTagsEl.querySelector(`[data-tag="${focusedTag.full}"]`);
      if (tagRow) {
        tagRow.classList.add('focused');
      }
    }
    
    // Add focus to current result
    const focusedResultIndex = this.keyboardNavigator.getFocusedResultIndex();
    if (focusMode === 'results' && focusedResultIndex >= 0) {
      const resultItems = this.resultsEl.querySelectorAll('.result-item');
      if (focusedResultIndex < resultItems.length) {
        resultItems[focusedResultIndex].classList.add('focused');
      }
    }
  }

  private scrollToFocusedTag() {
    const focusedTagIndex = this.keyboardNavigator.getFocusedTagIndex();
    const allVisibleTags = this.keyboardNavigator.getVisibleTags();
    if (focusedTagIndex >= 0 && focusedTagIndex < allVisibleTags.length) {
      const focusedTag = allVisibleTags[focusedTagIndex];
      const tagRow = this.coTagsEl.querySelector(`[data-tag="${focusedTag.full}"]`);
      if (tagRow) {
        tagRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  private toggleAllExpansion(button: HTMLElement) {
    // Determine current state - if most nodes are expanded, we'll collapse all, otherwise expand all
    const shouldCollapse = this.expansionManager.isMostlyExpanded();
    
    // Set all expansion states
    if (shouldCollapse) {
      this.expansionManager.collapseAll();
    } else {
      this.expansionManager.expandAll();
    }
    
    // Update button icon and tooltip
    button.textContent = shouldCollapse ? "📁" : "📂";
    button.setAttribute("title", shouldCollapse ? "Collapse All" : "Expand All");
    button.setAttribute("data-tooltip", shouldCollapse ? "Collapse All" : "Expand All");
    
    // Re-render to apply changes
    this.renderCoTags();
  }

  private renderCoTags() {
    this.coTagsEl.empty();

    const selected = this.facetManager.getSelected();
    const excluded = this.facetManager.getExcluded();

    // Build frequency map excluding selected and excluded facets
    const exclude = new Set([...selected.keys(), ...excluded]);
    
    // Get initial co-tag frequencies
    let coFreq = this.indexer.coTagFrequencies(this.currentFiles, exclude);
    
    // Also exclude any tags that are descendants of excluded tags
    const additionalExclusions = new Set<string>();
    for (const excludedTag of excluded) {
      for (const [tag] of coFreq) {
        if (tag.startsWith(excludedTag + "/")) {
          additionalExclusions.add(tag);
        }
      }
    }
    
    // If we found additional exclusions, rebuild the frequency map
    if (additionalExclusions.size > 0) {
      for (const tag of additionalExclusions) {
        exclude.add(tag);
      }
      coFreq = this.indexer.coTagFrequencies(this.currentFiles, exclude);
    }
    
    // Use the tag renderer to render the co-tags
    const allVisibleTags = this.tagRenderer.renderCoTags(
      this.coTagsEl,
      coFreq,
      this.searchQuery,
      this.expansionManager,
      this.settings.coTagSort
    );

    // Update keyboard navigator with visible tags
    this.keyboardNavigator.setVisibleTags(allVisibleTags);
    
    // Update focus visuals after rendering
    this.updateFocusVisuals();
  }



  private renderResults() {
    const selected = this.facetManager.getSelected();
    this.resultsRenderer.renderResults(
      this.resultsEl,
      this.currentFiles,
      selected.size,
      this.settings.startEmpty,
      this.settings.resultsPageSize
    );
  }



  /** Persist current selection as a Saved View */
  private saveView() {
    const selected = this.facetManager.getSelected();
    const excluded = this.facetManager.getExcluded();
    const tags = Array.from(selected.keys());
    
    if (tags.length === 0) { 
      new Notice("Select at least one tag."); 
      return; 
    }

    const suggested = `view-${new Date().toISOString().slice(0,10)}`;
    
    new InputModal(this.app, "Saved view name", suggested, (name) => {
      const existing = this.settings.savedViews.find(v => v.name === name);
      if (existing) {
        existing.tags = tags;
        if (excluded.size > 0) {
          existing.exclude = Array.from(excluded);
        }
      } else {
        const newView: SavedView = { 
          name, 
          tags,
          exclude: excluded.size > 0 ? Array.from(excluded) : undefined
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
    const selected = this.facetManager.getSelected();
    const excluded = this.facetManager.getExcluded();
    
    if (selected.size === 0) { 
      new Notice("No facets selected."); 
      return; 
    }
    
    const included = Array.from(selected.entries())
      .map(([tag, mode]) => mode === "exact" ? `tag:#${tag}` : `tag:#${tag}*`);
    const excludedArray = Array.from(excluded).map(tag => `-tag:#${tag}`);
    
    const q = [...included, ...excludedArray].join(" ");
    navigator.clipboard.writeText(q).catch(() => {/* ignore */});
    new Notice("Copied search query to clipboard.");
  }

  /** Filter co-tags based on search query */
  private filterCoTags(query: string) {
    this.searchQuery = query;
    this.renderCoTags();
  }

  /** Check if a tag has children in the current co-tags */
  private hasTagChildren(tag: string): boolean {
    // allTags() returns normalized values
    return this.indexer.allTags().some(t => t !== tag && t.startsWith(tag + "/"));
  }

  /** Check if a tag node or any of its descendants are currently selected */
  private hasSelectedDescendants(node: TagTreeNode): boolean {
    return this.facetManager.hasSelectedDescendants(node);
  }
}

