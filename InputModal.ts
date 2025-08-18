import { App, Modal } from "obsidian";

export class InputModal extends Modal {
  private label: string;
  private initial: string;
  private onSubmit: (value: string) => void;

  constructor(app: App, label: string, initial: string, onSubmit: (value: string) => void) {
    super(app);
    this.label = label;
    this.initial = initial;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    const wrap = contentEl.createDiv({ cls: "facet-input-modal" });
    wrap.innerHTML = `
      <div class="facet-input-label">${this.label}</div>
      <input type="text" class="facet-input-field" placeholder="${this.label}" />
      <div class="facet-input-actions">
        <button class="ok">OK</button>
        <button class="cancel">Cancel</button>
      </div>
    `;

    const input = wrap.querySelector<HTMLInputElement>(".facet-input-field")!;
    const okBtn = wrap.querySelector<HTMLButtonElement>("button.ok")!;
    const cancelBtn = wrap.querySelector<HTMLButtonElement>("button.cancel")!;

    input.value = this.initial ?? "";
    setTimeout(() => input.focus(), 0);

    const submit = () => {
      const v = input.value.trim();
      if (!v) return;
      this.onSubmit(v);
      this.close();
    };

    okBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => this.close());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
