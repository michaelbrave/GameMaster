# Worldforge

A fantasy world and GameMaster toolkit website built with Elm. An overlying system for managing campaigns, worlds, characters, and encounters.

## Features

- Fantasy world builder
- GameMaster tools (encounter builder, NPC manager, loot tables)
- Character creation and management
- Campaign session tracking

## Tech Stack

- **Elm** (0.19.1) - Frontend language
- **HTML/CSS** - Static assets and styling
- **Node.js** - Build tooling

## Getting Started

```bash
# Install dependencies
npm install -g elm

# Build the Elm app
elm make src/Main.elm --output=public/main.js

# Open public/index.html in a browser
```

## Project Structure

```
GameMaster/
├── elm.json          # Elm project configuration
├── src/              # Elm source files
│   └── Main.elm      # Entry point
├── public/           # Static assets
│   └── index.html    # HTML entry point
└── README.md
```