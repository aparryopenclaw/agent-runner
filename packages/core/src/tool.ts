import type { ToolDefinition, ToolInfo, ToolContext } from "./types.js";
import { zodToJsonSchema } from "./utils/schema.js";
import type { ZodSchema } from "zod";

/**
 * Define a tool with type-safe input schema and execution function.
 */
export function defineTool<TCtx extends Record<string, unknown> = Record<string, unknown>>(
  definition: ToolDefinition<unknown, TCtx>
): ToolDefinition<unknown, TCtx> {
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

/**
 * In-memory tool registry. Single source of truth for all tools
 * regardless of source (inline, MCP, agent).
 */
export class ToolRegistry {
  private tools = new Map<string, {
    definition: ToolDefinition;
    info: ToolInfo;
  }>();

  /**
   * Register an inline tool.
   */
  register(tool: ToolDefinition): void {
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
        inputSchema: jsonSchema,
      },
    });
  }

  /**
   * Register a tool from an MCP server (already has JSON Schema).
   */
  registerMCP(serverName: string, toolInfo: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: unknown) => Promise<unknown>;
  }): void {
    const fullName = toolInfo.name;

    this.tools.set(fullName, {
      definition: {
        name: fullName,
        description: toolInfo.description,
        input: {} as ZodSchema, // MCP tools use JSON Schema directly
        execute: async (input: unknown, _ctx: ToolContext) => {
          return toolInfo.execute(input);
        },
      },
      info: {
        name: fullName,
        description: toolInfo.description,
        source: `mcp:${serverName}`,
        inputSchema: toolInfo.inputSchema,
      },
    });
  }

  /**
   * Get all registered tools as ToolInfo (serializable metadata).
   */
  list(): ToolInfo[] {
    return Array.from(this.tools.values()).map(t => t.info);
  }

  /**
   * Get a specific tool's info.
   */
  get(name: string): ToolInfo | undefined {
    return this.tools.get(name)?.info;
  }

  /**
   * Get a tool's full definition (includes execute function).
   */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  /**
   * Execute a tool by name.
   */
  async execute(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
    const entry = this.tools.get(name);
    if (!entry) {
      throw new Error(`Tool "${name}" not found in registry`);
    }

    // Validate input with Zod if available (inline tools)
    if (entry.info.source === "inline" && entry.definition.input?.parse) {
      input = entry.definition.input.parse(input);
    }

    return entry.definition.execute(input, ctx);
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get count of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }
}
