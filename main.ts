import { App, Plugin, WorkspaceLeaf, Notice } from "obsidian";
import { FacetNavigatorView, VIEW_TYPE_FACET_NAV } from "./FacetNavigatorView";
import { TagIndexer } from "./TagIndexer";
import { FacetNavigatorSettings, SavedView } from "./types";
import { SavedViewPicker } from "./SavedViewPicker";
import { InputModal } from "./InputModal";

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
        if (!names.length) {
          new Notice("No saved views yet.");
          return this.activateView();
        }
        
        new SavedViewPicker(this.app, names, async (name) => {
          const sv = this.settings.savedViews.find(v => v.name === name);
          if (!sv) return;
          await this.activateView(sv.tags);
        }, (name) => {
          // Delete handler
          const index = this.settings.savedViews.findIndex(v => v.name === name);
          if (index !== -1) {
            this.settings.savedViews.splice(index, 1);
            this.saveSettings();
            new Notice(`Deleted saved view: ${name}`);
            // Return true to indicate successful deletion
            return true;
          }
          return false;
        }).open();
      }
    });

    // Manage saved views
    this.addCommand({
      id: "facet-navigator-manage-saved",
      name: "Manage Saved Views…",
      callback: async () => {
        if (this.settings.savedViews.length === 0) {
          new Notice("No saved views to manage.");
          return;
        }
        
        new SavedViewPicker(this.app, this.settings.savedViews.map(v => v.name), 
          async (name) => {
            // Open the view
            const sv = this.settings.savedViews.find(v => v.name === name);
            if (!sv) return;
            await this.activateView(sv.tags);
          }, 
          (name) => {
            // Delete handler
            const index = this.settings.savedViews.findIndex(v => v.name === name);
            if (index !== -1) {
              this.settings.savedViews.splice(index, 1);
              this.saveSettings();
              new Notice(`Deleted saved view: ${name}`);
              // Return true to indicate successful deletion
              return true;
            }
            return false;
          }
        ).open();
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
      console.log(`About to load initial tags:`, initialTags);
      
      // Wait a bit for the view to be fully initialized
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const view = leaf.view as FacetNavigatorView & { setFacets?: (tags: string[]) => void };
      if (view?.setFacets) {
        console.log(`Setting facets to:`, initialTags);
        view.setFacets(initialTags);
      } else if (view?.addFacet) {
        // Fallback: clear then add
        try { (view as any).clearAll?.(); } catch {}
        for (const t of initialTags) view.addFacet(t);
      } else {
        console.error('View not ready to accept facets');
      }
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
      modal.style.position = "fixed";
      modal.style.inset = "0";
      modal.style.background = "rgba(0,0,0,.3)";
      modal.style.display = "grid";
      modal.style.placeItems = "center";
      modal.style.zIndex = "1000";

      const card = document.createElement("div");
      card.style.background = "var(--background-primary)";
      card.style.padding = "1rem";
      card.style.borderRadius = "8px";
      card.style.minWidth = "400px";
      card.style.border = "1px solid var(--background-modifier-border)";

      const title = document.createElement("div");
      title.textContent = label;
      title.style.marginBottom = ".5rem";
      title.style.fontWeight = "bold";

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = hint || "Type to search...";
      input.style.width = "100%";
      input.style.padding = ".5rem";
      input.style.marginBottom = ".75rem";
      input.style.border = "1px solid var(--background-modifier-border)";
      input.style.borderRadius = "4px";
      input.style.background = "var(--background-primary)";
      input.style.color = "var(--text-normal)";

      const buttonRow = document.createElement("div");
      buttonRow.style.display = "flex";
      buttonRow.style.justifyContent = "flex-end";
      buttonRow.style.gap = ".5rem";

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.padding = ".5rem 1rem";
      cancelBtn.style.border = "1px solid var(--background-modifier-border)";
      cancelBtn.style.borderRadius = "4px";
      cancelBtn.style.background = "var(--background-secondary)";
      cancelBtn.style.color = "var(--text-normal)";

      const okBtn = document.createElement("button");
      okBtn.textContent = "OK";
      okBtn.style.padding = ".5rem 1rem";
      okBtn.style.borderRadius = "4px";
      okBtn.style.background = "var(--interactive-accent)";
      okBtn.style.color = "var(--text-on-accent)";
      okBtn.style.border = "none";

      buttonRow.append(cancelBtn, okBtn);
      card.append(title, input, buttonRow);
      modal.append(card);
      document.body.append(modal);

      input.focus();

      const cleanup = () => {
        modal.remove();
      };

      cancelBtn.onclick = cleanup;
      okBtn.onclick = () => {
        const value = input.value.trim();
        if (!value) {
          new Notice("Please enter a value.");
          return;
        }
        cleanup();
        resolve(value);
      };

      // Handle Enter key
      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          okBtn.click();
        } else if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      };
    });
  }
}

