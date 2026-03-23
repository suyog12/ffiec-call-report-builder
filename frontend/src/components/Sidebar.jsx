import { useEffect, useRef, useState } from "react";

const WM_GREEN      = "#115740";
const WM_GREEN_DARK = "#0d4232";
const WM_GREEN_MID  = "#1a6b4f";
const WM_GOLD       = "#b5a16a";
const WM_TEXT       = "#d1e8df";
const WM_MUTED      = "#7aaa95";
const WM_BORDER     = "#0f4a35";

// ── Multi-select dropdown ─────────────────────────────────────
function MultiSelect({ label, options, selected, onToggle, placeholder, loading, onSearch, searchValue }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const selectedSet = new Set(selected.map(String));

  return (
    <div ref={ref} style={{ marginBottom: 10 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5, padding:"0 2px" }}>
        <span style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1.2, color:"#a8d4c0" }}>
          {label}
        </span>
        {selected.length > 0 && (
          <span style={{ fontSize:10, fontWeight:700, background:"rgba(181,161,106,0.2)", color:WM_GOLD, padding:"1px 7px", borderRadius:99, border:"1px solid rgba(181,161,106,0.3)" }}>
            {selected.length}
          </span>
        )}
      </div>

      <div onClick={() => !loading && setOpen(o => !o)} style={{
        background:"rgba(0,0,0,0.2)", border:"1px solid "+(open ? WM_GOLD+"80" : WM_BORDER),
        borderRadius:7, padding:"7px 10px", cursor:loading?"not-allowed":"pointer",
        minHeight:36, display:"flex", flexWrap:"wrap", alignItems:"center", gap:4,
        transition:"border-color 0.15s",
      }}>
        {selected.length === 0
          ? <span style={{ fontSize:12, color:"#9fc4b3" }}>{loading ? "Loading…" : placeholder}</span>
          : selected.map(val => {
              const opt = options.find(o => String(o.value) === String(val));
              return (
                <span key={val} style={{ background:"rgba(181,161,106,0.18)", color:WM_GOLD, border:"1px solid rgba(181,161,106,0.3)", borderRadius:4, fontSize:11, padding:"2px 6px", display:"flex", alignItems:"center", gap:4, maxWidth:150, overflow:"hidden" }}>
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{opt?.label || val}</span>
                  <span onClick={e => { e.stopPropagation(); onToggle(val); }} style={{ cursor:"pointer", fontWeight:700, opacity:0.7, flexShrink:0, lineHeight:1 }}>×</span>
                </span>
              );
            })
        }
        <span style={{ marginLeft:"auto", fontSize:9, color:"#a8d4c0", paddingLeft:4, flexShrink:0 }}>{open?"▲":"▼"}</span>
      </div>

      {open && (
        <div style={{ background:WM_GREEN_DARK, border:"1px solid "+WM_BORDER, borderRadius:7, marginTop:3, overflow:"hidden", maxHeight:220, display:"flex", flexDirection:"column", boxShadow:"0 8px 24px rgba(0,0,0,0.4)", zIndex:50, position:"relative" }}>
          {onSearch !== undefined && (
            <div style={{ padding:"7px 9px", borderBottom:"1px solid "+WM_BORDER, flexShrink:0 }}>
              <input autoFocus value={searchValue||""} onChange={e=>onSearch(e.target.value)} placeholder="Search…" onClick={e=>e.stopPropagation()}
                style={{ width:"100%", background:"rgba(0,0,0,0.3)", border:"1px solid "+WM_BORDER, borderRadius:5, padding:"5px 9px", fontSize:12, color:WM_TEXT, outline:"none" }} />
            </div>
          )}
          <div style={{ overflowY:"auto", flex:1 }}>
            {options.length === 0
              ? <div style={{ padding:"12px 10px", fontSize:12, color:"#9fc4b3" }}>{loading?"Loading…":"No results"}</div>
              : options.map(opt => {
                  const sel = selectedSet.has(String(opt.value));
                  return (
                    <div key={opt.value} onClick={e=>{ e.stopPropagation(); onToggle(opt.value); if(onSearch) onSearch(""); }}
                      style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"7px 10px", cursor:"pointer", background:sel?"rgba(181,161,106,0.12)":"transparent", borderBottom:"1px solid rgba(255,255,255,0.04)", transition:"background 0.1s" }}
                      onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
                      onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background="transparent"; }}>
                      <input type="checkbox" checked={sel} onChange={()=>{}} style={{ accentColor:WM_GOLD, marginTop:2, flexShrink:0 }} />
                      <div>
                        <div style={{ fontSize:12, color:WM_TEXT, lineHeight:1.3 }}>{opt.label}</div>
                        {opt.sublabel && <div style={{ fontSize:10, color:"#9fc4b3", marginTop:1 }}>{opt.sublabel}</div>}
                      </div>
                    </div>
                  );
                })
            }
          </div>
          {selected.length > 0 && (
            <div style={{ padding:"5px 10px", borderTop:"1px solid "+WM_BORDER, display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:11, color:WM_MUTED, flexShrink:0 }}>
              <span>{selected.length} selected</span>
              <span onClick={e=>{ e.stopPropagation(); selected.forEach(v=>onToggle(v)); }} style={{ color:"#f87171", cursor:"pointer", fontWeight:600 }}>Clear all</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Sidebar ──────────────────────────────────────────────
export default function Sidebar({
  collapsed,
  periods, periodsLoading, selectedPeriods, onTogglePeriod,
  banks, selectedBanks, onToggleBank, bankQuery, setBankQuery,
  onLoad, loading,
}) {
  const [expanded, setExpanded] = useState(true);
  const [periodSearch, setPeriodSearch] = useState("");

  const filteredPeriods = (periods || [])
    .filter(p => !periodSearch || p.includes(periodSearch))
    .map(p => ({ value: p, label: p }));

  const filteredBanks = (banks || [])
    .filter(b => {
      if (!bankQuery) return true;
      const q = bankQuery.toLowerCase();
      return String(b.Name||"").toLowerCase().includes(q) ||
             String(b.ID_RSSD||"").includes(bankQuery) ||
             String(b.City||"").toLowerCase().includes(q);
    })
    .slice(0, 100)
    .map(b => ({
      value: b.ID_RSSD,
      label: String(b.Name||"").trim(),
      sublabel: `RSSD ${b.ID_RSSD}${b.City?" · "+b.City.trim():""}${b.State?", "+b.State.trim():""}`,
    }));

  const reportCount = selectedBanks.length * selectedPeriods.length;
  const canLoad     = selectedBanks.length > 0 && selectedPeriods.length > 0;

  return (
    <aside style={{
      width: collapsed ? 0 : 272, minWidth: collapsed ? 0 : 272,
      background: WM_GREEN, color: WM_TEXT,
      display:"flex", flexDirection:"column",
      transition:"width 0.25s ease, min-width 0.25s ease",
      overflow:"hidden", position:"relative", zIndex:10,
    }}>
      <div style={{ width:272, height:"100%", display:"flex", flexDirection:"column", overflowY:"auto", overflowX:"hidden" }}>

        {/* ── Brand header ─────────────────────────────────── */}
        <div style={{ padding:"22px 18px 18px", borderBottom:"1px solid "+WM_BORDER, flexShrink:0, background:"rgba(0,0,0,0.12)" }}>
          {/* FFIEC -large, prominent */}
          <div style={{ fontSize:22, fontWeight:900, color:WM_GOLD, textTransform:"uppercase", letterSpacing:6, marginBottom:8, fontFamily:"Georgia,'Times New Roman',serif" }}>
            FFIEC
          </div>
          {/* Divider */}
          <div style={{ height:1, background:"rgba(181,161,106,0.3)", marginBottom:10 }} />
          {/* Main title */}
          <div style={{ fontSize:14, fontWeight:700, color:"#fff", letterSpacing:"0.2px", lineHeight:1.45, marginBottom:6 }}>
            Reports Analysis Dashboard
          </div>
          {/* Subtitle */}
          <div style={{ fontSize:10, color:"rgba(209,232,223,0.65)", letterSpacing:0.2, lineHeight:1.5 }}>
            Federal Financial Institutions<br />Examination Council
          </div>
        </div>

        {/* ── Call Reports nav item ─────────────────────────── */}
        <div style={{ flex:1, display:"flex", flexDirection:"column" }}>

          {/* Section toggle row */}
          <div
            onClick={() => setExpanded(e => !e)}
            style={{
              display:"flex", alignItems:"center", gap:12,
              padding:"12px 18px",
              cursor:"pointer", userSelect:"none",
              background: expanded ? "rgba(0,0,0,0.18)" : "transparent",
              borderBottom:"1px solid "+(expanded ? WM_BORDER : "transparent"),
              borderLeft: expanded ? "3px solid "+WM_GOLD : "3px solid transparent",
              transition:"all 0.15s",
            }}
            onMouseEnter={e => { if(!expanded) e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
            onMouseLeave={e => { if(!expanded) e.currentTarget.style.background="transparent"; }}
          >
            <span style={{
              width:32, height:32, borderRadius:7, flexShrink:0,
              background: expanded ? "rgba(181,161,106,0.22)" : "rgba(255,255,255,0.1)",
              color: expanded ? WM_GOLD : "#a8d4c0",
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:14,
            }}>
              ⎙
            </span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight: expanded ? 700 : 500, color: expanded ? "#fff" : WM_TEXT }}>
                Call Reports
              </div>
              <div style={{ fontSize:10, color:"#9fc4b3", marginTop:1 }}>
                Select banks &amp; periods
              </div>
            </div>
            <span style={{ fontSize:10, color:"#a8d4c0" }}>{expanded ? "▲" : "▼"}</span>
          </div>

          {/* Expanded panel */}
          {expanded && (
            <div style={{ background:"rgba(0,0,0,0.15)", borderBottom:"1px solid "+WM_BORDER, padding:"12px 14px 4px" }}>
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
              <MultiSelect
                label="Banks"
                options={filteredBanks}
                selected={selectedBanks.map(String)}
                onToggle={val => onToggleBank(Number(val))}
                placeholder={selectedPeriods.length===0 ? "Select a period first…" : "Search bank…"}
                loading={selectedPeriods.length>0 && banks.length===0}
                onSearch={setBankQuery}
                searchValue={bankQuery}
              />

              {/* Summary strip */}
              {reportCount > 0 && (
                <div style={{ background:"rgba(0,0,0,0.2)", border:"1px solid "+WM_BORDER, borderRadius:8, padding:"10px 12px", marginBottom:10 }}>
                  <div style={{ display:"flex", gap:0, marginBottom: selectedPeriods.length>0 ? 8 : 0 }}>
                    {[["Banks",selectedBanks.length],["Periods",selectedPeriods.length],["Reports",reportCount]].map(([lbl,val],i,arr) => (
                      <div key={lbl} style={{ flex:1, borderRight: i<arr.length-1 ? "1px solid "+WM_BORDER : "none", paddingRight:i<arr.length-1?10:0, paddingLeft:i>0?10:0 }}>
                        <div style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color:"#a8d4c0", marginBottom:2 }}>{lbl}</div>
                        <div style={{ fontSize:18, fontWeight:800, color:WM_GOLD, letterSpacing:"-0.5px" }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  {selectedPeriods.length > 0 && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                      {selectedPeriods.slice(0,3).map(p => (
                        <span key={p} style={{ fontSize:10, background:"rgba(181,161,106,0.15)", color:WM_GOLD, padding:"2px 8px", borderRadius:99, border:"1px solid rgba(181,161,106,0.25)" }}>{p}</span>
                      ))}
                      {selectedPeriods.length>3 && <span style={{ fontSize:10, color:WM_MUTED }}>+{selectedPeriods.length-3} more</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Load button */}
              <button onClick={onLoad} disabled={!canLoad||loading}
                style={{
                  width:"100%", padding:"10px 16px", fontSize:13, fontWeight:700,
                  background: canLoad&&!loading ? WM_GOLD : "rgba(0,0,0,0.2)",
                  color: canLoad&&!loading ? "#1a1a0a" : WM_MUTED,
                  border:"none", borderRadius:8,
                  cursor: canLoad&&!loading ? "pointer" : "not-allowed",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                  marginBottom:14, transition:"all 0.15s",
                }}
                onMouseEnter={e=>{ if(canLoad&&!loading) e.currentTarget.style.background="#c9b57a"; }}
                onMouseLeave={e=>{ if(canLoad&&!loading) e.currentTarget.style.background=WM_GOLD; }}
              >
                {loading && (
                  <div style={{ width:13, height:13, border:"2px solid rgba(0,0,0,0.2)", borderTopColor:"#1a1a0a", borderRadius:"50%", animation:"spin 0.7s linear infinite", flexShrink:0 }} />
                )}
                {loading ? "Loading…" : canLoad ? `Load ${reportCount} Report${reportCount>1?"s":""}` : "Load Report"}
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────── */}
        <div style={{ padding:"14px 18px", borderTop:"1px solid "+WM_BORDER, flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
            {/* W&M shield placeholder */}
            <div style={{
              width:28, height:28, borderRadius:4, flexShrink:0,
              background:"rgba(181,161,106,0.15)",
              border:"1px solid rgba(181,161,106,0.3)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:13, color:WM_GOLD,
            }}>
              W
            </div>
            <div>
              <div style={{ fontSize:12, fontWeight:700, color:WM_GOLD, fontFamily:"Georgia,serif", lineHeight:1.2 }}>
                William &amp; Mary
              </div>
              <div style={{ fontSize:9, color:WM_MUTED, marginTop:1 }}>MSBA · Team 9 · Class of 2026</div>
            </div>
          </div>
          <div style={{ fontSize:10, color:"#9fc4b3", lineHeight:1.6, borderTop:"1px solid "+WM_BORDER, paddingTop:8, marginTop:4 }}>
            © 2026 FFIEC Reports Analysis Dashboard.<br />
            All rights reserved. For academic use only.
          </div>
        </div>

      </div>
    </aside>
  );
}