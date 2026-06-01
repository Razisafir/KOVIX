// Shared API Types between Construct frontend extensions and Python backend
// Both the Tauri frontend and VS Code extension use these contracts

// ============================================================================
// Agent Session Types
// ============================================================================

export interface AgentStartRequest {
    goal: string;
    mode: AgentMode;
    project_path?: string;
    model?: string;
    temperature?: number;
    max_iterations?: number;
}

export type AgentMode = 'code' | 'edit' | 'chat' | 'plan' | 'debug';

export interface AgentSession {
    session_id: string;
    status: AgentSessionStatus;
    goal: string;
    mode: AgentMode;
    created_at: string;
    updated_at: string;
}

export type AgentSessionStatus = 'running' | 'completed' | 'error' | 'cancelled';

// ============================================================================
// Agent Event Types (SSE Stream)
// ============================================================================

export interface AgentEvent {
    type: AgentEventType;
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
}

export type AgentEventType =
    | 'thought'    // Agent's reasoning step
    | 'action'     // Agent executing a tool
    | 'observation' // Result from a tool
    | 'error'      // Error occurred
    | 'complete';  // Session finished

// ============================================================================
// Shadow File System Types
// ============================================================================

export interface FileChange {
    path: string;
    status: FileChangeStatus;
    diff?: string;
    original_content?: string;
    modified_content?: string;
}

export type FileChangeStatus = 'created' | 'modified' | 'deleted';

export interface ShadowMergeRequest {
    path: string | null; // null = merge all
}

export interface ShadowDiscardRequest {
    path: string | null; // null = discard all
}

// ============================================================================
// Memory Types
// ============================================================================

export interface MemoryRecallRequest {
    q: string;
    limit?: number;
    session_id?: string;
}

export interface MemoryEntry {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    score: number;
    timestamp: string;
}

// ============================================================================
// Tool Types
// ============================================================================

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, ToolParameter>;
    category: ToolCategory;
}

export interface ToolParameter {
    type: string;
    description: string;
    required: boolean;
    default?: unknown;
}

export type ToolCategory =
    | 'file_ops'
    | 'code_analysis'
    | 'terminal'
    | 'web'
    | 'memory'
    | 'git'
    | 'search';

// ============================================================================
// LLM Provider Types
// ============================================================================

export interface LLMProvider {
    id: string;
    name: string;
    type: 'local' | 'api';
    models: LLMModel[];
}

export interface LLMModel {
    id: string;
    name: string;
    context_length: number;
    supports_streaming: boolean;
    supports_tools: boolean;
}

// ============================================================================
// Health Check
// ============================================================================

export interface HealthResponse {
    status: 'ok' | 'error';
    version: string;
    uptime: number;
    active_sessions: number;
    llm_provider: string;
    llm_model: string;
}

// ============================================================================
// MCP Types
// ============================================================================

export interface MCPServerConfig {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export interface MCPTool {
    server_name: string;
    tool_name: string;
    description: string;
    input_schema: Record<string, unknown>;
}
