/*---------------------------------------------------------------------------------------------
 *  Construct IDE - Agent Error
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export type AgentErrorCode = 'TOOL_FAILURE' | 'LLM_TIMEOUT' | 'MAX_ROUNDS';

export class AgentError extends Error {
	public readonly code: AgentErrorCode;

	constructor(message: string, code: AgentErrorCode) {
		super(message);
		this.name = 'AgentError';
		this.code = code;
	}

	toString(): string {
		return `AgentError [${this.code}]: ${this.message}`;
	}
}
