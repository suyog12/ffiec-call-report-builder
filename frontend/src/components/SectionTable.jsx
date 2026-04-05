import { useState, useMemo } from "react";

const PAGE_SIZE = 20;

const SCHEDULE_COLORS = {
  RC: "#2563eb", RI: "#059669", "RC-C": "#7c3aed", RIA: "#b45309",
  RIE: "#0891b2", RIBII: "#be185d", RIC: "#374151", ENT: "#0d9488",
  SU: "#6d28d9", NARR: "#047857", CI: "#9f1239", RID: "#1d4ed8",
  RIBI: "#92400e", RIB: "#059669",
};
const DEFAULT_COLOR = "#64748b";

function fmtValue(raw) {
  if (raw === null || raw === undefined || raw === "") return "-";
  const n = parseFloat(String(raw).replace(/,/g, ""));
  if (!isNaN(n)) return n.toLocaleString("en-US");
  return String(raw);
}

export default function SectionTable({ data, sectionName }) {
  const [search, setSearch]        = useState("");
  const [visibleCount, setVisible] = useState(PAGE_SIZE);

  const color    = SCHEDULE_COLORS[sectionName] || DEFAULT_COLOR;
  const rowCount = data?.length || 0;

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(row =>
      (row.item_code   || "").toLowerCase().includes(q) ||
      (row.description || "").toLowerCase().includes(q) ||
      String(row.value || "").toLowerCase().includes(q)
    );
  }, [data, search]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  const handleSearch = (val) => { setSearch(val); setVisible(PAGE_SIZE); };

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 14,
      overflow: "hidden",
      marginBottom: 16,
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    }}>
      {/* ── Card header -same style as Overview/Metrics ── */}
      <div style={{ background: color, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Schedule badge */}
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "rgba(255,255,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 800, color: "#fff",
            letterSpacing: 0.5, flexShrink: 0,
          }}>
            {(sectionName || "??").slice(0, 3)}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Schedule {sectionName}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
              {rowCount.toLocaleString()} line items
            </div>
          </div>

          {/* Row count badge */}
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: "#fff",
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.25)",
            padding: "4px 12px", borderRadius: 99,
          }}>
            {rowCount.toLocaleString()} rows
          </div>
        </div>
      </div>

      {/* ── Search bar ── */}
      <div style={{ padding: "12px 16px", background: "#fafbfc", borderBottom: "1px solid #f1f5f9" }}>
        <div style={{ position: "relative" }}>
          <span style={{
            position: "absolute", left: 11, top: "50%",
            transform: "translateY(-50%)",
            fontSize: 13, color: "#94a3b8", pointerEvents: "none",
          }}>
            ⌕
          </span>
          <input
            type="text"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search by code, description, or value…"
            style={{
              width: "100%", padding: "7px 12px 7px 30px",
              border: "1px solid #e2e8f0", borderRadius: 7,
              fontSize: 12, color: "#374151", outline: "none",
              background: "#fff", boxSizing: "border-box",
            }}
            onFocus={e => e.target.style.borderColor = color}
            onBlur={e  => e.target.style.borderColor = "#e2e8f0"}
          />
        </div>
        {search && (
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5, display: "flex", gap: 6, alignItems: "center" }}>
            <span>{filtered.length.toLocaleString()} of {rowCount.toLocaleString()} rows match</span>
            <span onClick={() => handleSearch("")} style={{ color, cursor: "pointer", fontWeight: 600 }}>Clear</span>
          </div>
        )}
      </div>

      {/* ── Table ── */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {[
                { label: "Line",        w: 60,  align: "left"  },
                { label: "Item Code",   w: 130, align: "left"  },
                { label: "Description",         align: "left"  },
                { label: "Value",       w: 150, align: "right" },
              ].map(({ label, w, align }) => (
                <th key={label} style={{
                  padding: "9px 16px",
                  fontSize: 10, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: 0.8,
                  color: "#94a3b8",
                  borderBottom: `2px solid ${color}25`,
                  textAlign: align,
                  ...(w ? { width: w, whiteSpace: "nowrap" } : {}),
                }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: "32px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                  No rows match your search.
                </td>
              </tr>
            ) : (
              visible.map((row, i) => {
                const numRaw = parseFloat(String(row.value || "").replace(/,/g, ""));
                const isNum  = !isNaN(numRaw);
                const isNeg  = isNum && numRaw < 0;
                const isZero = isNum && numRaw === 0;

                return (
                  <tr
                    key={i}
                    style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}
                    onMouseEnter={e => e.currentTarget.style.background = color + "08"}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#fafbfc"}
                  >
                    <td style={{ padding: "8px 16px", fontSize: 11, color: "#94a3b8", borderBottom: "1px solid #f8fafc", whiteSpace: "nowrap" }}>
                      {row.line_number || "-"}
                    </td>
                    <td style={{ padding: "8px 16px", borderBottom: "1px solid #f8fafc", whiteSpace: "nowrap" }}>
                      <span style={{
                        fontSize: 11, fontFamily: "monospace", fontWeight: 700,
                        color, background: color + "10",
                        border: `1px solid ${color}20`,
                        padding: "2px 8px", borderRadius: 5,
                      }}>
                        {row.item_code}
                      </span>
                    </td>
                    <td style={{
                      padding: "8px 16px", fontSize: 13,
                      color: "#374151", borderBottom: "1px solid #f8fafc",
                      lineHeight: 1.4,
                    }}>
                      {row.description}
                    </td>
                    <td style={{
                      padding: "8px 16px",
                      fontSize: 13,
                      fontFamily: isNum ? "monospace" : "inherit",
                      fontWeight: isNum && !isZero ? 600 : 400,
                      color: isNeg ? "#ef4444" : isZero ? "#94a3b8" : isNum ? "#0f172a" : "#64748b",
                      borderBottom: "1px solid #f8fafc",
                      textAlign: "right", whiteSpace: "nowrap",
                      letterSpacing: isNum ? "-0.3px" : 0,
                    }}>
                      {fmtValue(row.value)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Footer: load more / row count ── */}
      {hasMore ? (
        <button
          onClick={() => setVisible(v => v + PAGE_SIZE)}
          style={{
            display: "block", width: "100%",
            padding: "12px",
            background: "#fafbfc",
            border: "none", borderTop: "1px solid #f1f5f9",
            fontSize: 12, fontWeight: 600,
            color, cursor: "pointer",
            textAlign: "center", fontFamily: "inherit",
          }}
          onMouseEnter={e => e.target.style.background = color + "08"}
          onMouseLeave={e => e.target.style.background = "#fafbfc"}
        >
          Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
          <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 6 }}>
            · {(filtered.length - visibleCount).toLocaleString()} remaining
          </span>
        </button>
      ) : (
        rowCount > PAGE_SIZE && (
          <div style={{
            padding: "9px 16px", borderTop: "1px solid #f1f5f9",
            fontSize: 11, color: "#94a3b8",
            textAlign: "right", background: "#fafbfc",
          }}>
            All {filtered.length.toLocaleString()} rows shown
            {search && ` (filtered from ${rowCount.toLocaleString()})`}
          </div>
        )
      )}
    </div>
  );
}