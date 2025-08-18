export type FileId = string; // we’ll use file.path as id

export interface SavedView {
  name: string;
  tags: string[];        // included (AND)
  exclude?: string[];    // optional NOT facets (future use)
}

export interface FacetNavigatorSettings {
  savedViews: SavedView[];
  groupMode: "namespace" | "root";  // how to group co-tags
  namespaceDelimiter: string;       // e.g., "/"
  maxCoTags: number;                // limit list length for perf
}

