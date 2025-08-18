# Facet Tag Navigator

Facet Tag Navigator is an Obsidian plugin that lets you explore your vault through **nested, faceted tag navigation**.  
Instead of searching through flat tag lists, this plugin gives you a flexible way to drill down into your notes by multiple tags, while respecting **tag hierarchy**.

---

## ✨ Features

- **Faceted Tag Filtering** – Select multiple tags to dynamically filter matching notes.  
- **Nested Tag Support** – `Area/CyberSecurity` matches `Area/CyberSecurity`, `Area/CyberSecurity/CTF`, `Area/CyberSecurity/News`, etc.  
- **Exact vs Nested Mode** – Toggle between exact tag matching and including all descendants
- **NOT Facets** – Exclude notes with specific tags using Alt+click
- **Hierarchical Co-tags** – See co-tags organized in a tree structure with roll-up counts
- **Search & Filter** – Quickly find tags and filter results
- **Virtualized Results** – Efficiently handle large result sets with pagination
- **Saved Views** – Save and restore complex tag combinations
- **Performance Optimized** – Efficient indexing and updates for large vaults
- **Customizable Settings** – Tune behavior to your preferences

---

## 🚀 Usage

### Basic Navigation
1. Open the command palette (`Ctrl+P` / `Cmd+P`) and run **Facet Tag Navigator: Open**.  
2. Use the left panel to explore available tags organized hierarchically
3. Click any tag to add it as a facet (filters notes in real-time)
4. View matching notes in the right panel

### Advanced Features
- **Right-click** any tag to toggle between exact and nested mode
- **Alt+click** (middle-click) to exclude tags (NOT facets)
- **Double-click** to expand/collapse tag hierarchies
- **Search** tags using the search bar above the co-tags panel
- **Save Views** using the "Save View" button to preserve complex queries

### Tag Modes
- **Nested Mode** (default): Includes all descendant tags (e.g., `topic/ctf` matches `topic/ctf/hackthebox`)
- **Exact Mode**: Only matches the exact tag specified
- **NOT Facets**: Excludes notes with specific tags

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
3. Enable **Facet Tag Navigator** from Obsidian's Community Plugins settings.

### Manual
- Download the latest release (when available).
- Unzip into `.obsidian/plugins/facet-tag-navigator`.
- Enable in settings.

---

## 🔧 Settings

Access settings via **Settings > Community plugins > Facet Tag Navigator**:

- **Include nested by default**: Whether new facets include descendant tags by default
- **Co-tag sort**: Sort co-tags by count or alphabetically
- **Results page size**: How many results to show per page
- **Show namespace headers**: Display namespace headers in the co-tags panel
- **Start empty**: Don't show all files when no facets are selected (better performance)

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).  
You're free to use, modify, and distribute with attribution.

---

## 💡 Motivation

Obsidian's native tag pane is flat and limited.  
Facet Tag Navigator makes tags **powerful navigation tools**—helping you understand your knowledge base and move through it more intuitively.

## 🔄 Recent Updates

### v0.2.0 - Major Feature Release
- **Exact vs Nested Mode**: Toggle between exact tag matching and including descendants
- **NOT Facets**: Exclude notes with specific tags
- **Hierarchical Co-tags**: Tree view with roll-up counts and expandable nodes
- **Performance Improvements**: Efficient indexing, virtualization, and settings
- **Better UX**: Keyboard shortcuts, tooltips, and improved accessibility
- **Settings Panel**: Customize behavior to your preferences

