import { ZodSchema } from 'zod';

interface AgentDefinition {
    /** Unique identifier (e.g., "code-reviewer") */
    id: string;
    /** Human-readable name */
    name: string;
    /** What this agent does */
    description?: string;
    /** Semantic version */
    version?: string;
    /** The agent's instructions */
    systemPrompt: string;
    /** Few-shot examples */
    examples?: Array<{
        input: string;
        output: string;
    }>;
    /** Template with {{input}} placeholder */
    userPromptTemplate?: string;
    /** Model configuration */
    model: ModelConfig;
    /** References to tools by name/source */
    tools?: ToolReference[];
    /** Structured output constraint (JSON Schema) */
    outputSchema?: Record<string, unknown>;
    /** If true, output auto-writes to context */
    contextWrite?: boolean;
    /** Evaluation configuration */
    eval?: EvalConfig;
    /** Arbitrary tags for categorization */
    tags?: string[];
    /** Arbitrary metadata */
    metadata?: Record<string, unknown>;
    createdAt?: string;
    updatedAt?: string;
}
interface ModelConfig {
    /** Provider name: "openai", "anthropic", "google", etc. */
    provider: string;
    /** Model name: "gpt-4o", "claude-sonnet-4-20250514", etc. */
    name: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    options?: Record<string, unknown>;
}
type ToolReference = {
    type: "inline";
    name: string;
} | {
    type: "mcp";
    server: string;
    tools?: string[];
} | {
    type: "agent";
    agentId: string;
};
interface ToolDefinition<TInput = unknown, TCtx extends Record<string, unknown> = Record<string, unknown>> {
    name: string;
    description: string;
    input: ZodSchema<TInput>;
    contextWrite?: {
        pattern: string;
    };
    execute(input: TInput, ctx: ToolContext & TCtx): Promise<unknown>;
}
interface ToolContext {
    /** ID of the agent executing this tool */
    agentId: string;
    /** Session ID (if conversational) */
    sessionId?: string;
    /** Active context bucket IDs */
    contextIds?: string[];
    /** Unique ID for the current invocation */
    invocationId: string;
    /** Invoke another agent */
    invoke(agentId: string, input: string, options?: InvokeOptions): Promise<InvokeResult>;
    /** Spread toolContext values */
    [key: string]: unknown;
}
interface ToolInfo {
    name: string;
    description: string;
    source: "inline" | `mcp:${string}`;
    inputSchema: Record<string, unknown>;
}
interface InvokeOptions {
    /** Enables conversational continuity */
    sessionId?: string;
    /** Named context buckets to inject */
    contextIds?: string[];
    /** Ad-hoc context string injected into messages */
    extraContext?: string;
    /** Runtime data available to tool execute() via ctx */
    toolContext?: Record<string, unknown>;
    /** Return async iterable instead of awaiting */
    stream?: boolean;
    /** Cancellation */
    signal?: AbortSignal;
}
interface InvokeResult {
    /** The agent's final text response */
    output: string;
    /** Unique ID for this invocation */
    invocationId: string;
    /** All tool calls made during execution */
    toolCalls: ToolCallRecord[];
    /** Token usage */
    usage: TokenUsage;
    /** Milliseconds */
    duration: number;
    /** Model used */
    model: string;
}
interface ToolCallRecord {
    id: string;
    name: string;
    input: unknown;
    output: unknown;
    duration: number;
    error?: string;
}
interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}
interface Message {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    toolCalls?: ToolCallRecord[];
    toolCallId?: string;
    timestamp: string;
}
interface SessionSummary {
    sessionId: string;
    agentId?: string;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
}
interface ContextEntry {
    contextId: string;
    agentId: string;
    invocationId: string;
    content: string;
    createdAt: string;
}
interface InvocationLog {
    id: string;
    agentId: string;
    sessionId?: string;
    input: string;
    output: string;
    toolCalls: ToolCallRecord[];
    usage: TokenUsage;
    duration: number;
    model: string;
    error?: string;
    timestamp: string;
}
interface LogFilter {
    agentId?: string;
    sessionId?: string;
    since?: string;
    limit?: number;
    offset?: number;
}
interface EvalConfig {
    rubric?: string;
    evalModel?: string;
    testCases?: EvalTestCase[];
    autoEval?: boolean;
    passThreshold?: number;
}
interface EvalTestCase {
    name?: string;
    input: string;
    expectedOutput?: string;
    assertions?: EvalAssertion[];
    context?: string;
}
interface EvalAssertion {
    type: "contains" | "not-contains" | "regex" | "json-schema" | "llm-rubric" | "semantic-similar" | "custom";
    value: string | object;
    weight?: number;
}
interface EvalResult {
    agentId: string;
    timestamp: string;
    duration: number;
    testCases: Array<{
        name: string;
        input: string;
        output: string;
        assertions: Array<{
            type: string;
            passed: boolean;
            score?: number;
            reason?: string;
        }>;
        passed: boolean;
        score: number;
    }>;
    summary: {
        total: number;
        passed: number;
        failed: number;
        score: number;
    };
}
interface RunnerConfig {
    /** Single store for all concerns */
    store?: UnifiedStore;
    /** Or split by concern */
    agentStore?: AgentStore;
    sessionStore?: SessionStore;
    contextStore?: ContextStore;
    logStore?: LogStore;
    /** Inline tools */
    tools?: ToolDefinition[];
    /** MCP server configuration */
    mcp?: {
        servers: Record<string, MCPServerConfig>;
    };
    /** Session trimming */
    session?: {
        maxMessages?: number;
        maxTokens?: number;
        strategy?: "sliding" | "summary" | "none";
    };
    /** Context injection limits */
    context?: {
        maxEntries?: number;
        maxTokens?: number;
        strategy?: "latest" | "summary" | "all";
    };
    /** Custom model provider (bypasses ai package) */
    modelProvider?: ModelProvider;
    /** Default model config */
    defaults?: {
        model?: {
            provider: string;
            name: string;
        };
        temperature?: number;
        maxTokens?: number;
    };
}
interface MCPServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
}
interface AgentStore {
    getAgent(id: string): Promise<AgentDefinition | null>;
    listAgents(): Promise<Array<{
        id: string;
        name: string;
        description?: string;
    }>>;
    putAgent(agent: AgentDefinition): Promise<void>;
    deleteAgent(id: string): Promise<void>;
}
interface SessionStore {
    getMessages(sessionId: string): Promise<Message[]>;
    append(sessionId: string, messages: Message[]): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    listSessions(agentId?: string): Promise<SessionSummary[]>;
}
interface ContextStore {
    getContext(contextId: string): Promise<ContextEntry[]>;
    addContext(contextId: string, entry: ContextEntry): Promise<void>;
    clearContext(contextId: string): Promise<void>;
}
interface LogStore {
    log(entry: InvocationLog): Promise<void>;
    getLogs(filter?: LogFilter): Promise<InvocationLog[]>;
    getLog(id: string): Promise<InvocationLog | null>;
}
type UnifiedStore = AgentStore & SessionStore & ContextStore & LogStore;
interface ModelProvider {
    generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;
}
interface GenerateTextOptions {
    model: ModelConfig;
    messages: Array<{
        role: string;
        content: string;
    }>;
    tools?: Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    }>;
    signal?: AbortSignal;
}
interface GenerateTextResult {
    text: string;
    toolCalls?: Array<{
        id: string;
        name: string;
        args: unknown;
    }>;
    usage: TokenUsage;
    finishReason: string;
}

/**
 * The Runner. Central orchestrator for agent-runner.
 * Created via createRunner().
 */
declare class Runner {
    private agentStore;
    private sessionStore;
    private contextStore;
    private logStore;
    private modelProvider;
    private toolRegistry;
    private config;
    /** Agents registered in code (not persisted to store) */
    private registeredAgents;
    constructor(config?: RunnerConfig);
    /**
     * Register an agent in memory (not persisted to store).
     * For persisted agents, use the agent store directly.
     */
    registerAgent(agent: AgentDefinition): void;
    /**
     * Register a tool in the registry.
     */
    registerTool(tool: ToolDefinition): void;
    /**
     * Resolve an agent by ID — checks registered agents first, then the store.
     */
    private resolveAgent;
    get tools(): {
        list: () => ToolInfo[];
        get: (name: string) => ToolInfo | undefined;
        execute: (name: string, input: unknown) => Promise<unknown>;
    };
    get context(): {
        get: (contextId: string) => Promise<ContextEntry[]>;
        add: (contextId: string, entry: Omit<ContextEntry, "contextId">) => Promise<void>;
        clear: (contextId: string) => Promise<void>;
    };
    /**
     * Invoke an agent. This is the main entry point for running an agent.
     */
    invoke(agentId: string, input: string, options?: InvokeOptions): Promise<InvokeResult>;
    /**
     * Resolve the tools available to an agent based on its tools[] references.
     */
    private resolveToolsForAgent;
}
/**
 * Create a runner instance. This is the primary entry point for agent-runner.
 */
declare function createRunner(config?: RunnerConfig): Runner;

/**
 * Define an agent. Validates the definition and adds timestamps.
 * This is a convenience function — you can also create AgentDefinition objects directly.
 */
declare function defineAgent(definition: Omit<AgentDefinition, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
}): AgentDefinition;

/**
 * Define a tool with type-safe input schema and execution function.
 */
declare function defineTool<TCtx extends Record<string, unknown> = Record<string, unknown>>(definition: ToolDefinition<unknown, TCtx>): ToolDefinition<unknown, TCtx>;
/**
 * In-memory tool registry. Single source of truth for all tools
 * regardless of source (inline, MCP, agent).
 */
declare class ToolRegistry {
    private tools;
    /**
     * Register an inline tool.
     */
    register(tool: ToolDefinition): void;
    /**
     * Register a tool from an MCP server (already has JSON Schema).
     */
    registerMCP(serverName: string, toolInfo: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        execute: (input: unknown) => Promise<unknown>;
    }): void;
    /**
     * Get all registered tools as ToolInfo (serializable metadata).
     */
    list(): ToolInfo[];
    /**
     * Get a specific tool's info.
     */
    get(name: string): ToolInfo | undefined;
    /**
     * Get a tool's full definition (includes execute function).
     */
    getDefinition(name: string): ToolDefinition | undefined;
    /**
     * Execute a tool by name.
     */
    execute(name: string, input: unknown, ctx: ToolContext): Promise<unknown>;
    /**
     * Check if a tool exists.
     */
    has(name: string): boolean;
    /**
     * Get count of registered tools.
     */
    get size(): number;
}

/**
 * In-memory store implementation. Useful for testing and ephemeral usage.
 * All data is lost when the process exits.
 */
declare class MemoryStore implements UnifiedStore {
    private agents;
    private sessions;
    private contexts;
    private logs;
    getAgent(id: string): Promise<AgentDefinition | null>;
    listAgents(): Promise<Array<{
        id: string;
        name: string;
        description?: string;
    }>>;
    putAgent(agent: AgentDefinition): Promise<void>;
    deleteAgent(id: string): Promise<void>;
    getMessages(sessionId: string): Promise<Message[]>;
    append(sessionId: string, messages: Message[]): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    listSessions(agentId?: string): Promise<SessionSummary[]>;
    getContext(contextId: string): Promise<ContextEntry[]>;
    addContext(contextId: string, entry: ContextEntry): Promise<void>;
    clearContext(contextId: string): Promise<void>;
    log(entry: InvocationLog): Promise<void>;
    getLogs(filter?: LogFilter): Promise<InvocationLog[]>;
    getLog(id: string): Promise<InvocationLog | null>;
}

/**
 * JSON file store implementation. Stores all data as JSON files on disk.
 * Good for local development and prototyping.
 *
 * Layout:
 *   data/
 *   ├── agents/
 *   │   ├── writer.json
 *   │   └── reviewer.json
 *   ├── sessions/
 *   │   └── sess_abc123.json
 *   ├── context/
 *   │   └── ctx_project.json
 *   └── logs/
 *       └── inv_xyz789.json
 */
declare class JsonFileStore implements UnifiedStore {
    private basePath;
    private initialized;
    constructor(basePath: string);
    private ensureDirs;
    private readJson;
    private writeJson;
    private sanitizeFilename;
    getAgent(id: string): Promise<AgentDefinition | null>;
    listAgents(): Promise<Array<{
        id: string;
        name: string;
        description?: string;
    }>>;
    putAgent(agent: AgentDefinition): Promise<void>;
    deleteAgent(id: string): Promise<void>;
    getMessages(sessionId: string): Promise<Message[]>;
    append(sessionId: string, messages: Message[]): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    listSessions(_agentId?: string): Promise<SessionSummary[]>;
    getContext(contextId: string): Promise<ContextEntry[]>;
    addContext(contextId: string, entry: ContextEntry): Promise<void>;
    clearContext(contextId: string): Promise<void>;
    log(entry: InvocationLog): Promise<void>;
    getLogs(filter?: LogFilter): Promise<InvocationLog[]>;
    getLog(id: string): Promise<InvocationLog | null>;
}

/**
 * Default model provider using the Vercel AI SDK (`ai` package).
 * This is just a client library — calls go directly to OpenAI/Anthropic/Google
 * with the user's own API keys. No Vercel services involved.
 */
declare class AISDKModelProvider implements ModelProvider {
    generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;
    private resolveModel;
}

export { AISDKModelProvider, type AgentDefinition, type AgentStore, type ContextEntry, type ContextStore, type EvalAssertion, type EvalConfig, type EvalResult, type EvalTestCase, type GenerateTextOptions, type GenerateTextResult, type InvocationLog, type InvokeOptions, type InvokeResult, JsonFileStore, type LogFilter, type LogStore, type MCPServerConfig, MemoryStore, type Message, type ModelConfig, type ModelProvider, Runner, type RunnerConfig, type SessionStore, type SessionSummary, type TokenUsage, type ToolCallRecord, type ToolContext, type ToolDefinition, type ToolInfo, type ToolReference, ToolRegistry, type UnifiedStore, createRunner, defineAgent, defineTool };
