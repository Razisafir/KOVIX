/*---------------------------------------------------------------------------------------------
 *  Construct IDE - AI Coding Agent View
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';

export class ConstructAgentViewPane extends ViewPane {

	constructor(
		options: IViewPaneOptions,
	) {
		super(options);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const message = document.createElement('div');
		message.style.padding = '10px';
		message.style.color = '#00E5FF';
		message.style.fontFamily = 'monospace';
		message.textContent = 'Construct Agent - Connect your AI backend to get started';
		container.appendChild(message);
	}

	override layoutBody(height: number, width: number): void {
		// No-op for now
	}
}
