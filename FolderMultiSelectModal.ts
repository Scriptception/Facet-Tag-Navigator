import { App, Modal, TAbstractFile, TFolder } from "obsidian";

/** ──────────────────────────────────────────────────────────────────────────
 * FolderMultiSelectModal: searchable multi-select of vault folders
 * ────────────────────────────────────────────────────────────────────────── */
export class FolderMultiSelectModal extends Modal {
  private allFolders: string[] = [];
  private filtered: string[] = [];
  private selected = new Set<string>();
  private onDone: (selected: string[]) => void;

  private searchEl!: HTMLInputElement;
  private listEl!: HTMLDivElement;

  constructor(app: App, preselected: string[], onDone: (selected: string[]) => void) {
    super(app);
    preselected.forEach(p => this.selected.add(p));
    this.onDone = onDone;
  }

  onOpen(): void {
    this.setTitle("Select folders to exclude");

    const root = this.contentEl.createDiv({ cls: "folder-select" });

    // Search box
    const searchWrap = root.createDiv({ cls: "folder-select-search" });
    this.searchEl = searchWrap.createEl("input", {
      type: "search",
      placeholder: "Search folders…",
    });
    this.searchEl.addEventListener("input", () => this.applyFilter());

    // Scrollable list
    this.listEl = root.createDiv({ cls: "folder-select-list" });

    // Footer actions
    const footer = root.createDiv({ cls: "folder-select-footer" });
    const selectAllBtn = footer.createEl("button", { text: "Select all (filtered)" });
    const clearBtn = footer.createEl("button", { text: "Clear" });
    const doneBtn = footer.createEl("button", { text: "Done" });

    selectAllBtn.onclick = () => {
      for (const p of this.filtered) this.selected.add(p);
      this.renderList();
    };
    clearBtn.onclick = () => {
      this.selected.clear();
      this.renderList();
    };
    doneBtn.onclick = () => {
      this.onDone(Array.from(this.selected).sort());
      this.close();
    };

    // Load folders and render
    this.allFolders = getAllFolderPaths(this.app);
    this.filtered = [...this.allFolders];
    this.renderList();

    // Keyboard affordances (Esc to close; Enter to confirm)
    this.scope.register([], "Escape", () => this.close());
    this.scope.register([], "Enter", () => {
      this.onDone(Array.from(this.selected).sort());
      this.close();
    });

    // Styles
    const style = document.createElement("style");
    style.textContent = `
      .folder-select { display:flex; flex-direction:column; gap: 8px; }
      .folder-select-search input { width:100%; padding:6px 8px; }
      .folder-select-list { max-height: 320px; overflow:auto; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding:6px; }
      .folder-row { display:flex; align-items:center; gap: 8px; padding: 4px 2px; border-radius:4px; }
      .folder-row:hover { background: var(--background-modifier-hover); }
      .folder-path { font-family: var(--font-monospace); font-size: 12px; opacity: 0.9; }
      .folder-select-footer { display:flex; justify-content: space-between; gap:8px; margin-top: 4px; }
      .folder-select-footer button { padding: 6px 10px; }
    `;
    this.contentEl.appendChild(style);

    // Focus search by default
    setTimeout(() => this.searchEl.focus(), 0);
  }

  private applyFilter() {
    const q = this.searchEl.value.toLowerCase().trim();
    this.filtered = !q
      ? [...this.allFolders]
      : this.allFolders.filter(p => p.toLowerCase().includes(q));
    this.renderList();
  }

  private renderList() {
    this.listEl.empty();
    for (const path of this.filtered) {
      const row = this.listEl.createDiv({ cls: "folder-row" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = this.selected.has(path);
      cb.onchange = () => {
        if (cb.checked) this.selected.add(path);
        else this.selected.delete(path);
      };
      row.createSpan({ cls: "folder-path", text: path });
      // Click row toggles
      row.onclick = (e) => {
        // ignore clicks directly on checkbox
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        cb.onchange!(null as any);
      };
    }
  }
}

/** ──────────────────────────────────────────────────────────────────────────
 * Utilities: gather all folder paths
 * ────────────────────────────────────────────────────────────────────────── */
function getAllFolderPaths(app: App): string[] {
  const arr: string[] = [];
  const all = app.vault.getAllLoadedFiles(); // TAbstractFile[]
  for (const af of all) {
    if (af instanceof TFolder) {
      // Use root as ""? Prefer "/" for clarity; skip the root itself.
      arr.push(af.path); // path like "Folder/Sub"
    }
  }
  // Ensure deterministic order
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}
