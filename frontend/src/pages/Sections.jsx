import { useState, useMemo } from "react";

const PAGE_SIZE = 20;

const DEFAULT_COLOR = "#64748b";

import { CARD_ACCENTS, SCHEDULE_COLORS } from "../theme/colors.js";

function BankLogo({ bankName, size = 22 }) {
  const clean = bankName.toLowerCase()
    .replace(/[',\.&]/g, " ")
    .replace(/\b(national|association|inc|corp|corporation|trust|financial|savings|community|federal|na|fsb|ssb|bancorp|bancshares|holding|holdings|group|co|company|ltd|llc|of|the|and|dba)\b/g, "")
    .replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter(Boolean);
  const slug  = words.slice(0, 2).join("").replace(/[^a-z0-9]/g, "");
  const domain = slug + ".com";
  const initials = words.slice(0, 2).map(w => w[0].toUpperCase()).join("");
  const svgBadge = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="4" fill="rgba(255,255,255,0.3)"/><text x="50%" y="54%" font-family="system-ui,sans-serif" font-size="${Math.round(size * 0.42)}" font-weight="800" fill="white" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`
  );
  return (
    <img src={`https://logo.clearbit.com/${domain}`} alt={initials}
      width={size} height={size}
      style={{ borderRadius: 4, objectFit: "contain", background: "rgba(255,255,255,0.2)", flexShrink: 0 }}
      onError={e => { e.target.onerror = null; e.target.src = svgBadge; }}
    />
  );
}

function fmtValue(raw) {
  if (raw === null || raw === undefined || raw === "") return "-";
  const n = parseFloat(String(raw).replace(/,/g, ""));
  if (!isNaN(n)) return n.toLocaleString("en-US");
  return String(raw);
}

// ── Individual schedule table (inside the card) ───────────────
function ScheduleTable({ sectionName, data }) {
  const [open, setOpen]            = useState(false);
  const [search, setSearch]        = useState("");
  const [visibleCount, setVisible] = useState(PAGE_SIZE);

  const color    = SCHEDULE_COLORS[sectionName] || DEFAULT_COLOR;
  const rowCount = data?.length || 0;

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(r =>
      (r.item_code   || "").toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q) ||
      String(r.value || "").toLowerCase().includes(q)
    );
  }, [data, search]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <div style={{ border: "1px solid #f1f5f9", borderRadius: 8, overflow: "hidden", marginBottom: 8 }}>
      {/* Schedule row -click to expand */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "11px 16px",
          cursor: "pointer", userSelect: "none",
          background: open ? "#fff" : "#fafbfc",
          borderBottom: open ? "1px solid #f1f5f9" : "none",
        }}
      >
        {/* Color badge */}
        <div style={{
          width: 32, height: 32, borderRadius: 7, flexShrink: 0,
          background: open ? color : color + "15",
          color: open ? "#fff" : color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 800, letterSpacing: 0.3,
          transition: "all 0.15s",
        }}>
          {(sectionName || "??").slice(0, 3)}
        </div>

        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
            Schedule {sectionName}
          </span>
          <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>
            {rowCount.toLocaleString()} line items
          </span>
        </div>

        {/* Pills summary when collapsed */}
        {!open && (
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ fontSize: 10, color: color, background: color + "10", border: `1px solid ${color}25`, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>
              {rowCount.toLocaleString()} rows
            </span>
          </div>
        )}

        <div style={{
          width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
          background: open ? color : "#e2e8f0",
          color: open ? "#fff" : "#94a3b8",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 8, fontWeight: 700, transition: "all 0.15s",
        }}>
          {open ? "▲" : "▼"}
        </div>
      </div>

      {open && (
        <>
          {/* Search */}
          <div style={{ padding: "8px 14px", background: "#fafbfc", borderBottom: "1px solid #f1f5f9" }}>
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setVisible(PAGE_SIZE); }}
              placeholder="Search by code or description…"
              style={{
                width: "100%", padding: "6px 10px",
                border: "1px solid #e2e8f0", borderRadius: 6,
                fontSize: 12, outline: "none", background: "#fff",
                boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = color}
              onBlur={e  => e.target.style.borderColor = "#e2e8f0"}
            />
            {search && (
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                {filtered.length.toLocaleString()} of {rowCount.toLocaleString()} match
                <span onClick={() => { setSearch(""); setVisible(PAGE_SIZE); }} style={{ color, cursor: "pointer", fontWeight: 600, marginLeft: 6 }}>Clear</span>
              </div>
            )}
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {[["Line", 55, "left"], ["Code", 120, "left"], ["Description", null, "left"], ["Value", 140, "right"]].map(([lbl, w, align]) => (
                    <th key={lbl} style={{
                      padding: "7px 14px", fontSize: 9, fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: 0.8,
                      color: "#94a3b8", borderBottom: `2px solid ${color}20`,
                      textAlign: align, ...(w ? { width: w, whiteSpace: "nowrap" } : {}),
                    }}>{lbl}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No rows match.</td></tr>
                ) : visible.map((row, i) => {
                  const n = parseFloat(String(row.value || "").replace(/,/g, ""));
                  const isNum = !isNaN(n);
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafbfc" }}
                      onMouseEnter={e => e.currentTarget.style.background = color + "07"}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "#fff" : "#fafbfc"}
                    >
                      <td style={{ padding: "7px 14px", fontSize: 11, color: "#94a3b8", borderBottom: "1px solid #f8fafc", whiteSpace: "nowrap" }}>
                        {row.line_number || "-"}
                      </td>
                      <td style={{ padding: "7px 14px", borderBottom: "1px solid #f8fafc", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700, color, background: color + "10", border: `1px solid ${color}20`, padding: "2px 7px", borderRadius: 4 }}>
                          {row.item_code}
                        </span>
                      </td>
                      <td style={{ padding: "7px 14px", fontSize: 12, color: "#374151", borderBottom: "1px solid #f8fafc", lineHeight: 1.4 }}>
                        {row.description}
                      </td>
                      <td style={{
                        padding: "7px 14px", fontSize: 13, textAlign: "right",
                        fontFamily: isNum ? "monospace" : "inherit",
                        fontWeight: isNum && n !== 0 ? 600 : 400,
                        color: n < 0 ? "#ef4444" : n === 0 ? "#94a3b8" : isNum ? "#0f172a" : "#64748b",
                        borderBottom: "1px solid #f8fafc", whiteSpace: "nowrap",
                        letterSpacing: isNum ? "-0.3px" : 0,
                      }}>
                        {fmtValue(row.value)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore ? (
            <button onClick={() => setVisible(v => v + PAGE_SIZE)}
              style={{ display: "block", width: "100%", padding: "10px", background: "#fafbfc", border: "none", borderTop: "1px solid #f1f5f9", fontSize: 11, color, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              onMouseEnter={e => e.target.style.background = color + "08"}
              onMouseLeave={e => e.target.style.background = "#fafbfc"}
            >
              Load {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
              <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: 5 }}>· {(filtered.length - visibleCount).toLocaleString()} remaining</span>
            </button>
          ) : rowCount > PAGE_SIZE && (
            <div style={{ padding: "8px 14px", borderTop: "1px solid #f1f5f9", fontSize: 10, color: "#94a3b8", textAlign: "right", background: "#fafbfc" }}>
              All {filtered.length.toLocaleString()} rows shown{search && ` (filtered from ${rowCount.toLocaleString()})`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── One card per bank+period ──────────────────────────────────
function ReportCard({ report, accent }) {
  const [expanded, setExpanded] = useState(false);

  const sections     = report.sectionsData || {};
  const sectionNames = Object.keys(sections);
  const totalRows    = sectionNames.reduce((s, k) => s + (sections[k]?.length || 0), 0);

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 14,
      overflow: "hidden",
      marginBottom: 16,
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
    }}>
      {/* Card header -same as Overview/Metrics */}
      <div style={{ background: accent, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BankLogo bankName={report.bankName} size={22} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", textTransform: "uppercase", letterSpacing: 0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {report.bankName}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.5)", flexShrink: 0 }} />
              {report.period}
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.8 }}>Schedules</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>{sectionNames.length}</div>
            </div>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.2)" }} />
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.8 }}>Line Items</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>{totalRows.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Collapsed preview -schedule pills */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 20px",
          background: "#f8fafc",
          cursor: "pointer", userSelect: "none",
          borderBottom: expanded ? "1px solid #e2e8f0" : "none",
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
          {sectionNames.map(name => {
            const col = SCHEDULE_COLORS[name] || DEFAULT_COLOR;
            return (
              <span key={name} style={{
                fontSize: 11, fontWeight: 700,
                color: col, background: col + "12",
                border: `1px solid ${col}30`,
                padding: "3px 10px", borderRadius: 99,
              }}>
                {name}
                <span style={{ fontWeight: 400, color: col + "aa", marginLeft: 4 }}>
                  {(sections[name]?.length || 0).toLocaleString()}
                </span>
              </span>
            );
          })}
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          fontSize: 11, fontWeight: 600,
          color: expanded ? accent : "#64748b",
          flexShrink: 0,
        }}>
          {expanded ? "Collapse" : "Expand schedules"}
          <span style={{
            width: 20, height: 20, borderRadius: "50%",
            background: expanded ? accent : "#e2e8f0",
            color: expanded ? "#fff" : "#64748b",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 8, fontWeight: 700, transition: "all 0.15s",
          }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {/* Expanded: schedule tables */}
      {expanded && (
        <div style={{ padding: "16px 20px" }}>
          {sectionNames.map(name => (
            <ScheduleTable key={name} sectionName={name} data={sections[name]} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Sections page ────────────────────────────────────────
export default function Sections({ reports }) {
  const list = reports || [];

  if (list.length === 0) {
    return (
      <div style={{ padding: "60px 0", textAlign: "center", color: "#94a3b8" }}>
        <div style={{ fontSize: 32, marginBottom: 12, fontWeight: 300 }}>≡</div>
        <p style={{ fontSize: 14 }}>Select a bank and period, then click <strong style={{ color: "#0f172a" }}>Load Reports</strong>.</p>
      </div>
    );
  }

  const uniqueBanks   = [...new Set(list.map(r => r.bankName))].length;
  const uniquePeriods = [...new Set(list.map(r => r.period))].length;

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.5px" }}>
          {list.length === 1 ? list[0].bankName : `${list.length} Reports`}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {list.length === 1
            ? list[0].period
            : `${uniqueBanks} bank${uniqueBanks > 1 ? "s" : ""} · ${uniquePeriods} period${uniquePeriods > 1 ? "s" : ""}`}
        </div>
      </div>

      {list.map((report, i) => (
        <ReportCard
          key={report.bankName + "::" + report.period}
          report={report}
          accent={CARD_ACCENTS[i % CARD_ACCENTS.length]}
        />
      ))}
    </div>
  );
}