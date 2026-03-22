import { useEffect, useRef, useState } from "react";

// ── Multi-select dropdown (dark theme) ────────────────────────────────────────
function MultiSelect({ label, options, selected, onToggle, placeholder, loading, onSearch, searchValue }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const selectedSet = new Set(selected.map(String));

  return (
    <div ref={ref}>
      <div className="sidebar-section-label">
        {label}
        {selected.length > 0 && <span style={{ color: "#0ea5e9", marginLeft: 4 }}>({selected.length})</span>}
      </div>

      <div className={"ms-trigger" + (open ? " open" : "")} onClick={() => !loading && setOpen(o => !o)}>
        {selected.length === 0
          ? <span className="ms-placeholder">{loading ? "Loading…" : placeholder}</span>
          : selected.map(val => {
              const opt = options.find(o => String(o.value) === String(val));
              return (
                <span key={val} className="ms-chip" title={opt?.label || val}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{opt?.label || val}</span>
                  <span className="ms-chip-remove" onClick={e => { e.stopPropagation(); onToggle(val); }}>×</span>
                </span>
              );
            })
        }
        <span style={{ marginLeft: "auto", fontSize: 9, color: "#475569", paddingLeft: 4, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div className="ms-dropdown">
          {onSearch !== undefined && (
            <div className="ms-search">
              <input autoFocus value={searchValue || ""} onChange={e => onSearch(e.target.value)}
                placeholder={`Search…`} onClick={e => e.stopPropagation()} />
            </div>
          )}
          <div className="ms-list">
            {options.length === 0
              ? <div style={{ padding: "12px 10px", fontSize: 12, color: "#475569" }}>{loading ? "Loading…" : "No results"}</div>
              : options.map(opt => {
                  const sel = selectedSet.has(String(opt.value));
                  return (
                    <div key={opt.value} className={"ms-option" + (sel ? " selected" : "")}
                      onClick={e => { e.stopPropagation(); onToggle(opt.value); if (onSearch) onSearch(""); }}>
                      <input type="checkbox" checked={sel} onChange={() => {}} />
                      <div>
                        <div className="ms-option-label">{opt.label}</div>
                        {opt.sublabel && <div className="ms-option-sub">{opt.sublabel}</div>}
                      </div>
                    </div>
                  );
                })
            }
          </div>
          {selected.length > 0 && (
            <div className="ms-footer">
              <span>{selected.length} selected</span>
              <span className="ms-footer-clear" onClick={e => { e.stopPropagation(); selected.forEach(v => onToggle(v)); }}>Clear all</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar({
  collapsed, onToggleCollapse,
  periods, periodsLoading, selectedPeriods, onTogglePeriod,
  banks, selectedBanks, onToggleBank,
  bankQuery, setBankQuery,
  onLoad, loading,
}) {
  const canLoad = selectedBanks.length > 0 && selectedPeriods.length > 0;
  const [periodSearch, setPeriodSearch] = useState("");

  const filteredPeriods = (periods || [])
    .filter(p => !periodSearch || p.includes(periodSearch))
    .map(p => ({ value: p, label: p }));

  const filteredBanks = (banks || [])
    .filter(b => {
      if (!bankQuery) return true;
      const q = bankQuery.toLowerCase();
      return String(b.Name || "").toLowerCase().includes(q) ||
             String(b.ID_RSSD || "").includes(bankQuery) ||
             String(b.City || "").toLowerCase().includes(q);
    })
    .slice(0, 100)
    .map(b => ({
      value: b.ID_RSSD,
      label: String(b.Name || "").trim(),
      sublabel: `RSSD ${b.ID_RSSD}${b.City ? " · " + b.City.trim() : ""}${b.State ? ", " + b.State.trim() : ""}`,
    }));

  const reportCount = selectedBanks.length * selectedPeriods.length;

  return (
    <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="sidebar-inner">
        {/* Logo */}
        <div className="sidebar-logo">
          <span className="sidebar-logo-text">FFIEC</span>
          <span className="sidebar-logo-badge">Call Reports</span>
        </div>

        {/* Periods */}
        <div className="sidebar-section" style={{ marginTop: 16 }}>
          <MultiSelect
            label="Reporting Periods"
            options={filteredPeriods}
            selected={selectedPeriods}
            onToggle={onTogglePeriod}
            placeholder="Select periods…"
            loading={periodsLoading}
            onSearch={setPeriodSearch}
            searchValue={periodSearch}
          />
        </div>

        {/* Banks */}
        <div className="sidebar-section" style={{ marginTop: 16 }}>
          <MultiSelect
            label="Banks"
            options={filteredBanks}
            selected={selectedBanks.map(String)}
            onToggle={val => onToggleBank(Number(val))}
            placeholder={selectedPeriods.length === 0 ? "Select a period first…" : "Search bank…"}
            loading={selectedPeriods.length > 0 && banks.length === 0}
            onSearch={setBankQuery}
            searchValue={bankQuery}
          />
        </div>

        {/* Summary */}
        {reportCount > 0 && (
          <div className="sidebar-section" style={{ marginTop: 16 }}>
            <div className="summary-pill">
              <div className="summary-pill-primary">
                {selectedBanks.length} bank{selectedBanks.length > 1 ? "s" : ""} selected
              </div>
              <div className="summary-pill-secondary">
                {selectedPeriods.length} period{selectedPeriods.length > 1 ? "s" : ""}
                {reportCount > 1 && <span style={{ color: "#64748b" }}> → {reportCount} reports</span>}
              </div>
            </div>
          </div>
        )}

        {/* Load button */}
        <div className="sidebar-section" style={{ marginTop: 16 }}>
          <button className="btn-load" onClick={onLoad} disabled={!canLoad || loading}>
            {loading ? "Loading…" : canLoad ? `Load ${reportCount} Report${reportCount > 1 ? "s" : ""}` : "Load Report"}
          </button>
        </div>
      </div>
    </aside>
  );
}