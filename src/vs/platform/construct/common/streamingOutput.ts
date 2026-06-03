/*---------------------------------------------------------------------------------------------
 *  Construct IDE — AI Execution Kernel — Phase 3: Streaming Output Pipeline
 *
 *  IStreamingOutputService -- Incremental output reading with byte-offset
 *  tracking, replacing full-file-reread polling patterns.
 *
 *  REAL responsibilities:
 *    - Track read byte offset per output file
 *    - Read only new bytes since last read (incremental reads)
 *    - Parse partial lines (handle lines split across reads)
 *    - Stream output chunks as events to UI
 *    - Rolling buffer to prevent memory bloat on large outputs
 *    - Tail-like behavior: show last N bytes on first read
 *    - Separate stdout/stderr detection when possible
 *    - Large output safety: cap total bytes, truncate gracefully
 *
 *  Adapted from Real-construct for Construct IDE.
 *  Branding: construct → construct, Construct IDE → Construct IDE
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';

// -- Enumerations --

/**
 * Type of output chunk.
 */
export enum OutputChunkType {
	Stdout = 'stdout',
	Stderr = 'stderr',
	System = 'system',
}

// -- Data Types --

/**
 * An incremental chunk of output read from a command's output file.
 */
export interface OutputChunk {
	/** The execution/session ID this chunk belongs to */
	readonly sessionId: string;
	/** The output file path this was read from */
	readonly filePath: string;
	/** Type of output (best-effort stdout/stderr classification) */
	readonly type: OutputChunkType;
	/** The text content of this chunk */
	readonly text: string;
	/** Byte offset where this chunk starts in the file */
	readonly startOffset: number;
	/** Byte offset where this chunk ends in the file */
	readonly endOffset: number;
	/** Whether this chunk contains a complete line ending */
	readonly isCompleteLine: boolean;
	/** Timestamp when this chunk was read */
	readonly timestamp: number;
}

/**
 * Tracking state for an actively streamed output file.
 */
export interface StreamState {
	/** The session ID being tracked */
	readonly sessionId: string;
	/** The output file path */
	readonly filePath: string;
	/** Current byte offset (next read starts here) */
	readOffset: number;
	/** Partial line buffer (incomplete line from last read) */
	partialLine: string;
	/** Total bytes read so far */
	totalBytesRead: number;
	/** Total chunks emitted */
	totalChunks: number;
	/** Whether the stream is complete (exit marker found) */
	isComplete: boolean;
	/** Timestamp of last read */
	lastReadAt: number;
}

/**
 * Configuration for the streaming output pipeline.
 */
export interface StreamingConfig {
	/** Maximum bytes to keep in rolling buffer per stream (default: 65536 = 64KB) */
	maxRollingBufferBytes: number;
	/** Maximum total bytes to read from a single output (default: 5242880 = 5MB) */
	maxTotalOutputBytes: number;
	/** Number of bytes to show on initial tail read (default: 8192) */
	initialTailBytes: number;
	/** Polling interval in ms for incremental reads (default: 150) */
	pollIntervalMs: number;
	/** Known stderr prefixes for best-effort classification */
	stderrPatterns: string[];
}

/**
 * Statistics for a single output stream.
 */
export interface StreamStatistics {
	/** Total bytes read */
	totalBytesRead: number;
	/** Total chunks emitted */
	totalChunks: number;
	/** Total stdout lines detected */
	stdoutLines: number;
	/** Total stderr lines detected (best-effort) */
	stderrLines: number;
	/** Average chunk size in bytes */
	averageChunkSize: number;
	/** Duration of streaming in ms */
	durationMs: number;
}

// -- Service Interface --

export interface IStreamingOutputService {
	readonly _serviceBrand: undefined;

	/** Fired when a new output chunk is read from any stream */
	readonly onOutputChunk: Event<OutputChunk>;
	/** Fired when a stream is completed (exit marker found) */
	readonly onStreamComplete: Event<{ sessionId: string; totalBytes: number; totalChunks: number }>;
	/** Fired when a stream hits the max output limit */
	readonly onStreamTruncated: Event<{ sessionId: string; maxBytes: number }>;

	/**
	 * Register a new output file for streaming.
	 * Creates a StreamState with offset 0 and begins incremental reading.
	 * If the file already has content, performs an initial tail read.
	 */
	registerStream(sessionId: string, filePath: string): StreamState;

	/**
	 * Unregister a stream. Stops reading and cleans up state.
	 */
	unregisterStream(sessionId: string): void;

	/**
	 * Read incremental output for a specific session.
	 * Reads only new bytes since the last read. Emits OutputChunk events.
	 * Returns the number of new chunks emitted.
	 */
	readIncremental(sessionId: string): Promise<number>;

	/**
	 * Read incremental output for all active streams.
	 * Used by the polling loop to advance all streams.
	 * Returns total new chunks across all streams.
	 */
	readAllActive(): Promise<number>;

	/**
	 * Get the current stream state for a session.
	 */
	getStreamState(sessionId: string): StreamState | null;

	/**
	 * Get the rolling buffer content for a session.
	 * This is the last N bytes of output for UI display.
	 */
	getRollingBuffer(sessionId: string): string;

	/**
	 * Mark a stream as complete (exit marker found).
	 * Performs one final read to capture any remaining output.
	 */
	markComplete(sessionId: string): Promise<void>;

	/**
	 * Get statistics for a specific stream.
	 */
	getStreamStatistics(sessionId: string): StreamStatistics | null;

	/**
	 * Get the streaming configuration.
	 */
	getConfig(): StreamingConfig;

	/**
	 * Update the streaming configuration.
	 */
	updateConfig(config: Partial<StreamingConfig>): void;

	/**
	 * Get all active stream session IDs.
	 */
	getActiveStreamIds(): string[];

	/**
	 * Classify a line of output as stdout or stderr.
	 * Uses pattern matching against known error prefixes.
	 */
	classifyLine(line: string): OutputChunkType;
}

export const IStreamingOutputService = createDecorator<IStreamingOutputService>('construct.streamingOutputService');
