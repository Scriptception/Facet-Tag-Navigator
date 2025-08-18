#!/bin/bash

# Deploy script for Facet Tag Navigator Obsidian plugin
# Usage: ./deploy.sh /path/to/obsidian/vault

set -e  # Exit on any error

# Check if vault path is provided
if [ $# -eq 0 ]; then
    echo "Error: Please provide the path to your Obsidian vault"
    echo "Usage: ./deploy.sh /path/to/obsidian/vault"
    exit 1
fi

VAULT_PATH="$1"
PLUGIN_NAME="facet-tag-navigator"
PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_NAME"

# Check if vault path exists
if [ ! -d "$VAULT_PATH" ]; then
    echo "Error: Vault path '$VAULT_PATH' does not exist"
    exit 1
fi

# Check if .obsidian directory exists
if [ ! -d "$VAULT_PATH/.obsidian" ]; then
    echo "Error: '.obsidian' directory not found in vault. Is this a valid Obsidian vault?"
    exit 1
fi

# Check if plugins directory exists, create if not
if [ ! -d "$VAULT_PATH/.obsidian/plugins" ]; then
    echo "Creating plugins directory..."
    mkdir -p "$VAULT_PATH/.obsidian/plugins"
fi

echo "Building plugin..."
npm run build

if [ $? -ne 0 ]; then
    echo "Error: Build failed"
    exit 1
fi

echo "Installing plugin to: $PLUGIN_DIR"

# Remove existing plugin directory if it exists
if [ -d "$PLUGIN_DIR" ]; then
    echo "Removing existing plugin installation..."
    rm -rf "$PLUGIN_DIR"
fi

# Create plugin directory
mkdir -p "$PLUGIN_DIR"

# Copy plugin files
echo "Copying plugin files..."
cp main.js "$PLUGIN_DIR/"
cp manifest.json "$PLUGIN_DIR/"
cp styles.css "$PLUGIN_DIR/"

# Create data.json if it doesn't exist (for plugin settings)
if [ ! -f "$PLUGIN_DIR/data.json" ]; then
    echo "Creating initial data.json..."
    echo '{"savedViews":[],"groupMode":"namespace","namespaceDelimiter":"/","maxCoTags":150}' > "$PLUGIN_DIR/data.json"
fi

echo "✅ Plugin deployed successfully!"
echo "Plugin installed to: $PLUGIN_DIR"
echo ""
echo "Next steps:"
echo "1. Restart Obsidian or reload the plugin"
echo "2. Enable the plugin in Obsidian settings (Settings > Community plugins)"
echo "3. The plugin should appear as 'Facet Navigator' in your community plugins list"
