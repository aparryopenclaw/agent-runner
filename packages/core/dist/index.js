// src/utils/schema.ts
function zodToJsonSchema(schema) {
  if ("_def" in schema && typeof schema._def === "object") {
    try {
      const def = schema._def;
      if (def.typeName === "ZodObject" && "shape" in def) {
        return buildObjectSchema(def);
      }
    } catch {
    }
  }
  return { type: "object" };
}
function buildObjectSchema(def) {
  const shape = typeof def.shape === "function" ? def.shape() : def.shape;
  const properties = {};
  const required = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const fieldDef = fieldSchema._def;
    const typeName = fieldDef.typeName;
    let prop = {};
    if (typeName === "ZodOptional") {
      const innerDef = fieldDef.innerType._def;
      prop = zodTypeToJsonProp(innerDef);
    } else {
      prop = zodTypeToJsonProp(fieldDef);
      required.push(key);
    }
    if (fieldDef.description) {
      prop.description = fieldDef.description;
    }
    properties[key] = prop;
  }
  const result = {
    type: "object",
    properties
  };
  if (required.length > 0) {
    result.required = required;
  }
  return result;
}
function zodTypeToJsonProp(def) {
  const typeName = def.typeName;
  switch (typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodArray": {
      const itemDef = def.type._def;
      return { type: "array", items: zodTypeToJsonProp(itemDef) };
    }
    case "ZodEnum": {
      const values = def.values;
      return { type: "string", enum: values };
    }
    case "ZodRecord":
      return { type: "object", additionalProperties: true };
    case "ZodObject":
      return buildObjectSchema(def);
    default:
      return {};
  }
}

// src/tool.ts
function defineTool(definition) {
  if (!definition.name) {
    throw new Error("Tool definition requires a 'name'");
  }
  if (!definition.description) {
    throw new Error("Tool definition requires a 'description'");
  }
  if (!definition.input) {
    throw new Error("Tool definition requires an 'input' schema");
  }
  if (!definition.execute) {
    throw new Error("Tool definition requires an 'execute' function");
  }
  return definition;
}
var ToolRegistry = class {
  tools = /* @__PURE__ */ new Map();
  /**
   * Register an inline tool.
   */
  register(tool) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    const jsonSchema = zodToJsonSchema(tool.input);
    this.tools.set(tool.name, {
      definition: tool,
      info: {
        name: tool.name,
        description: tool.description,
        source: "inline",
        inputSchema: jsonSchema
      }
    });
  }
  /**
   * Register a tool from an MCP server (already has JSON Schema).
   */
  registerMCP(serverName, toolInfo) {
    const fullName = toolInfo.name;
    this.tools.set(fullName, {
      definition: {
        name: fullName,
        description: toolInfo.description,
        input: {},
        // MCP tools use JSON Schema directly
        execute: async (input, _ctx) => {
          return toolInfo.execute(input);
        }
      },
      info: {
        name: fullName,
        description: toolInfo.description,
        source: `mcp:${serverName}`,
        inputSchema: toolInfo.inputSchema
      }
    });
  }
  /**
   * Get all registered tools as ToolInfo (serializable metadata).
   */
  list() {
    return Array.from(this.tools.values()).map((t) => t.info);
  }
  /**
   * Get a specific tool's info.
   */
  get(name) {
    return this.tools.get(name)?.info;
  }
  /**
   * Get a tool's full definition (includes execute function).
   */
  getDefinition(name) {
    return this.tools.get(name)?.definition;
  }
  /**
   * Execute a tool by name.
   */
  async execute(name, input, ctx) {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new Error(`Tool "${name}" not found in registry`);
    }
    if (entry.info.source === "inline" && entry.definition.input?.parse) {
      input = entry.definition.input.parse(input);
    }
    return entry.definition.execute(input, ctx);
  }
  /**
   * Check if a tool exists.
   */
  has(name) {
    return this.tools.has(name);
  }
  /**
   * Get count of registered tools.
   */
  get size() {
    return this.tools.size;
  }
};

// src/stores/memory.ts
var MemoryStore = class {
  agents = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Map();
  contexts = /* @__PURE__ */ new Map();
  logs = [];
  // ═══ AgentStore ═══
  async getAgent(id) {
    return this.agents.get(id) ?? null;
  }
  async listAgents() {
    return Array.from(this.agents.values()).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description
    }));
  }
  async putAgent(agent) {
    this.agents.set(agent.id, { ...agent, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  }
  async deleteAgent(id) {
    this.agents.delete(id);
  }
  // ═══ SessionStore ═══
  async getMessages(sessionId) {
    return this.sessions.get(sessionId)?.messages ?? [];
  }
  async append(sessionId, messages) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(...messages);
      session.updatedAt = now;
    } else {
      this.sessions.set(sessionId, {
        messages: [...messages],
        createdAt: now,
        updatedAt: now
      });
    }
  }
  async deleteSession(sessionId) {
    this.sessions.delete(sessionId);
  }
  async listSessions(agentId) {
    const result = [];
    for (const [sessionId, session] of this.sessions) {
      if (agentId && session.agentId !== agentId) continue;
      result.push({
        sessionId,
        agentId: session.agentId,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      });
    }
    return result;
  }
  // ═══ ContextStore ═══
  async getContext(contextId) {
    return this.contexts.get(contextId) ?? [];
  }
  async addContext(contextId, entry) {
    const entries = this.contexts.get(contextId) ?? [];
    entries.push(entry);
    this.contexts.set(contextId, entries);
  }
  async clearContext(contextId) {
    this.contexts.delete(contextId);
  }
  // ═══ LogStore ═══
  async log(entry) {
    this.logs.push(entry);
  }
  async getLogs(filter) {
    let result = [...this.logs];
    if (filter?.agentId) {
      result = result.filter((l) => l.agentId === filter.agentId);
    }
    if (filter?.sessionId) {
      result = result.filter((l) => l.sessionId === filter.sessionId);
    }
    if (filter?.since) {
      result = result.filter((l) => l.timestamp >= filter.since);
    }
    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (filter?.offset) {
      result = result.slice(filter.offset);
    }
    if (filter?.limit) {
      result = result.slice(0, filter.limit);
    }
    return result;
  }
  async getLog(id) {
    return this.logs.find((l) => l.id === id) ?? null;
  }
};

// src/model-provider.ts
var AISDKModelProvider = class {
  async generateText(options) {
    const { generateText } = await import("ai");
    const model = await this.resolveModel(options.model);
    const messages = options.messages.map((m) => ({
      role: m.role,
      content: m.content
    }));
    const tools = {};
    if (options.tools?.length) {
      const { tool: aiTool } = await import("ai");
      const { z } = await import("zod");
      for (const t of options.tools) {
        tools[t.name] = aiTool({
          description: t.description,
          parameters: jsonSchemaToZod(t.parameters, z)
        });
      }
    }
    const result = await generateText({
      model,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : void 0,
      maxSteps: 1,
      abortSignal: options.signal
    });
    return {
      text: result.text ?? "",
      toolCalls: result.toolCalls?.map((tc) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        args: tc.args
      })),
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0)
      },
      finishReason: result.finishReason ?? "stop"
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async resolveModel(config) {
    const { provider, name } = config;
    switch (provider) {
      case "openai": {
        const { openai } = await import("@ai-sdk/openai");
        return openai(name);
      }
      case "anthropic": {
        const { anthropic } = await import("@ai-sdk/anthropic");
        return anthropic(name);
      }
      case "google": {
        const { google } = await import("@ai-sdk/google");
        return google(name);
      }
      default:
        throw new Error(
          `Unknown model provider "${provider}". Supported: openai, anthropic, google. For other providers, pass a custom modelProvider to createRunner().`
        );
    }
  }
};
function jsonSchemaToZod(schema, z) {
  if (!schema || schema.type !== "object") {
    return z.object({});
  }
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];
  const shape = {};
  for (const [key, prop] of Object.entries(properties)) {
    let field;
    switch (prop.type) {
      case "string":
        if (prop.enum) {
          field = z.enum(prop.enum);
        } else {
          field = z.string();
        }
        break;
      case "number":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      case "array":
        field = z.array(z.unknown());
        break;
      case "object":
        field = z.record(z.unknown());
        break;
      default:
        field = z.unknown();
    }
    if (!required.includes(key)) {
      field = field.optional();
    }
    if (prop.description) {
      field = field.describe(prop.description);
    }
    shape[key] = field;
  }
  return z.object(shape);
}

// src/message-builder.ts
function buildMessages(options) {
  const { agent, input, sessionHistory, contextEntries, extraContext } = options;
  const messages = [];
  let systemContent = agent.systemPrompt;
  if (agent.examples?.length) {
    systemContent += "\n\n## Examples\n";
    for (const ex of agent.examples) {
      systemContent += `
User: ${ex.input}
Assistant: ${ex.output}
`;
    }
  }
  if (contextEntries && contextEntries.size > 0) {
    systemContent += "\n\n";
    for (const [contextId, entries] of contextEntries) {
      if (entries.length === 0) continue;
      systemContent += `<context id="${contextId}">
`;
      for (const entry of entries) {
        systemContent += `  <entry agent="${entry.agentId}" time="${entry.createdAt}">
`;
        systemContent += `    ${entry.content}
`;
        systemContent += `  </entry>
`;
      }
      systemContent += `</context>
`;
    }
  }
  if (extraContext) {
    systemContent += `

<extra-context>
${extraContext}
</extra-context>`;
  }
  messages.push({ role: "system", content: systemContent });
  if (sessionHistory?.length) {
    for (const msg of sessionHistory) {
      if (msg.role === "system") continue;
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  let userContent = input;
  if (agent.userPromptTemplate) {
    userContent = agent.userPromptTemplate.replace("{{input}}", input);
  }
  messages.push({ role: "user", content: userContent });
  return messages;
}
function trimHistory(messages, maxMessages) {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(-maxMessages);
}

// src/utils/id.ts
import { nanoid } from "nanoid";
function generateId(prefix) {
  const id = nanoid(12);
  return prefix ? `${prefix}_${id}` : id;
}
function generateInvocationId() {
  return generateId("inv");
}

// src/runner.ts
var DEFAULT_MAX_STEPS = 10;
var Runner = class {
  agentStore;
  sessionStore;
  contextStore;
  logStore;
  modelProvider;
  toolRegistry;
  config;
  /** Agents registered in code (not persisted to store) */
  registeredAgents = /* @__PURE__ */ new Map();
  constructor(config = {}) {
    this.config = config;
    if (config.store) {
      this.agentStore = config.store;
      this.sessionStore = config.store;
      this.contextStore = config.store;
      this.logStore = config.store;
    } else {
      const defaultStore = new MemoryStore();
      this.agentStore = config.agentStore ?? defaultStore;
      this.sessionStore = config.sessionStore ?? defaultStore;
      this.contextStore = config.contextStore ?? defaultStore;
      this.logStore = config.logStore ?? defaultStore;
    }
    this.modelProvider = config.modelProvider ?? new AISDKModelProvider();
    this.toolRegistry = new ToolRegistry();
    if (config.tools) {
      for (const tool of config.tools) {
        this.toolRegistry.register(tool);
      }
    }
  }
  // ═══════════════════════════════════════════════════════════════════
  // Agent Management
  // ═══════════════════════════════════════════════════════════════════
  /**
   * Register an agent in memory (not persisted to store).
   * For persisted agents, use the agent store directly.
   */
  registerAgent(agent) {
    this.registeredAgents.set(agent.id, agent);
  }
  /**
   * Register a tool in the registry.
   */
  registerTool(tool) {
    this.toolRegistry.register(tool);
  }
  /**
   * Resolve an agent by ID — checks registered agents first, then the store.
   */
  async resolveAgent(agentId) {
    const registered = this.registeredAgents.get(agentId);
    if (registered) return registered;
    const stored = await this.agentStore.getAgent(agentId);
    if (stored) return stored;
    throw new Error(`Agent "${agentId}" not found. Register it with runner.registerAgent() or add it to the agent store.`);
  }
  // ═══════════════════════════════════════════════════════════════════
  // Tool Registry (public API)
  // ═══════════════════════════════════════════════════════════════════
  get tools() {
    return {
      list: () => this.toolRegistry.list(),
      get: (name) => this.toolRegistry.get(name),
      execute: async (name, input) => {
        const ctx = {
          agentId: "__direct__",
          invocationId: generateInvocationId(),
          invoke: (agentId, input2, options) => this.invoke(agentId, input2, options)
        };
        return this.toolRegistry.execute(name, input, ctx);
      }
    };
  }
  // ═══════════════════════════════════════════════════════════════════
  // Context (public API)
  // ═══════════════════════════════════════════════════════════════════
  get context() {
    return {
      get: (contextId) => this.contextStore.getContext(contextId),
      add: (contextId, entry) => this.contextStore.addContext(contextId, { ...entry, contextId }),
      clear: (contextId) => this.contextStore.clearContext(contextId)
    };
  }
  // ═══════════════════════════════════════════════════════════════════
  // Invocation
  // ═══════════════════════════════════════════════════════════════════
  /**
   * Invoke an agent. This is the main entry point for running an agent.
   */
  async invoke(agentId, input, options = {}) {
    const startTime = Date.now();
    const invocationId = generateInvocationId();
    const agent = await this.resolveAgent(agentId);
    const modelConfig = {
      ...this.config.defaults?.model,
      ...agent.model,
      temperature: agent.model.temperature ?? this.config.defaults?.temperature,
      maxTokens: agent.model.maxTokens ?? this.config.defaults?.maxTokens
    };
    let sessionHistory = [];
    if (options.sessionId) {
      sessionHistory = await this.sessionStore.getMessages(options.sessionId);
      const maxMessages = this.config.session?.maxMessages ?? 50;
      sessionHistory = trimHistory(sessionHistory, maxMessages);
    }
    let contextEntries;
    if (options.contextIds?.length) {
      contextEntries = /* @__PURE__ */ new Map();
      for (const contextId of options.contextIds) {
        const entries = await this.contextStore.getContext(contextId);
        if (entries.length > 0) {
          const maxEntries = this.config.context?.maxEntries ?? 20;
          const trimmed = entries.slice(-maxEntries);
          contextEntries.set(contextId, trimmed);
        }
      }
    }
    const messages = buildMessages({
      agent,
      input,
      sessionHistory,
      contextEntries,
      extraContext: options.extraContext
    });
    const availableTools = this.resolveToolsForAgent(agent);
    const allToolCalls = [];
    const totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finalOutput = "";
    let step = 0;
    while (step < DEFAULT_MAX_STEPS) {
      step++;
      if (options.signal?.aborted) {
        throw new Error("Invocation was cancelled");
      }
      const result = await this.modelProvider.generateText({
        model: modelConfig,
        messages,
        tools: availableTools.length > 0 ? availableTools : void 0,
        signal: options.signal
      });
      totalUsage.promptTokens += result.usage.promptTokens;
      totalUsage.completionTokens += result.usage.completionTokens;
      totalUsage.totalTokens += result.usage.totalTokens;
      if (!result.toolCalls?.length) {
        finalOutput = result.text;
        break;
      }
      const toolResults = [];
      for (const tc of result.toolCalls) {
        const toolStartTime = Date.now();
        const toolCtx = {
          agentId,
          sessionId: options.sessionId,
          contextIds: options.contextIds,
          invocationId,
          invoke: (agentId2, input2, opts) => this.invoke(agentId2, input2, opts),
          ...options.toolContext ?? {}
        };
        let output;
        let error;
        try {
          output = await this.toolRegistry.execute(tc.name, tc.args, toolCtx);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          output = { error };
        }
        const toolCallRecord = {
          id: tc.id,
          name: tc.name,
          input: tc.args,
          output,
          duration: Date.now() - toolStartTime,
          error
        };
        allToolCalls.push(toolCallRecord);
        toolResults.push({
          id: tc.id,
          result: typeof output === "string" ? output : JSON.stringify(output)
        });
      }
      if (result.text) {
        messages.push({ role: "assistant", content: result.text });
      }
      messages.push({
        role: "assistant",
        content: result.toolCalls.map(
          (tc) => `[Tool Call: ${tc.name}(${JSON.stringify(tc.args)})]`
        ).join("\n")
      });
      for (const tr of toolResults) {
        messages.push({ role: "tool", content: tr.result });
      }
      if (result.finishReason === "stop" && result.text) {
        finalOutput = result.text;
        break;
      }
    }
    const duration = Date.now() - startTime;
    const modelStr = `${modelConfig.provider}/${modelConfig.name}`;
    if (options.sessionId) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const newMessages = [
        { role: "user", content: input, timestamp: now },
        {
          role: "assistant",
          content: finalOutput,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : void 0,
          timestamp: now
        }
      ];
      await this.sessionStore.append(options.sessionId, newMessages);
    }
    if (agent.contextWrite && options.contextIds?.length && finalOutput) {
      for (const contextId of options.contextIds) {
        await this.contextStore.addContext(contextId, {
          contextId,
          agentId,
          invocationId,
          content: finalOutput,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    }
    const logEntry = {
      id: invocationId,
      agentId,
      sessionId: options.sessionId,
      input,
      output: finalOutput,
      toolCalls: allToolCalls,
      usage: totalUsage,
      duration,
      model: modelStr,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.logStore.log(logEntry);
    return {
      output: finalOutput,
      invocationId,
      toolCalls: allToolCalls,
      usage: totalUsage,
      duration,
      model: modelStr
    };
  }
  /**
   * Resolve the tools available to an agent based on its tools[] references.
   */
  resolveToolsForAgent(agent) {
    if (!agent.tools?.length) return [];
    const resolved = [];
    for (const ref of agent.tools) {
      if (ref.type === "inline") {
        const info = this.toolRegistry.get(ref.name);
        if (info) {
          resolved.push({
            name: info.name,
            description: info.description,
            parameters: info.inputSchema
          });
        }
      }
    }
    return resolved;
  }
};
function createRunner(config = {}) {
  return new Runner(config);
}

// src/agent.ts
function defineAgent(definition) {
  if (!definition.id) {
    throw new Error("Agent definition requires an 'id'");
  }
  if (!definition.name) {
    throw new Error("Agent definition requires a 'name'");
  }
  if (!definition.systemPrompt) {
    throw new Error("Agent definition requires a 'systemPrompt'");
  }
  if (!definition.model) {
    throw new Error("Agent definition requires a 'model'");
  }
  if (!definition.model.provider || !definition.model.name) {
    throw new Error("Agent model requires both 'provider' and 'name'");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    ...definition,
    createdAt: definition.createdAt ?? now,
    updatedAt: definition.updatedAt ?? now
  };
}

// src/stores/json-file.ts
import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import { join } from "path";
import "fs";
var JsonFileStore = class {
  basePath;
  initialized = false;
  constructor(basePath) {
    this.basePath = basePath;
  }
  async ensureDirs() {
    if (this.initialized) return;
    await mkdir(join(this.basePath, "agents"), { recursive: true });
    await mkdir(join(this.basePath, "sessions"), { recursive: true });
    await mkdir(join(this.basePath, "context"), { recursive: true });
    await mkdir(join(this.basePath, "logs"), { recursive: true });
    this.initialized = true;
  }
  async readJson(path) {
    try {
      const data = await readFile(path, "utf-8");
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  async writeJson(path, data) {
    await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
  }
  sanitizeFilename(id) {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
  }
  // ═══ AgentStore ═══
  async getAgent(id) {
    await this.ensureDirs();
    return this.readJson(
      join(this.basePath, "agents", `${this.sanitizeFilename(id)}.json`)
    );
  }
  async listAgents() {
    await this.ensureDirs();
    const dir = join(this.basePath, "agents");
    const files = await readdir(dir).catch(() => []);
    const agents = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const agent = await this.readJson(join(dir, file));
      if (agent) {
        agents.push({ id: agent.id, name: agent.name, description: agent.description });
      }
    }
    return agents;
  }
  async putAgent(agent) {
    await this.ensureDirs();
    await this.writeJson(
      join(this.basePath, "agents", `${this.sanitizeFilename(agent.id)}.json`),
      { ...agent, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }
    );
  }
  async deleteAgent(id) {
    await this.ensureDirs();
    const path = join(this.basePath, "agents", `${this.sanitizeFilename(id)}.json`);
    await unlink(path).catch(() => {
    });
  }
  // ═══ SessionStore ═══
  async getMessages(sessionId) {
    await this.ensureDirs();
    const data = await this.readJson(
      join(this.basePath, "sessions", `${this.sanitizeFilename(sessionId)}.json`)
    );
    return data?.messages ?? [];
  }
  async append(sessionId, messages) {
    await this.ensureDirs();
    const path = join(this.basePath, "sessions", `${this.sanitizeFilename(sessionId)}.json`);
    const existing = await this.readJson(path);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.writeJson(path, {
      sessionId,
      messages: [...existing?.messages ?? [], ...messages],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
  }
  async deleteSession(sessionId) {
    await this.ensureDirs();
    const path = join(this.basePath, "sessions", `${this.sanitizeFilename(sessionId)}.json`);
    await unlink(path).catch(() => {
    });
  }
  async listSessions(_agentId) {
    await this.ensureDirs();
    const dir = join(this.basePath, "sessions");
    const files = await readdir(dir).catch(() => []);
    const sessions = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = await this.readJson(join(dir, file));
      if (data) {
        sessions.push({
          sessionId: data.sessionId,
          messageCount: data.messages?.length ?? 0,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        });
      }
    }
    return sessions;
  }
  // ═══ ContextStore ═══
  async getContext(contextId) {
    await this.ensureDirs();
    const data = await this.readJson(
      join(this.basePath, "context", `${this.sanitizeFilename(contextId)}.json`)
    );
    return data?.entries ?? [];
  }
  async addContext(contextId, entry) {
    await this.ensureDirs();
    const path = join(this.basePath, "context", `${this.sanitizeFilename(contextId)}.json`);
    const existing = await this.readJson(path);
    const entries = [...existing?.entries ?? [], entry];
    await this.writeJson(path, { contextId, entries });
  }
  async clearContext(contextId) {
    await this.ensureDirs();
    const path = join(this.basePath, "context", `${this.sanitizeFilename(contextId)}.json`);
    await unlink(path).catch(() => {
    });
  }
  // ═══ LogStore ═══
  async log(entry) {
    await this.ensureDirs();
    await this.writeJson(
      join(this.basePath, "logs", `${this.sanitizeFilename(entry.id)}.json`),
      entry
    );
  }
  async getLogs(filter) {
    await this.ensureDirs();
    const dir = join(this.basePath, "logs");
    const files = await readdir(dir).catch(() => []);
    let logs = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const log = await this.readJson(join(dir, file));
      if (log) logs.push(log);
    }
    if (filter?.agentId) {
      logs = logs.filter((l) => l.agentId === filter.agentId);
    }
    if (filter?.sessionId) {
      logs = logs.filter((l) => l.sessionId === filter.sessionId);
    }
    if (filter?.since) {
      logs = logs.filter((l) => l.timestamp >= filter.since);
    }
    logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    if (filter?.offset) {
      logs = logs.slice(filter.offset);
    }
    if (filter?.limit) {
      logs = logs.slice(0, filter.limit);
    }
    return logs;
  }
  async getLog(id) {
    await this.ensureDirs();
    return this.readJson(
      join(this.basePath, "logs", `${this.sanitizeFilename(id)}.json`)
    );
  }
};
export {
  AISDKModelProvider,
  JsonFileStore,
  MemoryStore,
  Runner,
  ToolRegistry,
  createRunner,
  defineAgent,
  defineTool
};
//# sourceMappingURL=index.js.map