/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Plan Modal Component
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import React, { useState } from 'react';

export interface PlanStep {
	id: number;
	description: string;
	checked: boolean;
}

interface PlanModalProps {
	steps: PlanStep[];
	onApprove: (steps: PlanStep[]) => void;
	onCancel: () => void;
}

export const PlanModal: React.FC<PlanModalProps> = ({ steps: initialSteps, onApprove, onCancel }) => {
	const [steps, setSteps] = useState<PlanStep[]>(initialSteps);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [editText, setEditText] = useState('');

	const toggleStep = (id: number) => {
		setSteps(prev => prev.map(s => s.id === id ? { ...s, checked: !s.checked } : s));
	};

	const startEditing = (step: PlanStep) => {
		setEditingId(step.id);
		setEditText(step.description);
	};

	const saveEdit = () => {
		if (editingId !== null) {
			setSteps(prev => prev.map(s => s.id === editingId ? { ...s, description: editText } : s));
			setEditingId(null);
			setEditText('');
		}
	};

	const deleteStep = (id: number) => {
		setSteps(prev => prev.filter(s => s.id !== id));
	};

	const handleApprove = () => {
		onApprove(steps.filter(s => s.checked));
	};

	return (
		<div style={{ padding: '16px', fontFamily: 'var(--vscode-font-family)', color: 'var(--vscode-foreground)' }}>
			<h2 style={{ marginBottom: '12px', fontSize: '14px' }}>Plan Review</h2>
			<p style={{ marginBottom: '12px', fontSize: '12px', opacity: 0.7 }}>
				Review and edit the plan before execution. Uncheck steps to skip them.
			</p>

			<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
				{steps.map(step => (
					<div key={step.id} style={{
						display: 'flex', alignItems: 'center', gap: '8px',
						padding: '8px', background: 'var(--vscode-editor-background)',
						borderRadius: '4px', border: '1px solid var(--vscode-panel-border)',
					}}>
						<input
							type="checkbox"
							checked={step.checked}
							onChange={() => toggleStep(step.id)}
							style={{ cursor: 'pointer' }}
						/>
						{editingId === step.id ? (
							<input
								type="text"
								value={editText}
								onChange={e => setEditText(e.target.value)}
								onBlur={saveEdit}
								onKeyDown={e => e.key === 'Enter' && saveEdit()}
								autoFocus
								style={{
									flex: 1, background: 'var(--vscode-input-background)',
									border: '1px solid var(--vscode-focusBorder)',
									color: 'var(--vscode-input-foreground)',
									padding: '4px 8px', borderRadius: '2px',
								}}
							/>
						) : (
							<span
								style={{ flex: 1, fontSize: '13px', cursor: 'pointer' }}
								onDoubleClick={() => startEditing(step)}
							>
								{step.description}
							</span>
						)}
						<button
							onClick={() => deleteStep(step.id)}
							style={{
								background: 'transparent', border: 'none',
								color: 'var(--vscode-errorForeground)', cursor: 'pointer',
								fontSize: '14px', padding: '2px 6px',
							}}
							title="Delete step"
						>
							×
						</button>
					</div>
				))}
			</div>

			<div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
				<button
					onClick={onCancel}
					style={{
						padding: '6px 16px', borderRadius: '2px',
						border: '1px solid var(--vscode-button-secondaryBorder)',
						background: 'var(--vscode-button-secondaryBackground)',
						color: 'var(--vscode-button-secondaryForeground)',
						cursor: 'pointer',
					}}
				>
					Cancel
				</button>
				<button
					onClick={handleApprove}
					style={{
						padding: '6px 16px', borderRadius: '2px',
						border: 'none',
						background: 'var(--vscode-button-background)',
						color: 'var(--vscode-button-foreground)',
						cursor: 'pointer',
					}}
				>
					Approve & Execute
				</button>
			</div>
		</div>
	);
};
