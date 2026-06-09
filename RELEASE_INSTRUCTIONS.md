# How to Create a Release

## Step 1: Make sure everything is committed
```bash
git status  # Should show nothing to commit
```

## Step 2: Create a version tag
```bash
git tag -a v1.0.0 -m "Construct IDE v1.0.0 — Initial Release"
git push origin v1.0.0
```

## Step 3: Watch the build
- Go to: https://github.com/Razisafir/CONSTRUCT-VSCODE/actions
- You will see the "Release Build" workflow running
- Wait for all three jobs (Windows, macOS, Linux) to complete

## Step 4: Find your release
- Go to: https://github.com/Razisafir/CONSTRUCT-VSCODE/releases
- Your release with download links will be there automatically

## Step 5: Announce
Share the GitHub Releases page with your users.
