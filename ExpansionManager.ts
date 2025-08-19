import { TagTreeNode } from "./utils";

export class ExpansionManager {
  private expansionState = new Map<string, boolean>();
  private preSearchState = new Map<string, boolean>();

  /**
   * Restore expansion state for a tree of tag nodes
   */
  restoreExpansionState(treeRoots: Map<string, TagTreeNode>, searchQuery: string): void {
    const isSearching = Boolean(searchQuery);
    
    const restoreNode = (node: TagTreeNode) => {
      const savedState = this.expansionState.get(node.full);
      
      if (isSearching) {
        // When searching, expand all nodes but remember the pre-search state
        if (!this.preSearchState.has(node.full)) {
          // Store the current state before overriding for search
          this.preSearchState.set(node.full, savedState !== undefined ? savedState : false);
        }
        node.expanded = true;
      } else {
        // When not searching, restore the pre-search state if it exists
        if (this.preSearchState.has(node.full)) {
          // Restore from pre-search state and clean it up
          const preSearchExpanded = this.preSearchState.get(node.full)!;
          node.expanded = preSearchExpanded;
          this.expansionState.set(node.full, preSearchExpanded);
          this.preSearchState.delete(node.full);
        } else if (savedState !== undefined) {
          // Use saved state
          node.expanded = savedState;
        } else {
          // Default to collapsed for new nodes when not searching
          node.expanded = false;
          this.expansionState.set(node.full, false);
        }
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

  /**
   * Save expansion state for a specific node
   */
  saveExpansionState(node: TagTreeNode): void {
    this.expansionState.set(node.full, node.expanded || false);
  }

  /**
   * Clear all expansion states
   */
  clear(): void {
    this.expansionState.clear();
    this.preSearchState.clear();
  }

  /**
   * Expand all tags
   */
  expandAll(): void {
    for (const [tagPath] of this.expansionState) {
      this.expansionState.set(tagPath, true);
    }
  }

  /**
   * Collapse all tags
   */
  collapseAll(): void {
    for (const [tagPath] of this.expansionState) {
      this.expansionState.set(tagPath, false);
    }
  }

  /**
   * Get current expansion state
   */
  getState(): Map<string, boolean> {
    return new Map(this.expansionState);
  }

  /**
   * Check if most nodes are expanded (for toggle logic)
   */
  isMostlyExpanded(): boolean {
    const expandedCount = Array.from(this.expansionState.values()).filter(Boolean).length;
    const totalCount = this.expansionState.size;
    return expandedCount > totalCount / 2;
  }
}
