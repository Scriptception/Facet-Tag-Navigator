import { App, Plugin, WorkspaceLeaf } from "obsidian";
import { FacetNavigatorView, VIEW_TYPE_FACET_NAV } from "./FacetNavigatorView";
import { TagIndexer } from "./TagIndexer";
import { FacetNavigatorSettings, SavedView } from "./types";

const DEFAULT_SETTINGS: FacetNavigatorSettings = {
  savedViews: [],
  groupMode: "namespace",
  namespaceDelimiter: "/",
  maxCoTags: 150
};

export default class FacetNavigatorPlugin extends Plugin {
  settings: FacetNavigatorSettings = DEFAULT_SETTINGS;
  indexer!: TagIndexer;

  async onload() {
    await this.loadSettings();

    this.indexer = new TagIndexer(this.app);
    await this.indexer.rebuild();
    this.indexer.attachWatchers(() => {
      // rerender active views when index updates
      this.app.workspace.getLeavesOfType(VIEW_TYPE_FACET_NAV).forEach(leaf => {
        const view = leaf.view as FacetNavigatorView;
        view?.refresh();
      });
    });

    this.registerView(VIEW_TYPE_FACET_NAV, (leaf) => new FacetNavigatorView(leaf, this.app, this.indexer, this.settings));

    this.addRibbonIcon("filter", "Open Facet Navigator", () => this.activateView());
    this.addCommand({
      id: "facet-navigator-open",
      name: "Open Facet Navigator",
      callback: () => this.activateView()
    });

    // Quick-open saved views
    this.addCommand({
      id: "facet-navigator-open-saved",
      name: "Open Saved View…",
      callback: async () => {
        const names = this.settings.savedViews.map(v => v.name);
        const name = await this.quickPrompt("Saved view name:", names.join(", "));
        const view = this.settings.savedViews.find(v => v.name === name);
        if (!view) return this.activateView();
        await this.activateView(view.tags);
      }
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_FACET_NAV);
  }

  async activateView(initialTags?: string[]) {
    let leaf: WorkspaceLeaf;
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_FACET_NAV);
    if (existing.length) leaf = existing[0];
    else {
      const newLeaf = this.app.workspace.getRightLeaf(false);
      if (!newLeaf) {
        // Fallback to creating a new leaf if getRightLeaf returns null
        leaf = this.app.workspace.getRightLeaf(true)!;
      } else {
        leaf = newLeaf;
      }
    }

    await leaf.setViewState({ type: VIEW_TYPE_FACET_NAV, active: true });
    this.app.workspace.revealLeaf(leaf);

    if (initialTags?.length) {
      const view = leaf.view as FacetNavigatorView;
      for (const t of initialTags) view.addFacet(t);
    }
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async quickPrompt(label: string, hint?: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.style.position = "fixed"; modal.style.inset = "0";
      modal.style.background = "rgba(0,0,0,.3)";
      modal.style.display = "grid"; modal.style.placeItems = "center";
      const card = document.createElement("div");
      card.style.background = "var(--background-primary)";
      card.style.padding = "1rem";
      card.style.borderRadius = "8px";
      card.style.minWidth = "340px";
      const l = document.createElement("div");
      l.textContent = label; l.style.marginBottom = ".5rem";
      const i = document.createElement("input");
      i.type = "text"; i.placeholder = hint || "";
      const row = document.createElement("div");
      row.style.display = "flex"; row.style.justifyContent = "flex-end"; row.style.gap = ".5rem"; row.style.marginTop = ".75rem";
      const ok = document.createElement("button"); ok.textContent = "OK";
      const cancel = document.createElement("button"); cancel.textContent = "Cancel";
      row.append(cancel, ok);
      card.append(l, i, row);
      modal.append(card);
      document.body.append(modal);
      i.focus();
      cancel.onclick = () => { modal.remove(); resolve(null); };
      ok.onclick = () => { const v = i.value?.trim(); modal.remove(); resolve(v || null); };
    });
  }
}

