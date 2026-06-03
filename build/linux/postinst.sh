#!/bin/bash
# Post-install script for Construct IDE
# Update desktop database
if command -v update-desktop-database &>/dev/null; then
    update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi
# Update icon cache
if command -v gtk-update-icon-cache &>/dev/null; then
    gtk-update-icon-cache -q /usr/share/icons/hicolor 2>/dev/null || true
fi
# Set permissions for chrome-sandbox
if [ -f /opt/Construct\ IDE/chrome-sandbox ]; then
    chmod 4755 /opt/Construct\ IDE/chrome-sandbox 2>/dev/null || true
fi
