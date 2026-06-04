/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Disposable Helper
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export class Disposable {
	private readonly callback: () => void;

	constructor(callback: () => void) {
		this.callback = callback;
	}

	dispose(): void {
		this.callback();
	}

	static from(...disposables: { dispose(): void }[]): Disposable {
		return new Disposable(() => {
			for (const d of disposables) {
				d.dispose();
			}
		});
	}
}
