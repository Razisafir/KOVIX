/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IIdeaRefinementService, IIdeaRefinementTurn } from '../../../../../../platform/construct/common/agent/ideaRefinementService.js';
import { IRefinedIdea, IRefinementQuestion } from '../../../../../../platform/construct/common/agent/ideaRefinementTypes.js';
import { IConstructAIService } from '../../../../../../platform/construct/common/llm/constructAIService.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';

interface IRefinementSession {
	history: IIdeaRefinementTurn[];
	refinedIdea: IRefinedIdea | null;
	questionsAndAnswers: IRefinementQuestion[];
	originalDescription: string;
	techStack: string[];
	systemPrompt: string;
}

export class IdeaRefinementService extends Disposable implements IIdeaRefinementService {

	declare readonly _serviceBrand: undefined;

	private readonly sessions = new Map<string, IRefinementSession>();

	constructor(
		@IConstructAIService private readonly aiService: IConstructAIService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async startRefinement(projectId: string, initialDescription: string, techStack: string[]): Promise<string> {
		// If a session already exists for this project, clear it
		if (this.sessions.has(projectId)) {
			this.sessions.delete(projectId);
		}

		const systemPrompt = this.buildSystemPrompt(initialDescription, techStack);

		const session: IRefinementSession = {
			history: [],
			refinedIdea: null,
			questionsAndAnswers: [],
			originalDescription: initialDescription,
			techStack,
			systemPrompt,
		};

		this.sessions.set(projectId, session);

		const messages = [
			{ role: 'system' as const, content: systemPrompt },
			{ role: 'user' as const, content: 'Please ask me your first clarifying question about my project.' },
		];

		const responseText = await this.collectStreamedResponse(messages);

		session.history.push(
			{ role: 'agent', content: responseText },
		);

		this.logService.trace(`IdeaRefinementService#startRefinement: started session for project ${projectId}`);

		return responseText;
	}

	async submitAnswer(projectId: string, answer: string): Promise<{
		nextQuestion?: string;
		readyForPlanning: boolean;
		refinedIdea?: IRefinedIdea;
	}> {
		const session = this.sessions.get(projectId);
		if (!session) {
			throw new Error(`No active refinement session for project ${projectId}`);
		}

		// Record the user's answer in history
		session.history.push({ role: 'user', content: answer });

		// Update the most recent unanswered question with the user's answer
		const lastUnanswered = [...session.questionsAndAnswers].reverse().find(q => q.userAnswer === undefined);
		if (lastUnanswered) {
			lastUnanswered.userAnswer = answer;
		}

		// Build the full message list from the system prompt + conversation history
		const messages = this.buildMessages(session);

		const responseText = await this.collectStreamedResponse(messages);

		// Record the agent's response in history
		session.history.push({ role: 'agent', content: responseText });

		// Check if the agent signals readiness
		if (responseText.includes('READY_FOR_PLANNING')) {
			const refinedIdea = this.parseReadyForPlanning(responseText, session);
			session.refinedIdea = refinedIdea;

			this.logService.info(`IdeaRefinementService#submitAnswer: refinement complete for project ${projectId}`);

			return {
				readyForPlanning: true,
				refinedIdea,
			};
		}

		// Not ready yet — the response is the next question
		const questionId = `q-${session.questionsAndAnswers.length + 1}`;
		session.questionsAndAnswers.push({
			id: questionId,
			question: responseText,
			purpose: 'Clarifying question from agent',
		});

		return {
			nextQuestion: responseText,
			readyForPlanning: false,
		};
	}

	async forceComplete(projectId: string): Promise<IRefinedIdea> {
		const session = this.sessions.get(projectId);
		if (!session) {
			throw new Error(`No active refinement session for project ${projectId}`);
		}

		// Append a force-complete message to history
		session.history.push({
			role: 'user',
			content: 'The user wants to proceed. Please produce the READY_FOR_PLANNING output now.',
		});

		const messages = this.buildMessages(session);

		const responseText = await this.collectStreamedResponse(messages);

		session.history.push({ role: 'agent', content: responseText });

		// Parse the result — handle both the structured READY_FOR_PLANNING format
		// and the case where the LLM doesn't include it
		let refinedIdea: IRefinedIdea;

		if (responseText.includes('READY_FOR_PLANNING')) {
			refinedIdea = this.parseReadyForPlanning(responseText, session);
		} else {
			// Try to extract JSON from the response anyway
			const jsonMatch = responseText.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				try {
					const parsed = JSON.parse(jsonMatch[0]);
					refinedIdea = this.buildRefinedIdeaFromParsed(parsed, session);
				} catch {
					refinedIdea = this.buildFallbackRefinedIdea(session, responseText);
				}
			} else {
				refinedIdea = this.buildFallbackRefinedIdea(session, responseText);
			}
		}

		session.refinedIdea = refinedIdea;

		this.logService.info(`IdeaRefinementService#forceComplete: forced completion for project ${projectId}`);

		return refinedIdea;
	}

	getHistory(projectId: string): IIdeaRefinementTurn[] {
		const session = this.sessions.get(projectId);
		if (!session) {
			return [];
		}
		return [...session.history];
	}

	getRefinedIdea(projectId: string): IRefinedIdea | null {
		const session = this.sessions.get(projectId);
		if (!session) {
			return null;
		}
		return session.refinedIdea;
	}

	isRefinementActive(projectId: string): boolean {
		return this.sessions.has(projectId);
	}

	// ──────────────────────────────────────────────────────────────
	// Private helpers
	// ──────────────────────────────────────────────────────────────

	private buildSystemPrompt(initialDescription: string, techStack: string[]): string {
		return `You are helping a developer clarify their project idea before planning and building it.
Your job is to ask ONE focused question at a time to help them think through their idea more clearly. After 3-5 exchanges, you will have enough information to produce a refined idea specification.

RULES:
- Ask ONE question per turn. Never multiple questions at once.
- Questions should dig into: scope, target users, key technical decisions, constraints, and what "done" looks like.
- Do not suggest solutions. You are clarifying, not designing.
- When you have enough information (after at least 3 turns), respond with:
  READY_FOR_PLANNING
  Followed by a JSON block:
  {
    "refinedDescription": "...",
    "scope": "...",
    "outOfScope": ["..."],
    "constraints": ["..."],
    "successCriteria": ["..."],
    "assumptions": ["..."]
  }

Current project idea: ${initialDescription}
Tech stack: ${techStack.join(', ')}`;
	}

	private buildMessages(session: IRefinementSession): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
		const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
			{ role: 'system', content: session.systemPrompt },
		];

		for (const turn of session.history) {
			messages.push({
				role: turn.role === 'agent' ? 'assistant' : 'user',
				content: turn.content,
			});
		}

		return messages;
	}

	private async collectStreamedResponse(
		messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
	): Promise<string> {
		const stream = this.aiService.chat(messages, [], {});

		let fullText = '';
		for await (const event of stream) {
			if (event.type === 'token') {
				fullText += event.text;
			} else if (event.type === 'error') {
				this.logService.error(`IdeaRefinementService: LLM stream error: ${event.text}`);
				throw new Error(`LLM stream error: ${event.text}`);
			}
		}

		return fullText.trim();
	}

	private parseReadyForPlanning(responseText: string, session: IRefinementSession): IRefinedIdea {
		// Find the JSON block after READY_FOR_PLANNING
		const readyIndex = responseText.indexOf('READY_FOR_PLANNING');
		const textAfterReady = responseText.slice(readyIndex + 'READY_FOR_PLANNING'.length);

		// Extract JSON between first { and last }
		const firstBrace = textAfterReady.indexOf('{');
		const lastBrace = textAfterReady.lastIndexOf('}');

		if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
			const jsonStr = textAfterReady.slice(firstBrace, lastBrace + 1);

			try {
				const parsed = JSON.parse(jsonStr);
				return this.buildRefinedIdeaFromParsed(parsed, session);
			} catch (e) {
				this.logService.warn(`IdeaRefinementService: Failed to parse READY_FOR_PLANNING JSON: ${e}. Building fallback.`);
				return this.buildFallbackRefinedIdea(session, responseText);
			}
		}

		// No JSON block found — build a minimal fallback
		this.logService.warn('IdeaRefinementService: READY_FOR_PLANNING found but no JSON block detected. Building fallback.');
		return this.buildFallbackRefinedIdea(session, responseText);
	}

	private buildRefinedIdeaFromParsed(parsed: Record<string, unknown>, session: IRefinementSession): IRefinedIdea {
		return {
			originalDescription: session.originalDescription,
			refinedDescription: typeof parsed.refinedDescription === 'string' ? parsed.refinedDescription : session.originalDescription,
			scope: typeof parsed.scope === 'string' ? parsed.scope : '',
			outOfScope: Array.isArray(parsed.outOfScope) ? parsed.outOfScope.filter((s: unknown) => typeof s === 'string') : [],
			constraints: Array.isArray(parsed.constraints) ? parsed.constraints.filter((s: unknown) => typeof s === 'string') : [],
			successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria.filter((s: unknown) => typeof s === 'string') : [],
			assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.filter((s: unknown) => typeof s === 'string') : [],
			questionsAndAnswers: [...session.questionsAndAnswers],
			readyForPlanning: true,
		};
	}

	private buildFallbackRefinedIdea(session: IRefinementSession, rawText: string): IRefinedIdea {
		// Construct a minimal IRefinedIdea from the conversation text
		// Extract whatever useful information we can from the raw response
		const conversationSummary = session.history
			.filter(t => t.role === 'user')
			.map(t => t.content)
			.join(' ');

		return {
			originalDescription: session.originalDescription,
			refinedDescription: rawText.replace(/READY_FOR_PLANNING/g, '').trim() || session.originalDescription,
			scope: conversationSummary || 'See refined description',
			outOfScope: [],
			constraints: [],
			successCriteria: [],
			assumptions: [],
			questionsAndAnswers: [...session.questionsAndAnswers],
			readyForPlanning: true,
		};
	}
}
