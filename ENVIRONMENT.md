# Kovix — Environment Report
Generated: 2026-06-09

## System
- **OS**: Linux 5.10.134 x86_64
- **Node**: v20.20.2 (via nvm)
- **npm**: 10.8.2
- **Python**: 3.12.13
- **Git**: 2.47.3

## Build Status
- **npm install**: ✅ Passes (with --ignore-scripts)
- **TypeScript compilation (tsc --noEmit)**: ✅ Zero errors
- **Gulp compile**: ⚠️ OOM in 8GB RAM environment

## Known Environment Limitations
- native-keymap cannot build (missing libxkbfile-dev)
- Full gulp compile requires >8GB RAM
