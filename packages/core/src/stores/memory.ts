import type {
  AgentDefinition,
  AgentStore,
  SessionStore,
  ContextStore,
  LogStore,
  UnifiedStore,
  Message,
  SessionSummary,
  ContextEntry,
  InvocationLog,
  LogFilter,
} from "../types.js";

/**
 * In-memory store implementation. Useful for testing and ephemeral usage.
 * All data is lost when the process exits.
 */
export class MemoryStore implements UnifiedStore {
  private agents = new Map<string, AgentDefinition>();
  private sessions = new Map<string, { agentId?: string; messages: Message[]; createdAt: string; updatedAt: string }>();
  private contexts = new Map<string, ContextEntry[]>();
  private logs: InvocationLog[] = [];

  // ═══ AgentStore ═══

  async getAgent(id: string): Promise<AgentDefinition | null> {
    return this.agents.get(id) ?? null;
  }

  async listAgents(): Promise<Array<{ id: string; name: string; description?: string }>> {
    return Array.from(this.agents.values()).map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
    }));
  }

  async putAgent(agent: AgentDefinition): Promise<void> {
    this.agents.set(agent.id, { ...agent, updatedAt: new Date().toISOString() });
  }

  async deleteAgent(id: string): Promise<void> {
    this.agents.delete(id);
  }

  // ═══ SessionStore ═══

  async getMessages(sessionId: string): Promise<Message[]> {
    return this.sessions.get(sessionId)?.messages ?? [];
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    const now = new Date().toISOString();
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(...messages);
      session.updatedAt = now;
    } else {
      this.sessions.set(sessionId, {
        messages: [...messages],
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async listSessions(agentId?: string): Promise<SessionSummary[]> {
    const result: SessionSummary[] = [];
    for (const [sessionId, session] of this.sessions) {
      if (agentId && session.agentId !== agentId) continue;
      result.push({
        sessionId,
        agentId: session.agentId,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }
    return result;
  }

  // ═══ ContextStore ═══

  async getContext(contextId: string): Promise<ContextEntry[]> {
    return this.contexts.get(contextId) ?? [];
  }

  async addContext(contextId: string, entry: ContextEntry): Promise<void> {
    const entries = this.contexts.get(contextId) ?? [];
    entries.push(entry);
    this.contexts.set(contextId, entries);
  }

  async clearContext(contextId: string): Promise<void> {
    this.contexts.delete(contextId);
  }

  // ═══ LogStore ═══

  async log(entry: InvocationLog): Promise<void> {
    this.logs.push(entry);
  }

  async getLogs(filter?: LogFilter): Promise<InvocationLog[]> {
    let result = [...this.logs];

    if (filter?.agentId) {
      result = result.filter(l => l.agentId === filter.agentId);
    }
    if (filter?.sessionId) {
      result = result.filter(l => l.sessionId === filter.sessionId);
    }
    if (filter?.since) {
      result = result.filter(l => l.timestamp >= filter.since!);
    }

    // Sort by timestamp descending (newest first)
    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter?.offset) {
      result = result.slice(filter.offset);
    }
    if (filter?.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  async getLog(id: string): Promise<InvocationLog | null> {
    return this.logs.find(l => l.id === id) ?? null;
  }
}
