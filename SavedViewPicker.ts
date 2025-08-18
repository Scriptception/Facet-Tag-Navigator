import { App, SuggestModal } from "obsidian";

export class SavedViewPicker extends SuggestModal<string> {
  private items: string[];
  private onPick: (value: string) => void;
  private onDelete?: (value: string) => void;

  constructor(app: App, items: string[], onPick: (value: string) => void, onDelete?: (value: string) => void) {
    super(app);
    this.items = items;
    this.onPick = onPick;
    this.onDelete = onDelete;
    this.setPlaceholder("Type to filter saved views…");
  }

  getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.items;
    return this.items.filter(n => n.toLowerCase().includes(q));
  }

  renderSuggestion(value: string, el: HTMLElement) {
    const row = el.createDiv({ cls: "facet-sv-suggestion" });
    
    const nameEl = row.createEl("div", { text: value, cls: "facet-sv-name" });
    
    if (this.onDelete) {
      const deleteBtn = row.createEl("button", { 
        text: "×", 
        cls: "facet-sv-delete",
        attr: { title: "Delete saved view" }
      });
      
      deleteBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Invoke external delete logic first (updates plugin settings)
        this.onDelete!(value);
        // Mutate local items
        this.items = this.items.filter(item => item !== value);
        // Keep focus in input and ask SuggestModal to recompute suggestions
        this.inputEl.focus();
        requestAnimationFrame(() => {
          const matches = this.getSuggestions(this.inputEl.value);
          if (matches.length === 0) {
            this.close();
          } else {
            this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
      });
    }
  }

  onChooseSuggestion(item: string): void {
    this.onPick(item);
  }
}
