import { TFile } from "obsidian";
import { TagIndexer } from "./TagIndexer";

export interface ResultsRendererCallbacks {
  onToggleExcluded: (tag: string) => void;
  onAddFacet: (tag: string) => void;
}

export class ResultsRenderer {
  private callbacks: ResultsRendererCallbacks;
  private indexer: TagIndexer;

  constructor(callbacks: ResultsRendererCallbacks, indexer: TagIndexer) {
    this.callbacks = callbacks;
    this.indexer = indexer;
  }

  /**
   * Render the results section
   */
  renderResults(
    container: HTMLElement,
    currentFiles: Set<string>,
    selectedSize: number,
    startEmpty: boolean,
    resultsPageSize: number
  ): void {
    container.empty();

    const total = currentFiles.size;
    const head = container.createDiv();
    head.createEl("h4", { text: `Results (${total})` });

    if (total === 0) {
      if (selectedSize === 0 && startEmpty) {
        container.createDiv({ 
          text: "Select a tag to start browsing. Use the left panel to explore available tags.", 
          cls: "muted" 
        });
      } else {
        container.createDiv({ text: "No notes match the current facets.", cls: "muted" });
      }
      return;
    }

    // Virtualize results
    const files = Array.from(currentFiles)
      .map(p => this.indexer.app.vault.getAbstractFileByPath(p))
      .filter((f): f is TFile => f instanceof TFile)
      .sort((a, b) => a.basename.localeCompare(b.basename));

    let rendered = 0;

    const renderMore = () => {
      const end = Math.min(rendered + resultsPageSize, files.length);
      for (let i = rendered; i < end; i++) {
        this.renderResultItem(list, files[i]);
      }
      rendered = end;
    };

    const list = container.createDiv();
    renderMore();

    if (rendered < files.length) {
      const more = container.createEl("button", { 
        text: `Load more (${files.length - rendered})`,
        cls: "load-more-btn"
      });
      more.onclick = () => { 
        more.remove(); 
        renderMore(); 
        if (rendered < files.length) {
          container.append(more);
        }
      };
    }
  }

  /**
   * Render a single result item
   */
  private renderResultItem(container: HTMLElement, file: TFile): void {
    const item = container.createDiv({ cls: "result-item" });
    
    const link = item.createEl("a", { text: file.basename, href: "#" });
    link.addEventListener("click", (e) => {
      e.preventDefault();
      this.indexer.app.workspace.getLeaf(true).openFile(file);
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
            this.callbacks.onToggleExcluded(tag);
          } else {
            this.callbacks.onAddFacet(tag);
          }
        });
        tagChip.setAttr("title", `Click to add ${tag} as a facet\nAlt+click to exclude`);
      }
      if (fileTags.size > 5) {
        tagsContainer.createSpan({ text: `+${fileTags.size - 5} more`, cls: "more-tags" });
      }
    }
  }
}
