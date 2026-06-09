# CONSTRUCT IDE — Blockers
Generated: 2026-06-09

## E2E Testing Blocked
- **Issue**: No desktop/GUI environment available in the build server
- **Impact**: Cannot launch Electron app to verify UI rendering, streaming, or interactive tests
- **Workaround**: All E2E tests must be run on a local development machine
- **Resolution**: Requires X11/Wayland display or VNC setup

## Native Module Builds
- **Issue**: `native-keymap` requires `libxkbfile-dev` system package
- **Impact**: Keyboard mapping may not work correctly in packaged app
- **Workaround**: Install system deps before building: `sudo apt-get install libxkbfile-dev`
- **Resolution**: Add to build CI pipeline
