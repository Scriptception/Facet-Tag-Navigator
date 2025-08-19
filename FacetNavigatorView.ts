import { App, ItemView, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { TagIndexer } from "./TagIndexer";
import { FacetNavigatorSettings, SavedView, TagMatchMode, TagFilter } from "./types";
import { buildTagTree, sortNodes, TagTreeNode, normalizeTag } from "./utils";
import { InputModal } from "./InputModal";

export const VIEW_TYPE_FACET_NAV = "facet-navigator-view";

export class FacetNavigatorView extends ItemView {
  private indexer: TagIndexer;
  private settings: FacetNavigatorSettings;

  // Facet selection: Map<tag, TagMatchMode> for exact vs prefix matching
  private selected = new Map<string, TagMatchMode>();
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
  private btnToggleExpansion!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, app: App, indexer: TagIndexer, settings: FacetNavigatorSettings) {
    super(leaf);
    this.indexer = indexer;
    this.settings = settings;
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
    const btnSave = this.controlsEl.createEl("button", { text: "Save View" });
    btnSave.addEventListener("click", () => this.saveView());
    const btnExport = this.controlsEl.createEl("button", { text: "Export Query" });
    btnExport.addEventListener("click", () => this.exportQuery());
    const btnClear = this.controlsEl.createEl("button", { text: "Clear" });
    btnClear.addEventListener("click", () => this.clearAll());
    
    // Collapse/Expand All toggle
    this.btnToggleExpansion = this.controlsEl.createEl("button", { text: "Expand All" });
    this.btnToggleExpansion.addEventListener("click", () => this.toggleAllExpansion(this.btnToggleExpansion));

    // Mobile-only filters toggle
    const btnFilters = this.controlsEl.createEl("button", { text: "Filters", cls: "mobile-only" });
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
      
      // Mark typing in search as search interaction
      this.lastInteractionType = 'search';
      
      // Update placeholder for slash commands
      if (query.startsWith('/')) {
        this.updateSlashCommandHint(query);
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
    this.selected.clear();
    this.excluded.clear();
    this.searchQuery = "";
    if (this.searchInput) this.searchInput.value = "";
    // Clear expansion state to ensure collapsed view after clearing
    this.expansionState.clear();
    // Update toggle button to reflect collapsed state
    if (this.btnToggleExpansion) {
      this.btnToggleExpansion.textContent = "Expand All";
    }
    this.refresh();
  }

  /** Add a facet with smart mode selection */
  addFacet(tag: string) {
    const n = normalizeTag(tag);
    if (!n) return;

    let mode: TagMatchMode = "exact";
    if (this.settings.includeDescendantsByDefault && this.hasTagChildren(n)) {
      mode = "prefix";
    }
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
    const n = normalizeTag(tag);
    if (!n) return;
    
    this.selected.set(n, "exact" as TagMatchMode);
    
    // Clear search input when adding a facet
    this.searchQuery = "";
    if (this.searchInput) {
      this.searchInput.value = "";
    }
    
    this.refresh();
  }

  /** Remove a facet */
  removeFacet(tag: string) {
    const n = normalizeTag(tag);
    this.selected.delete(n);
    this.refresh();
  }

  /** Toggle between exact and prefix mode for a facet */
  toggleFacetMode(tag: string) {
    const n = normalizeTag(tag);
    const current = this.selected.get(n);
    if (!current) return;
    
    const next: TagMatchMode = current === "exact" ? "prefix" : "exact";
    this.selected.set(n, next);
    
    // Clear search input when toggling facet modes
    this.searchQuery = "";
    if (this.searchInput) {
      this.searchInput.value = "";
    }
    
    this.refresh();
  }

  /** Add/remove from excluded set */
  toggleExcluded(tag: string) {
    const n = normalizeTag(tag);
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
    const normalized = tags.map(t => normalizeTag(t)).filter(Boolean);
    this.selected.clear();
    this.excluded.clear();
    
    for (const tag of normalized) {
      const mode: TagMatchMode = this.settings.includeDescendantsByDefault ? "prefix" : "exact";
      this.selected.set(tag, mode);
    }
    
    // Reset any search filter and input UI
    this.searchQuery = "";
    if (this.searchInput) this.searchInput.value = "";
    this.refresh();
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
      // Get included files using new tag matching system
      const filters: TagFilter[] = Array.from(this.selected.entries()).map(([tag, mode]) => ({
        tag,
        mode: mode === 'exact' ? 'exact' : 'prefix'
      }));
      
      // Get all files and filter them using our new matching logic
      const allFiles = this.app.vault.getMarkdownFiles();
      this.currentFiles = new Set();
      
      for (const file of allFiles) {
        const fileTags = Array.from(this.indexer.exactTagsForFile(file.path));
        if (this.fileMatches(filters, fileTags)) {
          this.currentFiles.add(file.path);
        }
      }
    }

    // Apply exclusions regardless of whether there are selected tags or not
    if (this.excluded.size > 0) {
      const allFiles = this.app.vault.getMarkdownFiles();
      const filesToRemove = new Set<string>();
      
      for (const file of allFiles) {
        const fileTags = Array.from(this.indexer.exactTagsForFile(file.path));
        
        // Check if any file tag matches or is a descendant of excluded tags
        for (const excludedTag of this.excluded) {
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
        text: mode === "exact" ? " (exact)" : " (prefix)", 
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
      chip.setAttr("title", `Right-click to toggle ${mode === "exact" ? "prefix" : "exact"} mode`);
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

  // Store expansion state between renders
  private expansionState = new Map<string, boolean>();
  
  // Keyboard navigation state
  private focusedTagIndex = -1;
  private allVisibleTags: TagTreeNode[] = [];
  private searchFocused = true;
  private focusMode: 'search' | 'tags' | 'results' = 'search';
  private focusedResultIndex = -1;
  private lastInteractionType: 'search' | 'navigation' = 'search';

  private restoreExpansionState(treeRoots: Map<string, TagTreeNode>) {
    const restoreNode = (node: TagTreeNode) => {
      // Restore expansion state if it exists, otherwise default based on context
      const savedState = this.expansionState.get(node.full);
      if (savedState !== undefined) {
        node.expanded = savedState;
      } else {
        // Default expansion based on context:
        // - Expanded only when actively searching
        // - Collapsed when no facets are selected (clean state after Clear)
        const defaultExpanded = Boolean(this.searchQuery);
        node.expanded = defaultExpanded;
        // Save the initial state
        this.expansionState.set(node.full, defaultExpanded);
      }
      
      // Recursively restore children
      for (const child of node.children.values()) {
        restoreNode(child);
      }
    };

    for (const rootNode of treeRoots.values()) {
      restoreNode(rootNode);
    }
  }

  private saveExpansionState(node: TagTreeNode) {
    this.expansionState.set(node.full, node.expanded || false);
  }

  private setupKeyboardNavigation() {
    this.rootEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
    
    // Focus management
    this.searchInput.addEventListener('focus', () => {
      this.focusMode = 'search';
      this.focusedTagIndex = -1;
      this.focusedResultIndex = -1;
      this.updateFocusVisuals();
    });
    
    this.searchInput.addEventListener('blur', () => {
      // Don't change focus mode on blur - let tab navigation handle it
    });
  }



  private slashCommandBuffer = '';
  private slashCommandTimeout: number | null = null;

  private handleSlashCommandStart(e: KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    // Clear any existing buffer
    this.slashCommandBuffer = '';
    
    // Focus search and start slash command
    this.focusSearch();
    this.searchInput.value = '/';
    this.searchInput.setSelectionRange(1, 1); // Place cursor after /
    this.searchQuery = '/';
    
    // Set up timeout to clear buffer if no more typing
    if (this.slashCommandTimeout) {
      clearTimeout(this.slashCommandTimeout);
    }
    this.slashCommandTimeout = setTimeout(() => {
      this.slashCommandBuffer = '';
    }, 3000); // Clear after 3 seconds of inactivity
  }

  private isTypingSlashCommand(e: KeyboardEvent): boolean {
    // Check if we're in the middle of typing a slash command
    if (this.slashCommandBuffer.startsWith('/')) {
      return true;
    }
    
    // Check if search input has a slash command
    if (this.searchInput && this.searchInput.value.startsWith('/')) {
      return true;
    }
    
    return false;
  }

  private handleSlashCommandTyping(e: KeyboardEvent) {
    // Route all typing to search input when building slash command
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.handleSearchEnter();
      return;
    }
    
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.clearSlashCommand();
      return;
    }
    
    if (e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      if (this.searchInput.value.length > 1) {
        this.searchInput.value = this.searchInput.value.slice(0, -1);
        this.searchQuery = this.searchInput.value;
        this.updateSlashCommandHint(this.searchInput.value);
      } else {
        this.clearSlashCommand();
      }
      return;
    }
    
    // For other printable characters, add to search input
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      this.searchInput.value += e.key;
      this.searchQuery = this.searchInput.value;
      this.updateSlashCommandHint(this.searchInput.value);
      return;
    }
  }

  private clearSlashCommand() {
    this.searchInput.value = '';
    this.searchQuery = '';
    this.searchInput.placeholder = 'Search tags...';
    this.slashCommandBuffer = '';
    if (this.slashCommandTimeout) {
      clearTimeout(this.slashCommandTimeout);
      this.slashCommandTimeout = null;
    }
  }

  private handleKeyDown(e: KeyboardEvent) {
    // Check for slash commands first (global, regardless of focus)
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && this.focusMode !== 'search') {
      this.handleSlashCommandStart(e);
      return;
    }
    
    // Check if we're typing a slash command sequence
    if (this.isTypingSlashCommand(e)) {
      this.handleSlashCommandTyping(e);
      return;
    }
    
    switch (this.focusMode) {
      case 'search':
        this.handleSearchKeyDown(e);
        break;
      case 'tags':
        this.handleTagKeyDown(e);
        break;
      case 'results':
        this.handleResultsKeyDown(e);
        break;
    }
  }

  private handleSearchKeyDown(e: KeyboardEvent) {
    // Mark any key press in search as search interaction
    this.lastInteractionType = 'search';
    
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        this.lastInteractionType = 'navigation'; // Tab is navigation
        if (e.shiftKey) {
          // Shift+Tab from search goes to results (if any)
          this.focusResults();
        } else {
          this.focusFirstTag();
        }
        break;
      case 'Enter':
        e.preventDefault();
        this.handleSearchEnter();
        break;
      case 'Escape':
        e.preventDefault();
        this.searchInput.blur();
        break;
    }
  }

  private handleTagKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        if (e.shiftKey) {
          this.focusSearch();
        } else {
          this.focusResults();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        this.focusPreviousTag();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        this.focusNextTag();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        this.collapseCurrentTag();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        this.expandCurrentTag();
        break;
      case 'Enter':
        e.preventDefault();
        // Shift+Enter to exclude current tag
        if (e.shiftKey) {
          this.excludeCurrentTag();
        } else if (this.lastInteractionType === 'navigation') {
          // Only select tag if last interaction was navigation (arrow keys, tab)
          this.selectCurrentTag();
        } else {
          // If last interaction was search, handle as search enter
          this.handleSearchEnter();
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.focusSearch();
        break;
    }
  }

  private focusSearch() {
    this.focusMode = 'search';
    this.focusedTagIndex = -1;
    this.focusedResultIndex = -1;
    this.searchInput.focus();
    this.updateFocusVisuals();
  }

  private focusFirstTag() {
    this.focusMode = 'tags';
    this.focusedTagIndex = 0;
    this.focusedResultIndex = -1;
    this.updateFocusVisuals();
  }

  private focusResults() {
    this.focusMode = 'results';
    this.focusedTagIndex = -1;
    this.focusedResultIndex = 0;
    this.updateFocusVisuals();
  }

  private handleResultsKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        if (e.shiftKey) {
          this.focusFirstTag();
        } else {
          this.focusSearch();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        this.focusPreviousResult();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        this.focusNextResult();
        break;
      case 'Enter':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        if (e.shiftKey) {
          // Shift+Enter in results doesn't make sense for file opening
          // Just ignore it and do nothing
          return;
        }
        this.openCurrentResult();
        break;
      case 'Escape':
        e.preventDefault();
        this.focusSearch();
        break;
    }
  }

  private focusNextResult() {
    const resultItems = this.resultsEl.querySelectorAll('.result-item');
    if (resultItems.length === 0) return;
    this.focusedResultIndex = Math.min(this.focusedResultIndex + 1, resultItems.length - 1);
    this.updateFocusVisuals();
    this.scrollToFocusedResult();
  }

  private focusPreviousResult() {
    const resultItems = this.resultsEl.querySelectorAll('.result-item');
    if (resultItems.length === 0) return;
    this.focusedResultIndex = Math.max(this.focusedResultIndex - 1, 0);
    this.updateFocusVisuals();
    this.scrollToFocusedResult();
  }

  private openCurrentResult() {
    if (this.focusedResultIndex >= 0) {
      const resultItems = this.resultsEl.querySelectorAll('.result-item');
      if (this.focusedResultIndex < resultItems.length) {
        const link = resultItems[this.focusedResultIndex].querySelector('a');
        if (link) {
          link.click();
        }
      }
    }
  }

  private scrollToFocusedResult() {
    if (this.focusedResultIndex >= 0) {
      const resultItems = this.resultsEl.querySelectorAll('.result-item');
      if (this.focusedResultIndex < resultItems.length) {
        resultItems[this.focusedResultIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  private focusNextTag() {
    if (this.allVisibleTags.length === 0) return;
    this.focusedTagIndex = Math.min(this.focusedTagIndex + 1, this.allVisibleTags.length - 1);
    this.updateFocusVisuals();
    this.scrollToFocusedTag();
  }

  private focusPreviousTag() {
    if (this.allVisibleTags.length === 0) return;
    this.focusedTagIndex = Math.max(this.focusedTagIndex - 1, 0);
    this.updateFocusVisuals();
    this.scrollToFocusedTag();
  }

  private expandCurrentTag() {
    if (this.focusedTagIndex >= 0 && this.focusedTagIndex < this.allVisibleTags.length) {
      const node = this.allVisibleTags[this.focusedTagIndex];
      if (node.children.size > 0 && !node.expanded) {
        node.expanded = true;
        this.saveExpansionState(node);
        this.renderCoTags();
      }
    }
  }

  private collapseCurrentTag() {
    if (this.focusedTagIndex >= 0 && this.focusedTagIndex < this.allVisibleTags.length) {
      const node = this.allVisibleTags[this.focusedTagIndex];
      if (node.children.size > 0 && node.expanded) {
        node.expanded = false;
        this.saveExpansionState(node);
        this.renderCoTags();
      }
    }
  }

  private selectCurrentTag() {
    if (this.focusedTagIndex >= 0 && this.focusedTagIndex < this.allVisibleTags.length) {
      const node = this.allVisibleTags[this.focusedTagIndex];
      const selectedTag = normalizeTag(node.full);
      
      if (node.children.size > 0) {
        // Parent tag - add as prefix
        const mode: TagMatchMode = "prefix";
        this.selected.set(selectedTag, mode);
      } else {
        // Leaf tag - add as exact
        const mode: TagMatchMode = "exact";
        this.selected.set(selectedTag, mode);
      }
      
      // Store current focus info before refresh
      const currentFocusTag = node.full;
      const currentFocusIndex = this.focusedTagIndex;
      
      // Clear search when selecting a tag
      this.searchQuery = "";
      if (this.searchInput) this.searchInput.value = "";
      
      // Refresh and then try to restore focus
      this.refresh();
      this.restoreFocusAfterSelection(currentFocusTag, currentFocusIndex);
    }
  }

  private excludeCurrentTag() {
    if (this.focusedTagIndex >= 0 && this.focusedTagIndex < this.allVisibleTags.length) {
      const node = this.allVisibleTags[this.focusedTagIndex];
      const tagToExclude = normalizeTag(node.full);
      
      // Store current focus info before refresh
      const currentFocusTag = node.full;
      const currentFocusIndex = this.focusedTagIndex;
      
      // Toggle exclusion (same as Alt+click behavior)
      this.toggleExcluded(tagToExclude);
      
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
    const exactMatch = this.allVisibleTags.find(tag => tag.full === this.searchQuery);
    if (exactMatch) {
      this.selectTagNode(exactMatch);
      return;
    }
    
    // Check for single match
    const matches = this.allVisibleTags.filter(tag => 
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
    // Set all expansion states to true
    for (const [tagPath] of this.expansionState) {
      this.expansionState.set(tagPath, true);
    }
    
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
    // Set all expansion states to false
    for (const [tagPath] of this.expansionState) {
      this.expansionState.set(tagPath, false);
    }
    
    // Update button text
    if (this.btnToggleExpansion) {
      this.btnToggleExpansion.textContent = "Expand All";
    }
    
    // Clear search and re-render
    this.searchQuery = "";
    if (this.searchInput) this.searchInput.value = "";
    this.renderCoTags();
  }

  private updateSlashCommandHint(query: string) {
    const availableCommands = ['/clear', '/expand', '/collapse'];
    const matches = availableCommands.filter(cmd => cmd.startsWith(query.toLowerCase()));
    
    if (matches.length === 1) {
      // Show completion hint
      this.searchInput.placeholder = `${matches[0]} - Press Enter to execute`;
    } else if (matches.length > 1) {
      // Show available options
      this.searchInput.placeholder = `Available: ${matches.join(', ')}`;
    } else {
      // Show all commands if no matches
      this.searchInput.placeholder = `Commands: ${availableCommands.join(', ')}`;
    }
  }

  private selectTagNode(node: TagTreeNode) {
    if (node.children.size > 0) {
      // Parent tag - add as prefix
      const mode: TagMatchMode = "prefix";
      this.selected.set(normalizeTag(node.full), mode);
    } else {
      // Leaf tag - add as exact
      const mode: TagMatchMode = "exact";
      this.selected.set(normalizeTag(node.full), mode);
    }
    // Clear search when selecting a tag
    this.searchQuery = "";
    if (this.searchInput) this.searchInput.value = "";
    this.refresh();
  }

  private restoreFocusAfterSelection(previousFocusTag: string, previousFocusIndex: number) {
    // Try to find the same tag in the new list
    const newIndex = this.allVisibleTags.findIndex(tag => tag.full === previousFocusTag);
    
    if (newIndex >= 0) {
      // Same tag found, focus it
      this.focusedTagIndex = newIndex;
    } else {
      // Tag no longer available, try to focus a reasonable alternative
      if (this.allVisibleTags.length > 0) {
        // Try to keep similar index position, but clamp to available range
        this.focusedTagIndex = Math.min(previousFocusIndex, this.allVisibleTags.length - 1);
      } else {
        // No tags available, clear focus
        this.focusedTagIndex = -1;
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
    if (this.focusMode === 'tags' && this.focusedTagIndex >= 0 && this.focusedTagIndex < this.allVisibleTags.length) {
      const focusedTag = this.allVisibleTags[this.focusedTagIndex];
      const tagRow = this.coTagsEl.querySelector(`[data-tag="${focusedTag.full}"]`);
      if (tagRow) {
        tagRow.classList.add('focused');
      }
    }
    
    // Add focus to current result
    if (this.focusMode === 'results' && this.focusedResultIndex >= 0) {
      const resultItems = this.resultsEl.querySelectorAll('.result-item');
      if (this.focusedResultIndex < resultItems.length) {
        resultItems[this.focusedResultIndex].classList.add('focused');
      }
    }
  }

  private scrollToFocusedTag() {
    if (this.focusedTagIndex >= 0 && this.focusedTagIndex < this.allVisibleTags.length) {
      const focusedTag = this.allVisibleTags[this.focusedTagIndex];
      const tagRow = this.coTagsEl.querySelector(`[data-tag="${focusedTag.full}"]`);
      if (tagRow) {
        tagRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  private toggleAllExpansion(button: HTMLElement) {
    // Determine current state - if most nodes are expanded, we'll collapse all, otherwise expand all
    const expandedCount = Array.from(this.expansionState.values()).filter(Boolean).length;
    const totalCount = this.expansionState.size;
    const shouldCollapse = expandedCount > totalCount / 2;
    
    // Set all expansion states
    for (const [tagPath] of this.expansionState) {
      this.expansionState.set(tagPath, !shouldCollapse);
    }
    
    // Update button text
    button.textContent = shouldCollapse ? "Expand All" : "Collapse All";
    
    // Re-render to apply changes
    this.renderCoTags();
  }

  private renderCoTags() {
    this.coTagsEl.empty();

    // Build frequency map excluding selected and excluded facets
    const exclude = new Set([...this.selected.keys(), ...this.excluded]);
    
    // Get initial co-tag frequencies
    let coFreq = this.indexer.coTagFrequencies(this.currentFiles, exclude);
    
    // Also exclude any tags that are descendants of excluded tags
    const additionalExclusions = new Set<string>();
    for (const excludedTag of this.excluded) {
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

    // Build the tree from ALL tags to ensure parent nodes are created
    const freq = filteredFreq; // Map<string, number> of *normalized* tags
    const treeRoots = buildTagTree(freq, "/");
    
    // Restore expansion state after building the tree
    this.restoreExpansionState(treeRoots);

    // Build flat list of all visible tags for keyboard navigation
    this.allVisibleTags = [];
    const collectVisibleTags = (node: TagTreeNode) => {
      this.allVisibleTags.push(node);
      if (node.children.size > 0 && node.expanded) {
        for (const child of sortNodes(node.children.values(), this.settings.coTagSort)) {
          collectVisibleTags(child);
        }
      }
    };
    
    // Render all tags in a single unified list
    if (treeRoots.size > 0) {
      const allNodes = Array.from(treeRoots.values());
      const sortedNodes = sortNodes(allNodes, this.settings.coTagSort);
      // Only expand by default when actively searching
      const expandDefault = Boolean(this.searchQuery);
      
      for (const node of sortedNodes) {
        this.renderTreeNode(this.coTagsEl, node, 0, expandDefault);
        collectVisibleTags(node);
      }
    }
    
    // Update focus visuals after rendering
    this.updateFocusVisuals();
  }

  /**
   * Render a TagTreeNode (and its descendants) as clickable rows.
   * Carets toggle expansion, labels select tags.
   */
  private renderTreeNode(container: HTMLElement, node: TagTreeNode, depth: number, expandDefault: boolean) {
    const row = container.createDiv({ cls: "tag-row tag-hier" });
    row.setAttribute("data-depth", String(depth));
    row.setAttribute("data-tag", node.full);
    row.classList.toggle("has-children", node.children.size > 0);

    // Initialize expansion state if not set
    if (node.expanded === undefined) {
      node.expanded = expandDefault;
    }

    // Caret only if it has children
    const hasKids = node.children.size > 0;
    if (hasKids) {
      const caret = row.createSpan({ cls: "tag-caret", text: node.expanded ? "▾" : "▸" });
      caret.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Toggle expansion state
        node.expanded = !node.expanded;
        this.saveExpansionState(node);

        this.renderCoTags(); // Re-render just the co-tags section
      });
    } else {
      row.createSpan({ cls: "tag-caret-placeholder", text: "  " });
    }

    // Label with single-click expand / double-click select behavior
    const label = row.createSpan({ text: node.label, cls: "tag-label" });
    
    if (hasKids) {
      // For expandable items: single click = expand/collapse, double click = select
      let clickTimeout: number | null = null;
      
      label.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Alt+click to exclude
        if (e.altKey) {
          this.toggleExcluded(node.full);
          return;
        }
        
        if (clickTimeout !== null) {
          // This is part of a double-click, cancel the single-click action
          clearTimeout(clickTimeout);
          clickTimeout = null;
          return;
        }
        
        // Set timeout for single-click action (expand/collapse)
        clickTimeout = setTimeout(() => {
          clickTimeout = null;
          // Toggle expansion
          node.expanded = !node.expanded;
          this.saveExpansionState(node);
          this.renderCoTags();
        }, 200);
      });
      
      // Double-click to select the tag
      label.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Alt+double-click should still exclude, not select
        if (e.altKey) {
          this.toggleExcluded(node.full);
          return;
        }
        
        // Cancel any pending single-click
        if (clickTimeout !== null) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
        }
        
        // Select the tag (prefix mode for parents)
        const mode: TagMatchMode = "prefix";
        this.selected.set(normalizeTag(node.full), mode);
        
        // Store current focus info before refresh (for mouse clicks)
        const currentFocusTag = node.full;
        const currentFocusIndex = this.allVisibleTags.findIndex(tag => tag.full === node.full);
        
        // Clear search when selecting a tag
        this.searchQuery = "";
        if (this.searchInput) this.searchInput.value = "";
        this.refresh();
        
        // Restore focus after mouse selection
        if (currentFocusIndex >= 0) {
          this.restoreFocusAfterSelection(currentFocusTag, currentFocusIndex);
        }
      });
    } else {
      // For non-expandable items: single click = select
      label.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Alt+click to exclude
        if (e.altKey) {
          this.toggleExcluded(node.full);
          return;
        }
        
        const mode: TagMatchMode = "exact";
        this.selected.set(normalizeTag(node.full), mode);
        
        // Store current focus info before refresh (for mouse clicks)
        const currentFocusTag = node.full;
        const currentFocusIndex = this.allVisibleTags.findIndex(tag => tag.full === node.full);
        
        // Clear search when selecting a tag
        this.searchQuery = "";
        if (this.searchInput) this.searchInput.value = "";
        this.refresh();
        
        // Restore focus after mouse selection
        if (currentFocusIndex >= 0) {
          this.restoreFocusAfterSelection(currentFocusTag, currentFocusIndex);
        }
      });
    }

    // IMPORTANT: show rolled-up count
    const badge = row.createSpan({ cls: "badge", text: String(node.count) });

    // Tooltip shows the full tag path and mode info
    const exactNote = node.exactCount === 0 ? " (no exact tags; rolled-up)" : "";
    const modeHint = hasKids 
      ? "\nSingle-click: expand/collapse\nDouble-click: select branch (prefix match)\nCaret: expand/collapse" 
      : "\nClick: add as exact match facet";
    const countInfo = hasKids ? `\nBranch contains ${node.count} total items` : "";
    const keyboardHints = "\nKeyboard: Enter to select, Shift+Enter to exclude";
    label.setAttr("title", `${node.full}${exactNote}${countInfo}${modeHint}\nRight-click to toggle exact/prefix mode\nAlt+click to exclude${keyboardHints}`);

    // Right-click to toggle exact/prefix mode
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleFacetMode(node.full);
    });

    // Recursive rendering for children
    if (node.children.size > 0 && node.expanded) {
      const children = sortNodes(node.children.values(), this.settings.coTagSort);
      for (const child of children) {
        this.renderTreeNode(container, child, depth + 1, expandDefault);
      }
    }
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
        tagChip.addEventListener("click", (e) => {
          if (e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            this.toggleExcluded(tag);
          } else {
            this.addFacet(tag);
          }
        });
        tagChip.setAttr("title", `Click to add ${tag} as a facet\nAlt+click to exclude`);
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

  /** Check if a tag has children in the current co-tags */
  private hasTagChildren(tag: string): boolean {
    // allTags() returns normalized values
    return this.indexer.allTags().some(t => t !== tag && t.startsWith(tag + "/"));
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

