# Construct

A modern Tauri v2 desktop application built with React 18, TypeScript, and Tailwind CSS.

## Features

- **Tauri v2** - Rust-powered desktop app shell
- **React 18 + Vite** - Fast development and HMR
- **TypeScript** - Type-safe code throughout
- **Tailwind CSS** - Utility-first styling with custom Catppuccin-inspired theme
- **Monaco Editor** - Full-featured code editor loaded from CDN
- **Zustand** - Lightweight state management
- **React Router** - Client-side routing
- **Lucide React** - Beautiful icon set

## Project Structure

```
construct/
├── src/
│   ├── main/              # Tauri Rust backend
│   │   ├── src/
│   │   │   ├── main.rs    # Entry point
│   │   │   └── lib.rs     # App logic & commands
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── renderer/          # React frontend
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom hooks
│   │   ├── stores/        # Zustand stores
│   │   ├── types/         # TypeScript types
│   │   ├── App.tsx        # Main app layout
│   │   ├── main.tsx       # React entry point
│   │   └── index.css      # Tailwind styles
│   └── shared/            # Shared types
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── index.html
```

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://tauri.app/start/prerequisites/) prerequisites

### Install Dependencies

```bash
# Install frontend dependencies
npm install

# The Tauri CLI will be installed automatically as a dev dependency
```

### Development

```bash
# Start the development server (runs Vite + Tauri)
npm run tauri:dev
```

### Build

```bash
# Build for production
npm run tauri:build
```

The built application will be in `src/main/target/release/bundle/`.

## Monaco Editor Configuration

Monaco Editor is configured to load from CDN via `@monaco-editor/react`'s loader config:

```typescript
loader.config({
  paths: {
    vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs",
  },
});
```

This avoids bundling Monaco with your app, reducing bundle size significantly.

## Custom Theme

The app uses a Catppuccin-inspired dark theme with custom colors defined in `tailwind.config.js`. The editor also has a custom Monaco theme called `"construct-dark"` defined in `src/renderer/hooks/useMonaco.ts`.

## License

MIT
