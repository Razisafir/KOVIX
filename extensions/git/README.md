# Git integration for CONSTRUCT IDE

**Notice:** This extension is bundled with CONSTRUCT IDE. It can be disabled but not uninstalled.

## Features

See [Git support in VS Code](https://github.com/Razisafir/CONSTRUCT-VSCODEdocs/editor/versioncontrol#_git-support) to learn about the features of this extension.

## API

The Git extension exposes an API, reachable by any other extension.

1. Copy `src/api/git.d.ts` to your extension's sources;
2. Include `git.d.ts` in your extension's compilation.
3. Get a hold of the API with the following snippet:

	```ts
	const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git').exports;
	const git = gitExtension.getAPI(1);
	```
	**Note:** To ensure that the `vscode.git` extension is activated before your extension, add `extensionDependencies` ([docs](https://github.com/Razisafir/CONSTRUCT-VSCODEapi/references/extension-manifest)) into the `package.json` of your extension:
	```json
	"extensionDependencies": [
		"vscode.git"
	]
	```
