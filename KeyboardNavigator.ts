import { TagTreeNode } from "./utils";
import { SlashCommandHandler } from "./SlashCommandHandler";

export type FocusMode = 'search' | 'tags' | 'results';

export interface KeyboardNavigationCallbacks {
  onFocusSearch: () => void;
  onFocusFirstTag: () => void;
  onFocusResults: () => void;
  onSelectCurrentTag: () => void;
  onExcludeCurrentTag: () => void;
  onExpandCurrentTag: () => void;
  onCollapseCurrentTag: () => void;
  onOpenCurrentResult: () => void;
  onSearchEnter: () => void;
  onSlashCommandStart: (e: KeyboardEvent) => void;
  onFocusNextTag: () => void;
  onFocusPreviousTag: () => void;
  onFocusNextResult: () => void;
  onFocusPreviousResult: () => void;
}

export class KeyboardNavigator {
  private focusedTagIndex = -1;
  private focusedResultIndex = -1;
  private focusMode: FocusMode = 'search';
  private lastInteractionType: 'search' | 'navigation' = 'search';
  private allVisibleTags: TagTreeNode[] = [];
  private slashCommandHandler: SlashCommandHandler;

  constructor(callbacks: KeyboardNavigationCallbacks) {
    this.slashCommandHandler = new SlashCommandHandler({
      onClear: () => {}, // Will be set by parent
      onExpandAll: () => {}, // Will be set by parent
      onCollapseAll: () => {} // Will be set by parent
    });
  }

  /**
   * Set the slash command callbacks
   */
  setSlashCommandCallbacks(callbacks: {
    onClear: () => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
  }): void {
    this.slashCommandHandler = new SlashCommandHandler(callbacks);
  }

  /**
   * Set the visible tags for navigation
   */
  setVisibleTags(tags: TagTreeNode[]): void {
    this.allVisibleTags = tags;
  }

  /**
   * Get the visible tags for navigation
   */
  getVisibleTags(): TagTreeNode[] {
    return this.allVisibleTags;
  }

  /**
   * Get current focus mode
   */
  getFocusMode(): FocusMode {
    return this.focusMode;
  }

  /**
   * Get current focused tag index
   */
  getFocusedTagIndex(): number {
    return this.focusedTagIndex;
  }

  /**
   * Get current focused result index
   */
  getFocusedResultIndex(): number {
    return this.focusedResultIndex;
  }

  /**
   * Get last interaction type
   */
  getLastInteractionType(): 'search' | 'navigation' {
    return this.lastInteractionType;
  }

  /**
   * Handle global keydown events
   */
  handleKeyDown(e: KeyboardEvent, callbacks: KeyboardNavigationCallbacks): void {
    // Check for slash commands first (global, regardless of focus)
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && this.focusMode !== 'search') {
      e.preventDefault(); // Prevent the slash from being added to input
      callbacks.onSlashCommandStart(e);
      return;
    }
    
    // Check if we're typing a slash command sequence
    if (this.slashCommandHandler.isTypingSlashCommand(e.target as HTMLInputElement)) {
      if (this.slashCommandHandler.handleTyping(e, e.target as HTMLInputElement)) {
        return;
      }
    }
    
    switch (this.focusMode) {
      case 'search':
        this.handleSearchKeyDown(e, callbacks);
        break;
      case 'tags':
        this.handleTagKeyDown(e, callbacks);
        break;
      case 'results':
        this.handleResultsKeyDown(e, callbacks);
        break;
    }
  }

  /**
   * Handle search-focused keydown events
   */
  private handleSearchKeyDown(e: KeyboardEvent, callbacks: KeyboardNavigationCallbacks): void {
    // Mark any key press in search as search interaction
    this.lastInteractionType = 'search';
    
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        this.lastInteractionType = 'navigation'; // Tab is navigation
        if (e.shiftKey) {
          // Shift+Tab from search goes to results (if any)
          callbacks.onFocusResults();
        } else {
          callbacks.onFocusFirstTag();
        }
        break;
      case 'Enter':
        e.preventDefault();
        callbacks.onSearchEnter();
        break;
      case 'Escape':
        e.preventDefault();
        (e.target as HTMLElement).blur();
        break;
    }
  }

  /**
   * Handle tag-focused keydown events
   */
  private handleTagKeyDown(e: KeyboardEvent, callbacks: KeyboardNavigationCallbacks): void {
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        if (e.shiftKey) {
          callbacks.onFocusSearch();
        } else {
          callbacks.onFocusResults();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        callbacks.onFocusPreviousTag();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        callbacks.onFocusNextTag();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        callbacks.onCollapseCurrentTag();
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        callbacks.onExpandCurrentTag();
        break;
      case 'Enter':
        e.preventDefault();
        // Shift+Enter to exclude current tag
        if (e.shiftKey) {
          callbacks.onExcludeCurrentTag();
        } else if (this.lastInteractionType === 'navigation') {
          // Only select tag if last interaction was navigation (arrow keys, tab)
          callbacks.onSelectCurrentTag();
        } else {
          // If last interaction was search, handle as search enter
          callbacks.onSearchEnter();
        }
        break;
      case 'Escape':
        e.preventDefault();
        callbacks.onFocusSearch();
        break;
    }
  }

  /**
   * Handle results-focused keydown events
   */
  private handleResultsKeyDown(e: KeyboardEvent, callbacks: KeyboardNavigationCallbacks): void {
    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        if (e.shiftKey) {
          callbacks.onFocusFirstTag();
        } else {
          callbacks.onFocusSearch();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        callbacks.onFocusPreviousResult();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        callbacks.onFocusNextResult();
        break;
      case 'Enter':
        e.preventDefault();
        this.lastInteractionType = 'navigation';
        if (e.shiftKey) {
          // Shift+Enter in results doesn't make sense for file opening
          // Just ignore it and do nothing
          return;
        }
        callbacks.onOpenCurrentResult();
        break;
      case 'Escape':
        e.preventDefault();
        callbacks.onFocusSearch();
        break;
    }
  }

  /**
   * Focus search mode
   */
  focusSearch(): void {
    this.focusMode = 'search';
    this.focusedTagIndex = -1;
    this.focusedResultIndex = -1;
  }

  /**
   * Focus first tag
   */
  focusFirstTag(): void {
    this.focusMode = 'tags';
    this.focusedTagIndex = 0;
    this.focusedResultIndex = -1;
  }

  /**
   * Focus results
   */
  focusResults(): void {
    this.focusMode = 'results';
    this.focusedTagIndex = -1;
    this.focusedResultIndex = 0;
  }

  /**
   * Focus next tag
   */
  focusNextTag(): void {
    if (this.allVisibleTags.length === 0) return;
    this.focusedTagIndex = Math.min(this.focusedTagIndex + 1, this.allVisibleTags.length - 1);
  }

  /**
   * Focus previous tag
   */
  focusPreviousTag(): void {
    if (this.allVisibleTags.length === 0) return;
    this.focusedTagIndex = Math.max(this.focusedTagIndex - 1, 0);
  }

  /**
   * Focus next result
   */
  focusNextResult(maxResults: number): void {
    if (maxResults === 0) return;
    this.focusedResultIndex = Math.min(this.focusedResultIndex + 1, maxResults - 1);
  }

  /**
   * Focus previous result
   */
  focusPreviousResult(): void {
    this.focusedResultIndex = Math.max(this.focusedResultIndex - 1, 0);
  }

  /**
   * Get the currently focused tag node
   */
  getCurrentFocusedTag(): TagTreeNode | null {
    if (this.focusedTagIndex >= 0 && this.focusedTagIndex < this.allVisibleTags.length) {
      return this.allVisibleTags[this.focusedTagIndex];
    }
    return null;
  }

  /**
   * Set focused tag index (for external updates)
   */
  setFocusedTagIndex(index: number): void {
    this.focusedTagIndex = index;
  }

  /**
   * Set focused result index (for external updates)
   */
  setFocusedResultIndex(index: number): void {
    this.focusedResultIndex = index;
  }
}
