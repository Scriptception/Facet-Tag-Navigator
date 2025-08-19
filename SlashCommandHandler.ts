import { Notice } from "obsidian";

export interface SlashCommandCallbacks {
  onClear: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export class SlashCommandHandler {
  private slashCommandBuffer = '';
  private slashCommandTimeout: number | null = null;
  private callbacks: SlashCommandCallbacks;

  constructor(callbacks: SlashCommandCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Start a slash command sequence
   */
  startSlashCommand(searchInput: HTMLInputElement): void {
    // Clear any existing buffer
    this.slashCommandBuffer = '';
    
    // Focus search and start slash command
    searchInput.value = '/';
    searchInput.setSelectionRange(1, 1); // Place cursor after /
    
    // Set up timeout to clear buffer if no more typing
    if (this.slashCommandTimeout) {
      clearTimeout(this.slashCommandTimeout);
    }
    this.slashCommandTimeout = setTimeout(() => {
      this.slashCommandBuffer = '';
    }, 3000); // Clear after 3 seconds of inactivity
  }

  /**
   * Check if currently typing a slash command
   */
  isTypingSlashCommand(searchInput: HTMLInputElement): boolean {
    // Check if we're in the middle of typing a slash command
    if (this.slashCommandBuffer.startsWith('/')) {
      return true;
    }
    
    // Check if search input has a slash command
    if (searchInput && searchInput.value.startsWith('/')) {
      return true;
    }
    
    return false;
  }

  /**
   * Handle typing during slash command mode
   */
  handleTyping(e: KeyboardEvent, searchInput: HTMLInputElement): boolean {
    // Route all typing to search input when building slash command
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.handleSlashCommand(searchInput.value.trim());
      return true;
    }
    
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.clearSlashCommand(searchInput);
      return true;
    }
    
    if (e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      if (searchInput.value.length > 1) {
        searchInput.value = searchInput.value.slice(0, -1);
        this.updateSlashCommandHint(searchInput);
      } else {
        this.clearSlashCommand(searchInput);
      }
      return true;
    }
    
    // For other printable characters, add to search input
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      searchInput.value += e.key;
      this.updateSlashCommandHint(searchInput);
      return true;
    }

    return false;
  }

  /**
   * Clear slash command state
   */
  clearSlashCommand(searchInput: HTMLInputElement): void {
    searchInput.value = '';
    searchInput.placeholder = 'Search tags...';
    this.slashCommandBuffer = '';
    if (this.slashCommandTimeout) {
      clearTimeout(this.slashCommandTimeout);
      this.slashCommandTimeout = null;
    }
  }

  /**
   * Execute a slash command
   */
  private handleSlashCommand(command: string): boolean {
    if (!command.startsWith('/')) return false;
    
    const cmd = command.toLowerCase();
    
    switch (cmd) {
      case '/clear':
        this.callbacks.onClear();
        new Notice("Cleared all facets and search");
        return true;
        
      case '/expand':
        this.callbacks.onExpandAll();
        new Notice("Expanded all tags");
        return true;
        
      case '/collapse':
        this.callbacks.onCollapseAll();
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

  /**
   * Update search input placeholder with command hints
   */
  private updateSlashCommandHint(searchInput: HTMLInputElement): void {
    const query = searchInput.value;
    const availableCommands = ['/clear', '/expand', '/collapse'];
    const matches = availableCommands.filter(cmd => cmd.startsWith(query.toLowerCase()));
    
    if (matches.length === 1) {
      // Show completion hint
      searchInput.placeholder = `${matches[0]} - Press Enter to execute`;
    } else if (matches.length > 1) {
      // Show available options
      searchInput.placeholder = `Available: ${matches.join(', ')}`;
    } else {
      // Show all commands if no matches
      searchInput.placeholder = `Commands: ${availableCommands.join(', ')}`;
    }
  }
}
