/*---------------------------------------------------------------------------------------------
 *  Construct IDE — AI Execution Kernel — Phase 3: Streaming Output Pipeline
 *
 *  StreamingOutputService -- Concrete implementation of IStreamingOutputService.
 *  Provides incremental output reading with byte-offset tracking, rolling buffers,
 *  and best-effort stdout/stderr classification.
 *
 *  Adapted from Real-construct for Construct IDE.
 *  Key adaptations:
 *    - Branding: construct → construct, Construct IDE → Construct IDE
 *    - Import paths updated for CONSTRUCT-VSCODE directory structure
 *    - createDecorator: streamingOutputService → construct.streamingOutputService
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import {
	IStreamingOutputService,
	OutputChunkType,
	OutputChunk,
	StreamState,
	StreamingConfig,
	StreamStatistics,
} from '../../../../../platform/construct/common/streamingOutput.js';

// -- Default configuration --

const DEFAULT_CONFIG: StreamingConfig = {
	maxRollingBufferBytes: 65536,
	maxTotalOutputBytes: 5242880,
	initialTailBytes: 8192,
	pollIntervalMs: 150,
	stderrPatterns: [
		'error:', 'Error:', 'ERROR:',
		'warning:', 'WARN:',
		'fatal:', 'FATAL:',
		'exception:', 'Exception:',
		'fail:', 'FAIL:',
		'TypeError:', 'SyntaxError:', 'ReferenceError:',
	],
};

/** Exit marker written by the execution layer when a command finishes. */
const EXIT_MARKER = 'CONSTRUCT_EXIT:';

export class StreamingOutputService extends Disposable implements IStreamingOutputService {

	declare readonly _serviceBrand: undefined;

	// -- Event emitters --

	private readonly _onOutputChunk = this._register(new Emitter<OutputChunk>());
	readonly onOutputChunk = this._onOutputChunk.event;

	private readonly _onStreamComplete = this._register(new Emitter<{ sessionId: string; totalBytes: number; totalChunks: number }>());
	readonly onStreamComplete = this._onStreamComplete.event;

	private readonly _onStreamTruncated = this._register(new Emitter<{ sessionId: string; maxBytes: number }>());
	readonly onStreamTruncated = this._onStreamTruncated.event;

	// -- Internal state --

	private readonly streamStates = new Map<string, StreamState>();
	private readonly rollingBuffers = new Map<string, string>();
	private readonly streamStats = new Map<string, {
		stdoutLines: number;
		stderrLines: number;
		startedAt: number;
	}>();

	private config: StreamingConfig = { ...DEFAULT_CONFIG };

	private readonly exitMarker = EXIT_MARKER;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
	) {
		super();
	}

	// -- Public API --

	registerStream(sessionId: string, filePath: string): StreamState {
		const state: StreamState = {
			sessionId,
			filePath,
			readOffset: 0,
			partialLine: '',
			totalBytesRead: 0,
			totalChunks: 0,
			isComplete: false,
			lastReadAt: Date.now(),
		};

		this.streamStates.set(sessionId, state);
		this.rollingBuffers.set(sessionId, '');
		this.streamStats.set(sessionId, {
			stdoutLines: 0,
			stderrLines: 0,
			startedAt: Date.now(),
		});

		this.logService.trace(`[Construct StreamingOutput] registerStream: sessionId=${sessionId}, filePath=${filePath}`);

		// If the file already exists, perform an initial tail read
		const uri = URI.file(filePath);
		this.fileService.exists(uri).then(exists => {
			if (exists) {
				this.fileService.readFile(uri).then(content => {
					const totalBytes = content.value.byteLength;
					if (totalBytes === 0) {
						return;
					}
					const tailStart = Math.max(0, totalBytes - this.config.initialTailBytes);
					const tailText = content.value.toString().substring(tailStart);
					state.readOffset = totalBytes;
					state.totalBytesRead = totalBytes;
					state.lastReadAt = Date.now();

					// Store in rolling buffer (capped)
					const capped = tailText.length > this.config.maxRollingBufferBytes
						? tailText.substring(tailText.length - this.config.maxRollingBufferBytes)
						: tailText;
					this.rollingBuffers.set(sessionId, capped);

					this.logService.trace(`[Construct StreamingOutput] initial tail read: ${totalBytes} bytes, tailStart=${tailStart}`);
				}).catch(err => {
					this.logService.warn(`[Construct StreamingOutput] initial tail read failed for ${filePath}: ${err}`);
				});
			}
		}).catch(err => {
			this.logService.warn(`[Construct StreamingOutput] file existence check failed for ${filePath}: ${err}`);
		});

		return state;
	}

	unregisterStream(sessionId: string): void {
		this.streamStates.delete(sessionId);
		this.rollingBuffers.delete(sessionId);
		this.streamStats.delete(sessionId);
		this.logService.trace(`[Construct StreamingOutput] unregisterStream: sessionId=${sessionId}`);
	}

	async readIncremental(sessionId: string): Promise<number> {
		const state = this.streamStates.get(sessionId);
		if (!state) {
			this.logService.warn(`[Construct StreamingOutput] readIncremental: unknown sessionId=${sessionId}`);
			return 0;
		}
		if (state.isComplete) {
			return 0;
		}

		let newChunks = 0;

		try {
			const uri = URI.file(state.filePath);
			const content = await this.fileService.readFile(uri);
			const totalBytes = content.value.byteLength;

			// Nothing new since last read
			if (totalBytes <= state.readOffset) {
				return 0;
			}

			// Enforce maxTotalOutputBytes cap
			if (state.totalBytesRead >= this.config.maxTotalOutputBytes) {
				this._onStreamTruncated.fire({ sessionId, maxBytes: this.config.maxTotalOutputBytes });
				state.isComplete = true;
				this._onStreamComplete.fire({
					sessionId,
					totalBytes: state.totalBytesRead,
					totalChunks: state.totalChunks,
				});
				return 0;
			}

			// Read only new bytes
			const fullText = content.value.toString();
			const newText = fullText.substring(state.readOffset);
			const bytesInChunk = totalBytes - state.readOffset;

			state.readOffset = totalBytes;
			state.totalBytesRead += bytesInChunk;
			state.lastReadAt = Date.now();

			// Combine with any partial line from previous read
			const combined = state.partialLine + newText;
			state.partialLine = '';

			// Parse into lines
			const lines = combined.split('\n');

			// If the combined text does not end with a newline, the last element is a partial line
			if (combined.length > 0 && !combined.endsWith('\n')) {
				state.partialLine = lines.pop()!;
			} else {
				// Split produces an empty string after trailing newline; remove it
				if (lines.length > 0 && lines[lines.length - 1] === '') {
					lines.pop();
				}
			}

			const stats = this.streamStats.get(sessionId);
			const startOffset = state.readOffset - bytesInChunk;

			// Process each complete line
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const chunkType = this.classifyLine(line);

				// Check for exit marker
				if (line.includes(this.exitMarker)) {
					state.isComplete = true;
				}

				const lineWithNewline = line + '\n';
				const lineOffset = startOffset + (i === 0 ? 0 : lines.slice(0, i).join('\n').length + 1);

				const chunk: OutputChunk = {
					sessionId,
					filePath: state.filePath,
					type: chunkType,
					text: lineWithNewline,
					startOffset: lineOffset,
					endOffset: lineOffset + lineWithNewline.length,
					isCompleteLine: true,
					timestamp: Date.now(),
				};

				this._onOutputChunk.fire(chunk);
				state.totalChunks++;
				newChunks++;

				if (stats) {
					if (chunkType === OutputChunkType.Stderr) {
						stats.stderrLines++;
					} else {
						stats.stdoutLines++;
					}
				}

				// Update rolling buffer
				const currentBuffer = this.rollingBuffers.get(sessionId) ?? '';
				const updatedBuffer = currentBuffer + lineWithNewline;
				this.rollingBuffers.set(sessionId, this._trimRollingBuffer(updatedBuffer));
			}

			// Enforce maxTotalOutputBytes cap after reading
			if (state.totalBytesRead >= this.config.maxTotalOutputBytes) {
				this._onStreamTruncated.fire({ sessionId, maxBytes: this.config.maxTotalOutputBytes });
				state.isComplete = true;
			}

			// If exit marker was found, fire completion event
			if (state.isComplete) {
				this._onStreamComplete.fire({
					sessionId,
					totalBytes: state.totalBytesRead,
					totalChunks: state.totalChunks,
				});
			}
		} catch (err) {
			this.logService.warn(`[Construct StreamingOutput] readIncremental error for sessionId=${sessionId}: ${err}`);
		}

		return newChunks;
	}

	async readAllActive(): Promise<number> {
		let totalChunks = 0;
		for (const sessionId of this.streamStates.keys()) {
			totalChunks += await this.readIncremental(sessionId);
		}
		return totalChunks;
	}

	getStreamState(sessionId: string): StreamState | null {
		return this.streamStates.get(sessionId) ?? null;
	}

	getRollingBuffer(sessionId: string): string {
		return this.rollingBuffers.get(sessionId) ?? '';
	}

	async markComplete(sessionId: string): Promise<void> {
		const state = this.streamStates.get(sessionId);
		if (!state) {
			this.logService.warn(`[Construct StreamingOutput] markComplete: unknown sessionId=${sessionId}`);
			return;
		}

		// Perform one final read to capture any remaining output
		await this.readIncremental(sessionId);

		state.isComplete = true;

		this._onStreamComplete.fire({
			sessionId,
			totalBytes: state.totalBytesRead,
			totalChunks: state.totalChunks,
		});

		this.logService.trace(`[Construct StreamingOutput] markComplete: sessionId=${sessionId}, totalBytes=${state.totalBytesRead}, totalChunks=${state.totalChunks}`);
	}

	getStreamStatistics(sessionId: string): StreamStatistics | null {
		const state = this.streamStates.get(sessionId);
		const stats = this.streamStats.get(sessionId);
		if (!state || !stats) {
			return null;
		}

		const durationMs = Date.now() - stats.startedAt;
		const averageChunkSize = state.totalChunks > 0
			? Math.round(state.totalBytesRead / state.totalChunks)
			: 0;

		return {
			totalBytesRead: state.totalBytesRead,
			totalChunks: state.totalChunks,
			stdoutLines: stats.stdoutLines,
			stderrLines: stats.stderrLines,
			averageChunkSize,
			durationMs,
		};
	}

	classifyLine(line: string): OutputChunkType {
		for (const pattern of this.config.stderrPatterns) {
			if (line.includes(pattern)) {
				return OutputChunkType.Stderr;
			}
		}
		return OutputChunkType.Stdout;
	}

	getConfig(): StreamingConfig {
		return { ...this.config };
	}

	updateConfig(config: Partial<StreamingConfig>): void {
		this.config = { ...this.config, ...config };
		this.logService.trace(`[Construct StreamingOutput] updateConfig: ${JSON.stringify(config)}`);
	}

	getActiveStreamIds(): string[] {
		return Array.from(this.streamStates.keys());
	}

	// -- Private helpers --

	/**
	 * Trim the rolling buffer to stay within maxRollingBufferBytes.
	 */
	private _trimRollingBuffer(buffer: string): string {
		if (buffer.length <= this.config.maxRollingBufferBytes) {
			return buffer;
		}
		const excess = buffer.length - this.config.maxRollingBufferBytes;
		return buffer.substring(excess);
	}
}
