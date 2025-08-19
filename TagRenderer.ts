import { TagTreeNode, sortNodes, normalizeTag } from "./utils";
import { TagMatchMode } from "./types";

export interface TagRendererCallbacks {
  onToggleExcluded: (tag: string) => void;
  onAddFacet: (tag: string, mode: TagMatchMode) => void;
  onToggleFacetMode: (tag: string) => void;
  onToggleExpansion: (node: TagTreeNode) => void;
}

export class TagRenderer {
  private callbacks: TagRendererCallbacks;

  constructor(callbacks: TagRendererCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Render the co-tags section
   */
  renderCoTags(
    container: HTMLElement,
    coFreq: Map<string, number>,
    searchQuery: string,
    expansionManager: any, // Will be properly typed when we integrate
    coTagSort: string
  ): TagTreeNode[] {
    container.empty();

    if (coFreq.size === 0) {
      container.createDiv({ text: "No co-tags. Adjust selection.", cls: "muted" });
      return [];
    }

    // Filter by search query if present
    let filteredFreq = coFreq;
    if (searchQuery) {
      filteredFreq = new Map();
      for (const [tag, count] of coFreq) {
        if (tag.toLowerCase().includes(searchQuery.toLowerCase())) {
          filteredFreq.set(tag, count);
        }
      }
      if (filteredFreq.size === 0) {
        container.createDiv({ text: "No tags match the search query.", cls: "muted" });
        return [];
      }
    }

    // Build the tree from ALL tags to ensure parent nodes are created
    const freq = filteredFreq; // Map<string, number> of *normalized* tags
    const treeRoots = this.buildTagTree(freq, "/");
    
    // Restore expansion state after building the tree
    expansionManager.restoreExpansionState(treeRoots, searchQuery);

    // Build flat list of all visible tags for keyboard navigation
    const allVisibleTags: TagTreeNode[] = [];
    const collectVisibleTags = (node: TagTreeNode) => {
      allVisibleTags.push(node);
      if (node.children.size > 0 && node.expanded) {
        for (const child of sortNodes(node.children.values(), coTagSort)) {
          collectVisibleTags(child);
        }
      }
    };
    
    // Render all tags in a single unified list
    if (treeRoots.size > 0) {
      const allNodes = Array.from(treeRoots.values());
      const sortedNodes = sortNodes(allNodes, coTagSort);
      // Only expand by default when actively searching
      const expandDefault = Boolean(searchQuery);
      
      for (const node of sortedNodes) {
        this.renderTreeNode(container, node, 0, expandDefault);
        collectVisibleTags(node);
      }
    }
    
    return allVisibleTags;
  }

  /**
   * Build a tag tree from a frequency map
   */
  private buildTagTree(freq: Map<string, number>, delimiter: string): Map<string, TagTreeNode> {
    const allNodes = new Map<string, TagTreeNode>();
    const treeRoots = new Map<string, TagTreeNode>();
    
    // Sort tags by frequency (descending) to ensure parent nodes are created first
    const sortedTags = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
    
    for (const [tag, count] of sortedTags) {
      const parts = tag.split(delimiter);
      let currentPath = "";
      let parentNode: TagTreeNode | null = null;
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}${delimiter}${part}` : part;
        
        let node = allNodes.get(currentPath);
        if (!node) {
          // Create new node
          node = {
            label: part,
            full: currentPath,
            count: 0,
            exactCount: 0,
            children: new Map()
          };
          allNodes.set(currentPath, node);
          
          // Add to parent if exists
          if (parentNode) {
            parentNode.children.set(part, node);
          } else {
            // This is a root node (no parent)
            treeRoots.set(part, node);
          }
        }
        
        // Update counts
        if (i === parts.length - 1) {
          // This is the exact tag
          node.exactCount = count;
        }
        node.count += count;
        
        parentNode = node;
      }
    }
    
    return treeRoots;
  }

  /**
   * Render a single tag tree node
   */
  private renderTreeNode(
    container: HTMLElement, 
    node: TagTreeNode, 
    depth: number, 
    expandDefault: boolean
  ): void {
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
        this.callbacks.onToggleExpansion(node);
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
          this.callbacks.onToggleExcluded(node.full);
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
          this.callbacks.onToggleExpansion(node);
        }, 200);
      });
      
      // Double-click to select the tag
      label.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Alt+double-click should still exclude, not select
        if (e.altKey) {
          this.callbacks.onToggleExcluded(node.full);
          return;
        }
        
        // Cancel any pending single-click
        if (clickTimeout !== null) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
        }
        
        // Select the tag (prefix mode for parents)
        this.callbacks.onAddFacet(node.full, "prefix");
      });
    } else {
      // For non-expandable items: single click = select
      label.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Alt+click to exclude
        if (e.altKey) {
          this.callbacks.onToggleExcluded(node.full);
          return;
        }
        
        this.callbacks.onAddFacet(node.full, "exact");
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
      this.callbacks.onToggleFacetMode(node.full);
    });

    // Recursive rendering for children
    if (node.children.size > 0 && node.expanded) {
      const children = sortNodes(node.children.values(), "count"); // Default sort
      for (const child of children) {
        this.renderTreeNode(container, child, depth + 1, expandDefault);
      }
    }
  }
}
