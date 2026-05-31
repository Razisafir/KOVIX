import React, { useState, useEffect, useCallback } from 'react';

interface TraceSpan {
  span_id: string;
  trace_id: string;
  parent_id: string | null;
  session_id: string;
  iteration: number;
  kind: string; // thought, action, observation, tool_call, llm_call, verification
  name: string;
  start_time: number;
  end_time: number | null;
  status: string; // ok, error, hallucination, timeout, uncertain
  attributes: Record<string, unknown>;
  input_data: string | null;
  output_data: string | null;
  latency_ms: number | null;
}

interface TraceViewerProps {
  sessionId: string;
  apiUrl?: string;
  onClose?: () => void;
}

const kindConfig: Record<string, { icon: string; color: string; label: string }> = {
  thought: { icon: '💡', color: '#9b7cf7', label: 'Thought' },
  action: { icon: '⚡', color: '#4f8ef7', label: 'Action' },
  observation: { icon: '👁', color: '#00d26a', label: 'Observation' },
  tool_call: { icon: '🔧', color: '#f5a623', label: 'Tool Call' },
  llm_call: { icon: '🤖', color: '#9b7cf7', label: 'LLM Call' },
  verification: { icon: '✓', color: '#4f8ef7', label: 'Verification' },
};

const statusColors: Record<string, string> = {
  ok: '#00d26a',
  error: '#f05252',
  hallucination: '#f5a623',
  timeout: '#f5a623',
  uncertain: '#8888a0',
};

export const TraceViewer: React.FC<TraceViewerProps> = ({ sessionId, apiUrl = 'http://127.0.0.1:8000', onClose }) => {
  const [traces, setTraces] = useState<TraceSpan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<TraceSpan | null>(null);
  const [filterKind, setFilterKind] = useState<string>('all');
  const [hallucinations, setHallucinations] = useState<unknown[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  const fetchTraces = useCallback(async () => {
    try {
      setLoading(true);
      const [traceRes, hallRes, _statsRes] = await Promise.all([
        fetch(`${apiUrl}/telemetry/session/${sessionId}`),
        fetch(`${apiUrl}/telemetry/session/${sessionId}/hallucinations`),
        fetch(`${apiUrl}/telemetry/session/${sessionId}/latency`),
      ]);

      if (!traceRes.ok) throw new Error(`HTTP ${traceRes.status}`);

      const traceData = await traceRes.json();
      setTraces(traceData.traces || []);
      setStats(traceData.stats || null);

      if (hallRes.ok) {
        const hallData = await hallRes.json();
        setHallucinations(hallData.patterns || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch traces');
    } finally {
      setLoading(false);
    }
  }, [sessionId, apiUrl]);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  // Group traces by iteration
  const groupedTraces = traces.reduce<Record<number, TraceSpan[]>>((acc, span) => {
    const iter = span.iteration || 0;
    if (!acc[iter]) acc[iter] = [];
    acc[iter].push(span);
    return acc;
  }, {});

  const filteredTraces = filterKind === 'all'
    ? groupedTraces
    : Object.fromEntries(
        Object.entries(groupedTraces).map(([iter, spans]) => [
          iter,
          spans.filter((s) => s.kind === filterKind),
        ]).filter(([, spans]) => spans.length > 0)
      );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[#8888a0]">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading traces...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded bg-red-500/10 border border-red-500/20 text-red-400">
        <p className="font-medium">Failed to load traces</p>
        <p className="text-sm mt-1">{error}</p>
        <button onClick={fetchTraces} className="mt-2 px-3 py-1 text-sm bg-red-500/20 rounded hover:bg-red-500/30">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#141416] text-[#e8e8f0]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a1f]">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">Execution Trace</h3>
          <span className="text-xs text-[#8888a0]">
            {traces.length} spans · {Object.keys(groupedTraces).length} iterations
          </span>
          {hallucinations.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
              {hallucinations.length} suspected hallucinations
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value)}
            className="text-xs bg-[#1a1a1f] border border-[#2a2a30] rounded px-2 py-1 text-[#e8e8f0]"
          >
            <option value="all">All Kinds</option>
            {Object.entries(kindConfig).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          <button
            onClick={fetchTraces}
            className="text-xs px-2 py-1 bg-[#1a1a1f] border border-[#2a2a30] rounded hover:bg-[#2a2a30]"
          >
            ↻ Refresh
          </button>
          {onClose && (
            <button onClick={onClose} className="text-[#8888a0] hover:text-[#e8e8f0] ml-1">✕</button>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="flex gap-4 px-4 py-1.5 text-xs bg-[#0d0d0f] border-b border-[#1a1a1f]">
          {Object.entries(stats).map(([key, value]) => (
            <span key={key} className="text-[#8888a0]">
              {key}: <span className="text-[#e8e8f0]">{String(value)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {Object.entries(filteredTraces)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([iteration, spans]) => (
            <div key={iteration} className="space-y-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-[#9b7cf7]">Iteration {iteration}</span>
                <div className="flex-1 h-px bg-[#1a1a1f]" />
              </div>

              {(spans as TraceSpan[]).map((span: TraceSpan) => {
                const config = kindConfig[span.kind] || { icon: '?', color: '#8888a0', label: span.kind };
                const isSelected = selectedSpan?.span_id === span.span_id;

                return (
                  <div
                    key={span.span_id}
                    onClick={() => setSelectedSpan(isSelected ? null : span)}
                    className={`flex items-start gap-3 px-3 py-2 rounded cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#1a1a1f]' : 'hover:bg-[#1a1a1f]/50'
                    }`}
                  >
                    {/* Kind indicator */}
                    <div className="flex-shrink-0 mt-0.5">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: config.color }}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium" style={{ color: config.color }}>
                          {config.label}
                        </span>
                        <span className="text-xs text-[#8888a0]">{span.name}</span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            color: statusColors[span.status] || '#8888a0',
                            backgroundColor: `${statusColors[span.status] || '#8888a0'}15`,
                          }}
                        >
                          {span.status}
                        </span>
                        {span.latency_ms !== null && (
                          <span className="text-xs text-[#8888a0]">
                            {span.latency_ms.toFixed(0)}ms
                          </span>
                        )}
                      </div>

                      {/* Expandable details */}
                      {isSelected && (
                        <div className="mt-2 space-y-2 text-xs">
                          {span.input_data && (
                            <div>
                              <span className="text-[#8888a0]">Input:</span>
                              <pre className="mt-1 p-2 rounded bg-[#0d0d0f] overflow-x-auto max-h-32 text-[#e8e8f0]">
                                {span.input_data.substring(0, 500)}
                              </pre>
                            </div>
                          )}
                          {span.output_data && (
                            <div>
                              <span className="text-[#8888a0]">Output:</span>
                              <pre className="mt-1 p-2 rounded bg-[#0d0d0f] overflow-x-auto max-h-32 text-[#e8e8f0]">
                                {span.output_data.substring(0, 500)}
                              </pre>
                            </div>
                          )}
                          {span.attributes && Object.keys(span.attributes).length > 0 && (
                            <div>
                              <span className="text-[#8888a0]">Attributes:</span>
                              <pre className="mt-1 p-2 rounded bg-[#0d0d0f] overflow-x-auto text-[#e8e8f0]">
                                {JSON.stringify(span.attributes, null, 2).substring(0, 300)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

        {Object.keys(filteredTraces).length === 0 && (
          <div className="text-center py-8 text-[#8888a0]">
            <p className="text-sm">No traces recorded yet</p>
            <p className="text-xs mt-1">Traces are created when the agent executes tasks</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TraceViewer;
