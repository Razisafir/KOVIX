/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Context Budget (Token Window Management)
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface ConversationEntry {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export class ContextBudget {
	private readonly entries: ConversationEntry[] = [];
	private readonly maxEntries = 20;
	public static readonly HARD_LIMIT = 60_000;

	addConversationEntry(entry: ConversationEntry): void {
		this.entries.push(entry);
		// Enforce max turns — trim oldest non-system messages
		while (this.entries.length > this.maxEntries) {
			const idx = this.entries.findIndex(e => e.role !== 'system');
			if (idx !== -1) {
				this.entries.splice(idx, 1);
			} else {
				break;
			}
		}
	}

	canAddPrompt(prompt: string): boolean {
		const current = this.getCurrentUsage();
		const estimated = ContextBudget.estimateTokens(prompt);
		return (current + estimated) <= ContextBudget.HARD_LIMIT;
	}

	ensureBudget(prompt: string): void {
		const estimated = ContextBudget.estimateTokens(prompt);
		while (!this.canAddPrompt(prompt) && this.entries.length > 0) {
			// Remove oldest non-system entry
			const idx = this.entries.findIndex(e => e.role !== 'system');
			if (idx !== -1) {
				this.entries.splice(idx, 1);
			} else {
				break;
			}
		}

		if (!this.canAddPrompt(prompt)) {
			throw new Error(`Cannot fit prompt within token budget even after truncation. Estimated: ${estimated}, Limit: ${ContextBudget.HARD_LIMIT}`);
		}
	}

	getCurrentUsage(): number {
		return this.entries.reduce((sum, e) => sum + ContextBudget.estimateTokens(e.content), 0);
	}

	getEntries(): readonly ConversationEntry[] {
		return [...this.entries];
	}

	reset(): void {
		this.entries.length = 0;
	}

	static estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}
}
