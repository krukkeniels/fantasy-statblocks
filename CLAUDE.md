# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fantasy Statblocks is an Obsidian plugin that allows users to create, manage, and display fantasy RPG creature statblocks. It supports multiple game systems including D&D 5e, Pathfinder 2e, 13th Age, Fate Core, Daggerheart, and Bunkers & Badasses.

## Build Commands

- **Development**: `npm run dev` - Starts esbuild in watch mode with inline sourcemaps
- **Production Build**: `npm run build` - Creates minified production build
- **Push**: `npm run push` - Pushes with tags to remote repository

## Architecture Overview

### Core Plugin Structure

The plugin entry point is `src/main.ts` which exports `StatBlockPlugin` extending Obsidian's `Plugin` class. On load, it:
1. Initializes the `LayoutManager` to manage statblock layouts
2. Initializes the `Bestiary` system to manage creatures
3. Registers a markdown code block processor for `statblock` blocks
4. Registers the `CreatureView` for viewing creatures in a dedicated pane
5. Sets up the settings tab and API

### Monster/Creature System

Creatures are defined by the `Monster` interface in `index.ts`. The system supports:
- **Extension/Inheritance**: Creatures can extend other creatures using the `extends` field
- **Multiple Sources**: Creatures can come from:
  - SRD data (built-in D&D 5e creatures in `src/bestiary/srd-bestiary.ts`)
  - Local storage (user-created, saved to plugin data)
  - Ephemeral/parsed creatures (from note frontmatter)

The `Bestiary` class (singleton in `src/bestiary/bestiary.ts`) manages all creatures with:
- Index system for filtering by fields (e.g., source)
- Sorting system for different fields
- Extension resolution (resolving `extends` chains)
- Events for bestiary updates

### Layout System

Layouts define how statblocks are rendered. Key files:
- `src/layouts/layout.types.ts` - Defines all layout block types
- `src/layouts/manager.ts` - Manages available layouts
- `src/layouts/index.ts` - Exports all default layouts

**Layout Block Types**: A layout consists of nested blocks with types like:
- Container blocks: `group`, `inline`, `ifelse`, `collapse`
- Content blocks: `property`, `traits`, `spells`, `saves`, `table`, `text`, `image`, `heading`, `subheading`
- Advanced blocks: `javascript`, `layout`, `action`

Each block type is defined in `layout.types.ts` with its specific properties.

**Default Layouts** are provided for each supported game system in `src/layouts/`:
- `basic 5e/` - D&D 5e layout
- `pathfinder 2e/` - Pathfinder 2e layouts
- `13th age/` - 13th Age monster layout
- `fate core/` - Fate Core layout
- `daggerheart/` - Daggerheart layouts
- `BnB/` - Bunkers & Badasses layouts

### Rendering Pipeline

1. **Code Block Processing** (`src/main.ts:postprocessor`):
   - Parses YAML from statblock code block
   - Applies link transformations via `Linkifier`
   - Creates `StatBlockRenderer` instance

2. **StatBlockRenderer** (`src/view/statblock.ts`):
   - Resolves the creature (handles `monster`, `creature`, `extends` fields)
   - Merges creature data with block parameters
   - Renders using Svelte component (`src/view/Statblock.svelte`)

3. **Svelte Components** (`src/view/ui/`):
   - Each block type has a corresponding Svelte component
   - Components recursively render nested blocks
   - Handle markdown rendering, dice rolling integration, etc.

### Frontmatter Parsing (Watcher System)

The `Watcher` class (`src/watcher/watcher.ts`) uses Web Workers to parse creature data from note frontmatter:
- Watches vault for files with `statblock: true` or `statblock: inline` in frontmatter
- Uses multiple workers (based on CPU cores) for parallel processing
- Worker code in `src/watcher/watcher.worker.ts`
- Adds parsed creatures to Bestiary as ephemeral creatures

### Settings and UI

- **Settings Tab** (`src/settings/settings.ts`): Main settings interface with tabs for:
  - Layouts: Create/edit custom layouts
  - Creatures: Browse and manage saved creatures
  - General settings

- **Layout Editor** (`src/settings/layout/`): Drag-and-drop layout builder with:
  - Block editor with property configuration
  - Live preview
  - CSS property editor for appearance customization
  - Advanced features (dice parsing, JavaScript blocks)

### Importers

The `src/importers/` directory contains importers for various third-party sources:
- `5eToolsImport.ts` - 5eTools JSON format
- `ImprovedInitiativeImport.ts` - Improved Initiative format
- `CritterDBImport.ts` - CritterDB format
- `PathbuilderImport.ts` - Pathbuilder format
- `pf2eMonsterToolImport.ts` - PF2e Monster Tool format
- `TetraCubeImport.ts` - TetraCube format
- `DnDAppFilesImport.ts` - D&D Beyond format

Importers use a worker (`importer.worker.ts`) for processing large datasets.

### API

The plugin exposes a public API via `window.FantasyStatblocks` (`src/api/api.ts`). This allows other plugins and scripts to:
- Render statblocks programmatically
- Access the Bestiary
- Get layout information

### Dice Integration

The plugin integrates with the Dice Roller plugin (when installed):
- Uses a custom dice roller source: `FANTASY_STATBLOCKS_PLUGIN`
- Parses dice notation in statblocks (e.g., "1d8+2")
- Supports clickable dice for rolling
- Custom dice parsing rules can be defined per-layout

## Important Patterns

### Settings Persistence

Settings are stored in `data.json` using Obsidian's plugin data API. The `StatblockData` interface defines the structure:
- Monsters stored as `Array<[string, Monster]>` tuples
- Layouts have unique IDs generated with `nanoid()`
- Default layouts can be marked as edited/removed/updatable

### Layout Name vs ID

**Critical**: Layout names in `.` notation (e.g., "Basic 5e.Layout") caused crashes in v4.10.1. When working with layouts:
- Always use `layout.id` internally
- Use `layout.name` only for display
- Handle name-to-ID lookups carefully

### Extension Resolution

When resolving a creature with `extends`:
- `Bestiary.getExtensions()` returns all parent creatures
- Extensions are merged in order (deepest parent first)
- Circular dependencies are detected and logged
- Final creature has all extended properties merged

### Worker Communication

Both Watcher and Importer workers follow a message-passing pattern:
- Workers request data via "get" messages
- Main thread responds with "file" messages
- Workers send "update" messages for processed creatures
- Workers send "save" message when queue is empty

## Common Development Tasks

### Adding a New Layout Block Type

1. Add type to `StatblockItemTypes` array in `src/layouts/layout.types.ts`
2. Define props interface (e.g., `MyBlockProps`)
3. Create item type combining `CommonProps` and props
4. Add to `StatblockItem` union type
5. Create Svelte component in `src/view/ui/MyBlock.svelte`
6. Add editor component in `src/settings/layout/blocks/ui/MyBlock.svelte`
7. Update block creator in `src/settings/layout/blocks/add.ts`

### Adding a New Game System Layout

1. Create directory in `src/layouts/[system-name]/`
2. Create layout definition file (e.g., `my-system.ts`)
3. Export layout object with `name`, `id`, `blocks`, and optional `cssProperties`
4. Add to `DefaultLayouts` array in `src/layouts/index.ts`
5. Create markdown documentation in `publish/` subdirectory
6. Add legal attributions if required

### Working with the Bestiary

Always use `Bestiary.onResolved()` before accessing bestiary data in code that runs on plugin load, as frontmatter parsing is asynchronous.

For synchronous access after bestiary is ready, use `Bestiary.getCreatureFromBestiarySync()` which throws if bestiary is not resolved.

## Build System

Uses esbuild via `esbuild.config.mjs`:
- Bundles Svelte components with `esbuild-svelte`
- Inlines web workers with `esbuild-plugin-inline-worker`
- Processes SASS/SCSS with `esbuild-sass-plugin`
- Entry points: `src/main.ts` and `src/styles.css`
- Development builds to `OUTDIR` environment variable (for hot-reload in Obsidian)
- Production builds to root directory

## Dependencies

- **Obsidian API**: Core plugin functionality
- **Svelte 4**: UI framework for settings and rendering
- **@javalent/dice-roller**: Integration for dice rolling
- **fast-copy**: Deep cloning of monsters/layouts
- **yaml**: YAML parsing for statblock definitions
- **dom-to-image**: Export statblocks as PNG images

## Testing Notes

The plugin is tested manually within Obsidian. There is no automated test suite currently. When testing:
- Use the OUTDIR environment variable to build directly to a test vault
- Test with both SRD enabled and disabled
- Test with frontmatter parsing enabled (autoParse setting)
- Verify layout changes in both edit and preview modes
