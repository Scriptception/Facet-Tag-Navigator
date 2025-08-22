export type FileId = string; // we'll use file.path as id

export type TagMatchMode = 'exact' | 'prefix';

export interface TagFilter {
  tag: string;         // e.g. 'security' or 'area/company'
  mode: TagMatchMode;  // 'exact' for flat; 'prefix' for nested parents
}

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
  includeDescendantsByDefault: boolean; // whether to include nested tags by default
  coTagSort: "count" | "alpha";     // how to sort co-tags
  resultsPageSize: number;          // how many results to show per page
  showNamespaceHeaders: boolean;    // whether to show namespace headers in co-tags
  startEmpty: boolean;              // don't compute global union when no facets selected
  excludedFolders: string[];        // folders to exclude from indexing and results
}

