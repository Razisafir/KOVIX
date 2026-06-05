# CONSTRUCT IDE E2E Verification

Date: 2026-06-05
Machine: Linux (headless sandbox), 7.9 GB RAM, Node.js v24.16.0

## Build

- **TypeScript type-check (`tsc --noEmit`):** PASS — 0 errors across entire src/
- **Full gulp build (`npm run compile`):** NOT VERIFIED — OOM in 8GB sandbox environment. Requires 16+ GB RAM machine.
- **Fix applied:** `configuration.ts` — `folderConfiguration` property initializer and `configurationFolder` readonly modifier (both caused by the .construct/ fallback logic addition)

## Static Code-Path Verification (10/10 PASS)

All core user-visible branding code paths traced from entry point to UI output:

| # | Target | Verdict | Evidence |
|---|--------|---------|----------|
| 1 | Window Title | PASS | `productService.nameLong` → "Construct IDE" (windowTitle.ts:345) |
| 2 | About Dialog | PASS | `this.productService.nameLong` as message (dialogHandler.ts:102), no Microsoft copyright |
| 3 | Application Menu | PASS | `this.productService.nameShort` → "Construct" (menubar.ts:279) |
| 4 | Taskbar/Dock | PASS | `package.json productName: "CONSTRUCT IDE"` |
| 5 | Protocol Handler | PASS | `urlProtocol: "construct"` (product.json), `app.setAsDefaultProtocolClient` (electronUrlListener.ts:55) |
| 6 | Getting Started | PASS | All strings say "CONSTRUCT" (gettingStartedContent.ts) |
| 7 | Splash Screen | PASS | workbench.html has no branding text, CSP uses `construct-remote-resource:` |
| 8 | Settings UI | PASS | Zero "VS Code"/"Visual Studio Code" in preferences code |
| 9 | Extension Viewlet | PASS | Zero "VS Code"/"Visual Studio Code" in extensions core code |
| 10 | Update Notifications | PASS | All strings use `productService.nameLong`/`nameShort` (update.ts) |

## Launch

- **Status:** NOT VERIFIED — No display server in sandbox environment
- **Window title:** Statically verified as "Construct IDE" (see code path #1)
- **Icon:** `construct.ico`/`construct.icns`/`construct.png` exist in resources/

## About Dialog

- **Status:** NOT VERIFIED (no GUI) — Statically traced: `dialogHandler.ts` uses `productService.nameLong` = "Construct IDE"
- **Copyright:** No hardcoded "Microsoft" copyright in about dialog code. Version/info strings are dynamic.

## Protocol

- **Status:** NOT VERIFIED (no xdg-open/open) — Statically traced: protocol registered as "construct" via `app.setAsDefaultProtocolClient`

## API Key / Agent Loop

- **Status:** NOT VERIFIED — Requires GUI to enter API key and interact with chat panel
- **Code exists:** `src/vs/workbench/contrib/construct/` — construct agent view, agent loop, diff applier, MCP integration

## E2E Test: "Create a React counter app with Vite. Use TypeScript."

- **Status:** NOT RUN — Requires GUI interaction

## Files on Disk

- **Status:** NOT VERIFIED — No E2E test was run

## Comprehensive Branding Audit

### Zero-Reference Checks (PASS)

| Pattern | Count (non-test, non-copyright, non-.d.ts) |
|---------|---------------------------------------------|
| "Visual Studio Code" in src/ | 0 |
| "VS Code" in src/ (non-test) | 0 |
| "vscode://" in src/ | 0 |
| "--vscode-" in src/ | 0 |
| "Visual Studio Code" in extensions/ | 0 |
| "vscode://" in extensions/ | 0 |
| "--vscode-" in build/ | 0 |

### Intentionally Kept as "VS Code"

| Category | Reason | Count |
|----------|--------|-------|
| Copyright headers (`Copyright (c) Microsoft Corporation`) | Legal attribution | ~2000+ files |
| `Schemas.vscode*` constant NAMES | Internal identifiers; values are `construct-*` | ~20 |
| `Microsoft.VisualStudio.Services.*` asset IDs | Open VSX marketplace API contracts | ~10 |
| `from 'vscode'` extension API imports | Extension API module name | Many |
| `verifyMicrosoftInternalDomain` | Internal telemetry function | 2 |
| `Microsoft\Windows\PowerShell\` path | Actual Windows filesystem path | 2 |
| `@vscode/*` npm package names | Third-party packages | Many |

## Blockers

1. **Full build not verified** — `npm run compile` runs out of memory in 8GB sandbox. Needs a machine with 16+ GB RAM.
2. **GUI testing impossible** — No display server, no Electron, no way to launch the app.
3. **API key / agent loop not tested** — Requires GUI to enter credentials and interact.

## Next Steps (Requires Local Machine)

1. Clone and build on a 16+ GB RAM machine: `npm install && npm run compile`
2. Launch: `./scripts/construct.sh`
3. Verify window title shows "CONSTRUCT IDE"
4. Check Help > About shows "Construct IDE" with no Microsoft copyright
5. Test `construct://` protocol with `xdg-open "construct://file/path/to/file"`
6. Enter Anthropic API key in CONSTRUCT settings
7. Run E2E: "Create a React counter app with Vite. Use TypeScript."
8. Verify files created on disk
