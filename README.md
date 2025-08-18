# Facet Tag Navigator

Facet Tag Navigator is an Obsidian plugin that lets you explore your vault through **nested, faceted tag navigation**.  
Instead of searching through flat tag lists, this plugin gives you a flexible way to drill down into your notes by multiple tags, while respecting **tag hierarchy**.

---

## ✨ Features

- **Faceted Tag Filtering** – Select multiple tags to dynamically filter matching notes.  
- **Nested Tag Support** – `Area/CyberSecurity` matches `Area/CyberSecurity`, `Area/CyberSecurity/CTF`, `Area/CyberSecurity/News`, etc.  
- **Search Bar** – Quickly filter tags by typing.  
- **Responsive Results** – Notes update instantly as you refine your filters.  
- **Clear Overview** – Helps you understand how tags are distributed across your vault.  

---

## 🚀 Usage

1. Open the command palette (`Ctrl+P` / `Cmd+P`) and run **Facet Tag Navigator: Open**.  
2. Use the sidebar view to:
   - Search for tags
   - Select multiple tags
   - See all matching notes in real time  
3. Click a note in the results to open it.  

---

## ⚙️ Installation

### From Source
1. Clone this repo into your Obsidian plugins folder:
   ```
   .obsidian/plugins/facet-tag-navigator
   ```
2. Build the plugin:
   ```bash
   npm install
   npm run build
   ```
3. Enable **Facet Tag Navigator** from Obsidian’s Community Plugins settings.

### Manual
- Download the latest release (when available).
- Unzip into `.obsidian/plugins/facet-tag-navigator`.
- Enable in settings.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).  
You’re free to use, modify, and distribute with attribution.

---

## 💡 Motivation

Obsidian’s native tag pane is flat and limited.  
Facet Tag Navigator makes tags **powerful navigation tools**—helping you understand your knowledge base and move through it more intuitively.

