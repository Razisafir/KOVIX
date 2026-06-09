# Construct IDE Branding Assets

Place the following files here before building a release:
- construct.ico (Windows icon, 256x256)
- construct.icns (macOS icon)
- construct-512.png (Linux icon, 512x512)
- construct-256.png (256x256 PNG)
- construct-128.png (128x128 PNG)

These must replace the corresponding files in /resources/ before running the build pipeline.

## How to Replace Icons

After placing your icon files here, copy them to the appropriate locations:

### Windows
```bash
cp branding/construct.ico resources/win32/construct.ico
cp branding/construct.ico resources/win32/code.ico
```

### macOS
```bash
cp branding/construct.icns resources/darwin/construct.icns
cp branding/construct.icns resources/darwin/code.icns
```

### Linux
```bash
cp branding/construct-512.png resources/linux/construct.png
cp branding/construct-512.png resources/linux/code.png
```

### Server (Web)
```bash
cp branding/construct-512.png resources/server/construct-512.png
cp branding/construct-192.png resources/server/construct-192.png
```

### Windows Tile Icons
```bash
cp branding/construct-150x150.png resources/win32/construct_150x150.png
cp branding/construct-70x70.png resources/win32/construct_70x70.png
```
