import { useState, useRef, useEffect, useCallback } from "react";
import BankSearch from "./ubpr/BankSearch";
import { formatQ } from "../utils/ubprFormatters";
import { WM } from "../theme/colors";

const G      = WM.green;
const GOLD   = WM.gold;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

// ── Markdown-lite renderer
function renderMessage(text) {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, i) => {
    // Bold
    line = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Bullet
    if (line.trim().startsWith("•") || line.trim().startsWith("*   ")) {
      return <li key={i} style={{ marginLeft: 16, marginBottom: 2, fontSize: 13 }}
        dangerouslySetInnerHTML={{ __html: line.replace(/^[•\*]\s+/, "") }} />;
    }
    if (!line.trim()) return <br key={i} />;
    return <p key={i} style={{ margin: "2px 0", fontSize: 13, lineHeight: 1.6 }}
      dangerouslySetInnerHTML={{ __html: line }} />;
  });
}

// ── Single bank context row ────────────────────────────────────────────────
function BankRow({ idx, entry, quarters, banks, onUpdate, onRemove, canRemove }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 120px 28px",
      gap: 6, alignItems: "center", marginBottom: 6,
    }}>
      <BankSearch
        banks={banks}
        value={entry.bank}
        onSelect={bank => onUpdate(idx, { ...entry, bank })}
        compact
      />
      <select
        value={entry.quarter}
        onChange={e => onUpdate(idx, { ...entry, quarter: e.target.value })}
        style={{
          padding: "6px 8px", fontSize: 11, border: `1px solid ${BORDER}`,
          borderRadius: 6, outline: "none", background: "#fff", color: TEXT,
        }}
      >
        {quarters.map(q => <option key={q} value={q}>{formatQ(q)}</option>)}
      </select>
      {canRemove ? (
        <button onClick={() => onRemove(idx)} style={{
          width: 28, height: 28, borderRadius: 6, border: `1px solid ${BORDER}`,
          background: "#fff", cursor: "pointer", fontSize: 14, color: "#94a3b8",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>×</button>
      ) : <div />}
    </div>
  );
}

// ── Message bubble────────
function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) return (
    <div style={{
      margin: "6px 0", padding: "8px 12px",
      background: "#fffbeb", borderLeft: `3px solid ${GOLD}`,
      borderRadius: 6, fontSize: 11, color: "#78540a",
    }}>
      {msg.content}
    </div>
  );

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: "90%",
        padding: "10px 14px",
        borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
        background: isUser ? G : "#fff",
        color: isUser ? "#fff" : TEXT,
        border: isUser ? "none" : `1px solid ${BORDER}`,
        boxShadow: isUser ? "none" : "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        {isUser
          ? <p style={{ margin: 0, fontSize: 13 }}>{msg.content}</p>
          : <div>{renderMessage(msg.content)}</div>
        }
      </div>
      {msg.action && msg.action.type !== "none" && (
        <div style={{
          marginTop: 4, fontSize: 10, color: MUTED, fontStyle: "italic",
        }}>
          ↳ Dashboard updated · {msg.action.tab}
        </div>
      )}
      <div style={{ fontSize: 10, color: MUTED, marginTop: 3 }}>
        {msg.time}
      </div>
    </div>
  );
}

// ── Typing indicator──────
function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "10px 14px",
      background: "#fff", borderRadius: "12px 12px 12px 2px", border: `1px solid ${BORDER}`,
      width: "fit-content", marginBottom: 12 }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: "50%", background: MUTED,
          animation: `chatBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ── Main ChatPanel component ───────────────────────────────────────────────
export default function ChatPanel({
  open,
  onClose,
  quarters,
  banks,
  // Current dashboard context (auto-filled)
  currentBank,
  currentQuarter,
  currentPeriod,
  activeSection,
  availablePeriods,
  // Callbacks to update dashboard
  onLoadUBPR,      // (rssd_id, quarter) => void
  onLoadReport,    // (rssd_id, period, tab) => void
  onSwitchSection, // ("call" | "ubpr") => void
}) {
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [threadId]                  = useState(() => `chat-${Date.now()}`);
  const [contextEntries, setCtxEntries] = useState([
    { bank: currentBank || null, quarter: currentQuarter || quarters[0] || "" }
  ]);
  const [showContext, setShowContext] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);

  // Sync context when dashboard bank changes
  useEffect(() => {
    if (currentBank && contextEntries[0]?.bank?.ID_RSSD !== currentBank?.ID_RSSD) {
      setCtxEntries(prev => [
        { ...prev[0], bank: currentBank, quarter: currentQuarter || prev[0].quarter },
        ...prev.slice(1),
      ]);
    }
  }, [currentBank, currentQuarter]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 300);
  }, [open]);

  const addMessage = (role, content, action = null) => {
    const time = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    setMessages(prev => [...prev, { role, content, action, time, id: Date.now() }]);
  };

  const handleAction = useCallback((action) => {
    if (!action || action.type === "none") return;

    if (action.type === "load_ubpr" && action.rssd_id) {
      onSwitchSection?.("ubpr");
      onLoadUBPR?.(action.rssd_id, action.quarter);
    } else if (action.type === "load_report" && action.rssd_id) {
      onSwitchSection?.("call");
      onLoadReport?.(action.rssd_id, action.period, action.tab);
    }
  }, [onLoadUBPR, onLoadReport, onSwitchSection]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    addMessage("user", q);
    setLoading(true);

    // Build context from all selected banks
    const validEntries = contextEntries.filter(e => e.bank);
    const primaryEntry = validEntries[0];

    // Convert quarter YYYYMMDD to MM/DD/YYYY for Call Report
    const quarterToFFIEC = (q) => {
      if (!q || q.length !== 8) return null;
      return `${q.slice(4, 6)}/${q.slice(6, 8)}/${q.slice(0, 4)}`;
    };

    try {
      // Enhance question with context so agent doesn't need to ask
      const primaryBank = validEntries[0]?.bank;
      const primaryQuarter = validEntries[0]?.quarter;
      const contextNote = primaryBank
        ? `[Context: Analyzing ${primaryBank.Name?.trim()} (RSSD: ${primaryBank.ID_RSSD}), Quarter: ${primaryQuarter}] `
        : "";
      const enhancedQuestion = contextNote + q;

      const resp = await fetch(`${BASE_URL}/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: enhancedQuestion,
          rssd_id: primaryEntry?.bank ? String(primaryEntry.bank.ID_RSSD) : null,
          bank_name: primaryEntry?.bank?.Name?.trim() || null,
          quarter: primaryEntry?.quarter || null,
          period: primaryEntry?.quarter ? quarterToFFIEC(primaryEntry.quarter) : currentPeriod,
          available_periods: (availablePeriods || []).slice(0, 20),
          thread_id: threadId,
          stream: false,
          // Pass all selected banks as extra context
          additional_banks: validEntries.slice(1).map(e => ({
            rssd_id: String(e.bank.ID_RSSD),
            bank_name: e.bank.Name,
            quarter: e.quarter,
          })),
        }),
      });

      if (!resp.ok) throw new Error(`Backend error ${resp.status}`);
      const data = await resp.json();

      addMessage("assistant", data.message, data.action);
      if (data.action) handleAction(data.action);

    } catch (e) {
      addMessage("assistant",
        "Failed to connect to the AI assistant. Please check that the backend is running."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const updateEntry = (idx, entry) => {
    setCtxEntries(prev => prev.map((e, i) => i === idx ? entry : e));
  };
  const removeEntry = (idx) => {
    setCtxEntries(prev => prev.filter((_, i) => i !== idx));
  };
  const addEntry = () => {
    setCtxEntries(prev => [...prev, {
      bank: null,
      quarter: quarters[0] || "",
    }]);
  };

  const clearChat = () => setMessages([]);

  const SUGGESTED = [
    "What is this bank's CET1 ratio?",
    "Compare capital ratios to peers",
    "Show the Q4 2025 balance sheet",
    "Is this bank well-capitalized?",
    "What are total deposits?",
    "Show ROA trend over 8 quarters",
  ];

  return (
    <>
      {/* CSS animations */}
      <style>{`
        @keyframes chatBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        @keyframes chatSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
        @keyframes chatSlideOut {
          from { transform: translateX(0);   opacity: 1; }
          to   { transform: translateX(100%); opacity: 0; }
        }
      `}</style>

      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0,
        width: open ? 420 : 0,
        background: "#fff",
        borderLeft: `1px solid ${BORDER}`,
        display: "flex", flexDirection: "column",
        zIndex: 50,
        transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        overflow: "hidden",
        boxShadow: open ? "-4px 0 24px rgba(0,0,0,0.08)" : "none",
      }}>
        {open && (
          <>
            {/* Header */}
            <div style={{
              padding: "14px 16px",
              borderBottom: `1px solid ${BORDER}`,
              background: G,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: "rgba(255,255,255,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16,
                }}>✦</div>
                <div>
                  <div style={{
                    fontFamily: "Georgia, serif", fontStyle: "italic",
                    fontWeight: 700, fontSize: 15, color: "#fff",
                  }}>FFIEC Assistant</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)" }}>
                    Call Reports · Financial Analysis
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {messages.length > 0 && (
                  <button onClick={clearChat} style={{
                    padding: "4px 10px", fontSize: 10, fontWeight: 600,
                    background: "rgba(255,255,255,0.15)", color: "#fff",
                    border: "1px solid rgba(255,255,255,0.25)", borderRadius: 6,
                    cursor: "pointer",
                  }}>Clear</button>
                )}
                <button onClick={onClose} style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: "rgba(255,255,255,0.15)", color: "#fff",
                  border: "none", cursor: "pointer", fontSize: 16,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>×</button>
              </div>
            </div>

            {/* Context selector */}
            <div style={{
              borderBottom: `1px solid ${BORDER}`,
              background: BG, flexShrink: 0,
            }}>
              <button
                onClick={() => setShowContext(s => !s)}
                style={{
                  width: "100%", padding: "8px 16px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: 0.8, color: MUTED,
                }}
              >
                <span>
                  {contextEntries.filter(e => e.bank).length} bank
                  {contextEntries.filter(e => e.bank).length !== 1 ? "s" : ""} selected
                </span>
                <span>{showContext ? "▲" : "▼"}</span>
              </button>

              {showContext && (
                <div style={{ padding: "0 12px 12px" }}>
                  {contextEntries.map((entry, idx) => (
                    <BankRow
                      key={idx}
                      idx={idx}
                      entry={entry}
                      quarters={quarters}
                      banks={banks}
                      onUpdate={updateEntry}
                      onRemove={removeEntry}
                      canRemove={contextEntries.length > 1}
                    />
                  ))}
                  {contextEntries.length < 4 && (
                    <button onClick={addEntry} style={{
                      width: "100%", padding: "6px", fontSize: 11, fontWeight: 600,
                      color: G, background: "transparent",
                      border: `1px dashed ${BORDER}`, borderRadius: 6,
                      cursor: "pointer", marginTop: 4,
                    }}>
                      + Add another bank
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: "auto", padding: "16px 14px",
              display: "flex", flexDirection: "column",
            }}>
              {messages.length === 0 ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 16 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 12,
                    background: `${G}15`, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 22, color: G,
                  }}>✦</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 4 }}>
                      Ask anything about bank financials
                    </div>
                    <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5 }}>
                      Select banks above, then ask about<br />
                      Call Reports, UBPR ratios, or peer comparisons
                    </div>
                  </div>
                  <div style={{
                    display: "flex", flexWrap: "wrap", gap: 6,
                    justifyContent: "center", maxWidth: 340,
                  }}>
                    {SUGGESTED.map(s => (
                      <button key={s} onClick={() => setInput(s)} style={{
                        padding: "5px 10px", fontSize: 11, borderRadius: 99,
                        border: `1px solid ${BORDER}`, background: "#fff",
                        color: TEXT, cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = G; e.currentTarget.style.color = G; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.color = TEXT; }}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map(msg => (
                    <MessageBubble key={msg.id} msg={msg} />
                  ))}
                  {loading && <TypingIndicator />}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input */}
            <div style={{
              padding: "12px 14px",
              borderTop: `1px solid ${BORDER}`,
              background: "#fff", flexShrink: 0,
            }}>
              <div style={{
                display: "flex", gap: 8, alignItems: "flex-end",
                border: `1.5px solid ${loading ? BORDER : BORDER}`,
                borderRadius: 10, padding: "8px 10px",
                background: BG,
                transition: "border-color 0.15s",
              }}
                onFocus={() => {}}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about capital ratios, call reports, peer benchmarks…"
                  rows={1}
                  style={{
                    flex: 1, background: "transparent", border: "none",
                    outline: "none", resize: "none", fontSize: 13,
                    color: TEXT, fontFamily: "inherit", lineHeight: 1.5,
                    maxHeight: 100, overflowY: "auto",
                  }}
                  onInput={e => {
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px";
                  }}
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || loading}
                  style={{
                    width: 32, height: 32, borderRadius: 8, border: "none",
                    background: input.trim() && !loading ? G : BORDER,
                    color: "#fff", cursor: input.trim() && !loading ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14, flexShrink: 0, transition: "background 0.15s",
                  }}
                >
                  {loading ? (
                    <div style={{
                      width: 12, height: 12,
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff", borderRadius: "50%",
                      animation: "spin 0.7s linear infinite",
                    }} />
                  ) : "↑"}
                </button>
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 6, textAlign: "center" }}>
                Enter to send · Shift+Enter for new line
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}