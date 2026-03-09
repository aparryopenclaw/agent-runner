import React, { useState } from "react";
import { useQuery, api } from "../hooks/useApi";
import { PageHeader, Card, Badge, EmptyState, Spinner, ErrorBox, Button, Select, CodeBlock } from "../components/shared";

export function Evals() {
  const { data: agents } = useQuery<any[]>("/agents");
  const [agentId, setAgentId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!agentId) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.runEval(agentId);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  // Find agents with eval configs
  const evallableAgents = agents?.filter((a: any) => a.eval?.testCases?.length > 0) || [];

  return (
    <div>
      <PageHeader
        title="Evals"
        subtitle="Run evaluation suites and inspect results"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Select
              value={agentId}
              onChange={setAgentId}
              options={[
                { value: "", label: "Select agent..." },
                ...(agents?.map((a: any) => ({
                  value: a.id,
                  label: `${a.name || a.id}${a.eval?.testCases?.length ? ` (${a.eval.testCases.length} tests)` : ""}`,
                })) || []),
              ]}
            />
            <Button variant="primary" onClick={handleRun} disabled={!agentId || running}>
              {running ? "⏳ Running..." : "▶️ Run Evals"}
            </Button>
          </div>
        }
      />

      {!agentId && evallableAgents.length === 0 && (
        <EmptyState
          icon="🧪"
          title="No eval suites configured"
          subtitle="Add testCases to an agent's eval config to get started"
        />
      )}

      {!agentId && evallableAgents.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
          {evallableAgents.map((agent: any) => (
            <Card key={agent.id} onClick={() => setAgentId(agent.id)}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{agent.name || agent.id}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                {agent.eval.testCases.length} test case{agent.eval.testCases.length !== 1 ? "s" : ""}
              </div>
              {agent.eval.rubric && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  📏 Rubric: {agent.eval.rubric.substring(0, 60)}...
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {error && <ErrorBox message={error} />}

      {result && (
        <div>
          {/* Summary */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: result.summary.score >= 0.7 ? "var(--success)" : "var(--error)" }}>
                {(result.summary.score * 100).toFixed(0)}%
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {result.summary.passed}/{result.summary.total} passed
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {result.duration}ms • {new Date(result.timestamp).toLocaleString()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {result.summary.passed > 0 && <Badge variant="success">✅ {result.summary.passed} passed</Badge>}
                {result.summary.failed > 0 && <Badge variant="error">❌ {result.summary.failed} failed</Badge>}
              </div>
            </div>
          </Card>

          {/* Test Cases */}
          {result.testCases.map((tc: any, i: number) => (
            <Card key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 16 }}>{tc.passed ? "✅" : "❌"}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{tc.name}</span>
                  <Badge variant={tc.passed ? "success" : "error"}>{(tc.score * 100).toFixed(0)}%</Badge>
                </div>
              </div>

              <div style={{ marginTop: 8, fontSize: 13 }}>
                <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Input:</div>
                <div style={{ padding: "6px 10px", background: "var(--bg-elevated)", borderRadius: 4, marginBottom: 8 }}>{tc.input}</div>
                <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Output:</div>
                <div style={{ padding: "6px 10px", background: "var(--bg-elevated)", borderRadius: 4, marginBottom: 8, whiteSpace: "pre-wrap" }}>{tc.output}</div>
              </div>

              {tc.assertions.map((a: any, j: number) => (
                <div key={j} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "4px 0" }}>
                  <span>{a.passed ? "✓" : "✗"}</span>
                  <Badge variant={a.passed ? "success" : "error"}>{a.type}</Badge>
                  {a.reason && <span style={{ color: "var(--text-muted)" }}>{a.reason}</span>}
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
