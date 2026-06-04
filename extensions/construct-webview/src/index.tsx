/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Webview Entry Point
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { createRoot } from 'react-dom/client';
import { PlanModal, PlanStep } from './components/PlanModal';

interface VsCodeApi {
	postMessage(message: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

interface WebviewState {
	mode: 'idle' | 'planning' | 'review' | 'executing' | 'done';
	steps: PlanStep[];
	output: string;
}

class App extends React.Component<{}, WebviewState> {
	constructor(props: {}) {
		super(props);
		this.state = {
			mode: 'idle',
			steps: [],
			output: '',
		};

		window.addEventListener('message', (event) => this.handleMessage(event));
	}

	private handleMessage(event: MessageEvent): void {
		const message = event.data;

		switch (message.type) {
			case 'plan':
				this.setState({
					mode: 'review',
					steps: message.steps.map((s: { description: string }, i: number) => ({
						id: i + 1,
						description: s.description,
						checked: true,
					})),
				});
				break;
			case 'executionOutput':
				this.setState(prev => ({ output: prev.output + message.text }));
				break;
			case 'done':
				this.setState({ mode: 'done' });
				break;
		}
	}

	private handleApprove = (steps: PlanStep[]): void => {
		vscode.postMessage({ type: 'approve', steps });
		this.setState({ mode: 'executing' });
	};

	private handleCancel = (): void => {
		vscode.postMessage({ type: 'cancel' });
		this.setState({ mode: 'idle', steps: [], output: '' });
	};

	render(): React.ReactNode {
		const { mode, steps, output } = this.state;

		return (
			<div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
				{mode === 'idle' && (
					<div style={{ padding: '16px', textAlign: 'center', opacity: 0.5 }}>
						<p>Waiting for task...</p>
					</div>
				)}

				{mode === 'planning' && (
					<div style={{ padding: '16px', textAlign: 'center' }}>
						<p>Planning...</p>
					</div>
				)}

				{mode === 'review' && (
					<PlanModal steps={steps} onApprove={this.handleApprove} onCancel={this.handleCancel} />
				)}

				{mode === 'executing' && (
					<div style={{ padding: '16px', flex: 1 }}>
						<h3 style={{ fontSize: '13px', marginBottom: '8px' }}>Executing...</h3>
						<pre style={{
							fontSize: '12px', whiteSpace: 'pre-wrap',
							background: 'var(--vscode-textCodeBlock-background)',
							padding: '8px', borderRadius: '4px',
							overflow: 'auto', flex: 1,
						}}>
							{output}
						</pre>
					</div>
				)}

				{mode === 'done' && (
					<div style={{ padding: '16px' }}>
						<h3 style={{ fontSize: '13px', marginBottom: '8px' }}>Done!</h3>
						<pre style={{
							fontSize: '12px', whiteSpace: 'pre-wrap',
							background: 'var(--vscode-textCodeBlock-background)',
							padding: '8px', borderRadius: '4px',
						}}>
							{output}
						</pre>
						<button
							onClick={() => this.setState({ mode: 'idle', output: '' })}
							style={{
								marginTop: '12px', padding: '6px 16px',
								background: 'var(--vscode-button-background)',
								color: 'var(--vscode-button-foreground)',
								border: 'none', borderRadius: '2px', cursor: 'pointer',
							}}
						>
							New Task
						</button>
					</div>
				)}
			</div>
		);
	}
}

const container = document.getElementById('root');
if (container) {
	const root = createRoot(container);
	root.render(<App />);
}
