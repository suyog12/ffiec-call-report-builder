import React, { useState, useMemo } from "react";
import { fetchAllFields } from "../services/api";

// ─── constants ────────────────────────────────────────────────
const STEPS = ["Schedules", "Fields", "Banks", "Preview"];

const CARD_ACCENTS = [
  // Muted, desaturated professional palette — colorblind-safe
  "#1d4ed8",  // steel blue
  "#065f46",  // deep forest green
  "#4c1d95",  // deep violet
  "#78350f",  // dark amber
  "#164e63",  // deep teal
  "#831843",  // deep rose
  "#374151",  // slate
  "#134e4a",  // dark emerald
  "#312e81",  // indigo
  "#064e3b",  // dark green
  "#881337",  // dark crimson
  "#1e3a8a",  // royal blue
  "#451a03",  // dark brown
];

const SCHEDULE_COLORS = {
  RC:"#1d4ed8", RI:"#065f46", "RC-C":"#4c1d95", RIA:"#78350f",
  RIE:"#164e63", RIBII:"#831843", RIC:"#374151", ENT:"#134e4a",
  SU:"#312e81", NARR:"#064e3b", CI:"#881337", RID:"#1e3a8a",
  RIBI:"#451a03", RIB:"#065f46",
};

// ─── W&M themed animated buttons ─────────────────────────────
function WMButton({ children, onClick, disabled, variant = "next" }) {
  const [hovered, setHovered] = React.useState(false);

  const isBack  = variant === "back";
  const isGhost = variant === "ghost";
  const isNext  = variant === "next";

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 40,
    minWidth: isGhost ? "auto" : 120,
    padding: isGhost ? "0 16px" : "0 22px",
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.4px",
    cursor: disabled ? "not-allowed" : "pointer",
    // All variants have a visible border so they unmistakably look like buttons
    border: isNext
      ? "2px solid #0d4232"
      : isBack
      ? "2px solid #c5d8ce"
      : "2px solid #c5d8ce",
    transition: "all 0.2s ease",
    opacity: disabled ? 0.4 : 1,
    transform: hovered && !disabled ? "translateY(-2px)" : "translateY(0)",
    boxShadow: hovered && !disabled
      ? isNext
        ? "0 6px 20px rgba(17,87,64,0.35)"
        : "0 4px 14px rgba(17,87,64,0.12)"
      : isNext
        ? "0 2px 6px rgba(17,87,64,0.2)"
        : "0 1px 3px rgba(0,0,0,0.08)",
    background: isNext
      ? hovered && !disabled ? "#0d4232" : "#115740"
      : isGhost
      ? hovered && !disabled ? "#eef5f0" : "#f4f6f0"
      : hovered && !disabled ? "#eef5f0" : "#fff",
    color: isNext ? "#fff" : "#1a5c35",
  };

  const ArrowLeft = () => (
    <svg height="14" width="14" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"
      style={{ transition:"transform 0.3s ease", transform: hovered&&!disabled?"translateX(-4px)":"translateX(0)", flexShrink:0 }}>
      <path fill="currentColor" d="M874.690416 495.52477c0 11.2973-9.168824 20.466124-20.466124 20.466124l-604.773963 0 188.083679 188.083679c7.992021 7.992021 7.992021 20.947078 0 28.939099-4.001127 3.990894-9.240455 5.996574-14.46955 5.996574-5.239328 0-10.478655-1.995447-14.479783-5.996574l-223.00912-223.00912c-3.837398-3.837398-5.996574-9.046027-5.996574-14.46955 0-5.433756 2.159176-10.632151 5.996574-14.46955l223.019353-223.029586c7.992021-7.992021 20.957311-7.992021 28.949332 0 7.992021 8.002254 7.992021 20.957311 0 28.949332l-188.073446 188.073446 604.753497 0C865.521592 475.058646 874.690416 484.217237 874.690416 495.52477z"/>
    </svg>
  );

  const ArrowRight = () => (
    <svg height="14" width="14" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"
      style={{ transition:"transform 0.3s ease", transform: hovered&&!disabled?"translateX(4px)":"translateX(0)", flexShrink:0 }}>
      <path fill="currentColor" d="M149.309584 495.52477c0-11.2973 9.168824-20.466124 20.466124-20.466124l604.773963 0-188.083679-188.083679c-7.992021-7.992021-7.992021-20.947078 0-28.939099 4.001127-3.990894 9.240455-5.996574 14.46955-5.996574 5.239328 0 10.478655 1.995447 14.479783 5.996574l223.00912 223.00912c3.837398 3.837398 5.996574 9.046027 5.996574 14.46955 0 5.433756-2.159176 10.632151-5.996574 14.46955l-223.019353 223.029586c-7.992021 7.992021-20.957311 7.992021-28.949332 0-7.992021-8.002254-7.992021-20.957311 0-28.949332l188.073446-188.073446-604.753497 0C158.478408 515.991124 149.309584 506.832763 149.309584 495.52477z"/>
    </svg>
  );

  return (
    <button
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      style={base}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isBack && <ArrowLeft />}
      <span>{children}</span>
      {isNext && <ArrowRight />}
    </button>
  );
}

// ─── SyncScrollTable: styled top rail + hidden bottom scrollbar ──
// The top rail sits inside the card header so it looks designed, not bolted on.
// A ghost div inside the rail matches table width to create the drag range.
function SyncScrollTable({ children, tableWidth, accentColor }) {
  const topRef    = React.useRef(null);
  const bodyRef   = React.useRef(null);
  const syncing   = React.useRef(false);

  const onTop  = () => { if (syncing.current) return; syncing.current = true; if (bodyRef.current) bodyRef.current.scrollLeft = topRef.current.scrollLeft; syncing.current = false; };
  const onBody = () => { if (syncing.current) return; syncing.current = true; if (topRef.current)  topRef.current.scrollLeft  = bodyRef.current.scrollLeft;  syncing.current = false; };

  const col = accentColor || "#2563eb";

  return (
    <div>
      {/* Top scroll rail — styled as a deliberate UI strip, not a naked scrollbar */}
      <div style={{ background: col + "18", borderBottom: "1px solid " + col + "30", padding:"4px 0" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 16px 2px" }}>
          <span style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, color: col, opacity:0.7, flexShrink:0 }}>scroll</span>
          {/* The actual scrollable rail */}
          <div
            ref={topRef}
            onScroll={onTop}
            style={{ flex:1, overflowX:"auto", overflowY:"hidden", height:12, cursor:"ew-resize" }}
          >
            <div style={{ width: tableWidth, height:1 }} />
          </div>
          <span style={{ fontSize:9, color:col, opacity:0.5, flexShrink:0 }}>→</span>
        </div>
      </div>

      {/* Table — bottom scrollbar suppressed so top rail is the only one */}
      <style>{`.ffiec-body-scroll::-webkit-scrollbar{display:none}`}</style>
      <div
        ref={bodyRef}
        onScroll={onBody}
        className="ffiec-body-scroll"
        style={{ overflowX:"auto", scrollbarWidth:"none", msOverflowStyle:"none" }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────
function fmt(v) {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  if (isNaN(n)) return String(v ?? "") || "—";
  return n.toLocaleString("en-US");
}

function BankLogo({ bankName, size = 20 }) {
  const clean = bankName.toLowerCase()
    .replace(/[',\.&]/g," ")
    .replace(/\b(national|association|inc|corp|corporation|trust|financial|savings|community|federal|na|fsb|ssb|bancorp|bancshares|holding|holdings|group|co|company|ltd|llc|of|the|and|dba)\b/g,"")
    .replace(/\s+/g," ").trim();
  const words = clean.split(" ").filter(Boolean);
  const slug  = words.slice(0,2).join("").replace(/[^a-z0-9]/g,"");
  const initials = words.slice(0,2).map(w=>w[0].toUpperCase()).join("");
  const svgBadge = "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="4" fill="rgba(255,255,255,0.3)"/><text x="50%" y="54%" font-family="system-ui,sans-serif" font-size="${Math.round(size*0.42)}" font-weight="800" fill="white" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`
  );
  return (
    <img src={`https://logo.clearbit.com/${slug}.com`} alt={initials}
      width={size} height={size}
      style={{borderRadius:4,objectFit:"contain",background:"rgba(255,255,255,0.2)",flexShrink:0}}
      onError={e=>{e.target.onerror=null;e.target.src=svgBadge;}} />
  );
}

// ─── print + export ───────────────────────────────────────────
const PRINT_STYLE = `* {box-sizing:border-box;margin:0;padding:0;} body{font-family:system-ui,sans-serif;font-size:11px;color:#111;} @page{margin:1.2cm 1.5cm;size:A4 landscape;} h1{font-size:15px;margin:0 0 4px;} .meta{font-size:10px;color:#555;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #2563eb;} .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#2563eb;margin:14px 0 4px;border-bottom:1px solid #2563eb;padding-bottom:2px;} table{width:100%;border-collapse:collapse;margin-bottom:4px;} th{background:#f3f4f6;font-size:9px;text-transform:uppercase;letter-spacing:.5px;padding:4px 6px;text-align:left;border:1px solid #ddd;} td{padding:3px 6px;border:1px solid #eee;font-size:10px;} .num{text-align:right;font-family:monospace;} .subtotal-row td{font-weight:700;background:#f9fafb;border-color:#ddd;}`;

function triggerPrint(html, title) {
  const doc = "<!DOCTYPE html><html><head><meta charset='utf-8'/><title>"+title+"</title><style>"+PRINT_STYLE+"</style></head><body>"+html+"</body></html>";
  const old = document.getElementById("ffiec-iframe"); if(old) old.remove();
  const f = document.createElement("iframe");
  f.id="ffiec-iframe"; f.style.cssText="position:fixed;top:0;left:0;width:0;height:0;border:none;visibility:hidden;";
  document.body.appendChild(f);
  f.onload=()=>{f.contentWindow.focus();f.contentWindow.print();setTimeout(()=>f.remove(),2000);};
  f.srcdoc=doc;
}
function exportCSV(rows, filename) {
  const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");
  const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
  const a=document.createElement("a"); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

// ─── Sticky step bar ──────────────────────────────────────────
function StepBar({ steps, current, onBack, onNext, nextDisabled, nextLabel, isPreview, exportRef, onRestart }) {
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const actionsRef = React.useRef(null);
  React.useEffect(() => {
    const h = e => { if(actionsRef.current && !actionsRef.current.contains(e.target)) setActionsOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div style={{ position:"sticky", top:0, zIndex:20, background:"#fafbf8", borderBottom:"1px solid #e4e9e2", marginLeft:-28, marginRight:-28, padding:"0 28px 12px", marginBottom:24 }}>
      {/* Progress */}
      <div style={{ display:"flex", alignItems:"center", paddingTop:16, paddingBottom:10 }}>
        {steps.map((s, i) => {
          const done = i < current, active = i === current;
          return (
            <div key={s} style={{ display:"flex", alignItems:"center", flex: i < steps.length-1 ? 1 : "none" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background: done?"#115740":active?"#1d4ed8":"#e8ede9", color: done||active?"#fff":"#9ca3af", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700 }}>
                  {done ? "✓" : i+1}
                </div>
                <span style={{ fontSize:10, fontWeight:active?700:400, color:active?"#1a2e20":done?"#2d5240":"#94a3b8", whiteSpace:"nowrap" }}>{s}</span>
              </div>
              {i < steps.length-1 && <div style={{ flex:1, height:2, background:done?"#115740":"#dde8e2", margin:"0 6px", marginBottom:14 }} />}
            </div>
          );
        })}
      </div>
      {/* Nav */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", gap:8 }}>
          {current > 0 && !isPreview && <WMButton variant="back" onClick={onBack}>Back</WMButton>}
          {isPreview && <>
            <WMButton variant="back" onClick={onBack}>Back</WMButton>
            <WMButton variant="ghost" onClick={onRestart}>↺ Start Over</WMButton>
          </>}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {!isPreview && <>
            {nextLabel && <span style={{ fontSize:12, color:"#5a7a68", fontWeight:500 }}>{nextLabel}</span>}
            <WMButton variant="next" onClick={onNext} disabled={nextDisabled}>Next</WMButton>
          </>}
          {isPreview && (
            <div className="actions-dropdown" ref={actionsRef}>
              <WMButton variant="next" onClick={() => setActionsOpen(o=>!o)}>Actions ▾</WMButton>
              {actionsOpen && (
                <div className="actions-menu">
                  <button className="actions-menu-item" onClick={() => { exportRef?.current?._csv?.(); setActionsOpen(false); }}><span>⬇</span> Export CSV</button>
                  <button className="actions-menu-item" onClick={() => { exportRef?.current?._pdf?.(); setActionsOpen(false); }}><span>🖨</span> Save as PDF</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step card shell ──────────────────────────────────────────
function StepCard({ title, subtitle, accent = "#2563eb", children }) {
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.05)", marginBottom:16 }}>
      <div style={{ background:accent, padding:"16px 20px" }}>
        <div style={{ fontSize:14, fontWeight:800, color:"#fff", textTransform:"uppercase", letterSpacing:0.5 }}>{title}</div>
        {subtitle && <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)", marginTop:3 }}>{subtitle}</div>}
      </div>
      <div style={{ padding:"20px" }}>{children}</div>
    </div>
  );
}

// ─── Step 1: Schedules ────────────────────────────────────────
function StepSections({ availableSections, selectedSections, onToggle }) {
  // Group by known families; unrecognised schedules go to Other.
  // No hardcoded fallback — all data comes from the API.
  const BALANCE_SHEET = new Set(["RC","RC-C","RC-B","RC-D","RC-E","RC-F","RC-G","RC-H","RC-K","RC-L","RC-M","RC-N","RC-O","RC-P","RC-Q","RC-R","RC-S","RC-T","RC-U","RC-V"]);
  const INCOME = new Set(["RI","RIA","RIB","RIBI","RIBII","RIC","RID","RIE"]);

  const grouped = { "Balance Sheet":[], "Income":[], "Other":[] };
  for (const s of availableSections) {
    if (BALANCE_SHEET.has(s))       grouped["Balance Sheet"].push(s);
    else if (INCOME.has(s))         grouped["Income"].push(s);
    else                            grouped["Other"].push(s);
  }

  if (availableSections.length === 0) {
    return (
      <StepCard title="Select Schedules" subtitle="No schedules found. Make sure reports are loaded." accent="#1d4ed8">
        <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, padding:"20px 0" }}>
          No schedules available — ensure a bank and period are loaded first.
        </div>
      </StepCard>
    );
  }

  return (
    <StepCard
      title="Select Schedules"
      subtitle={availableSections.length + " schedules available from the FFIEC filing — choose which to include."}
      accent="#1d4ed8"
    >
      {Object.entries(grouped).map(([group, sections]) => {
        if (!sections.length) return null;
        return (
          <div key={group} style={{ marginBottom:20 }}>
            <div style={{ fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:1.2, color:"#94a3b8", marginBottom:10 }}>{group}</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {sections.map(s => {
                const sel = selectedSections.includes(s);
                const col = SCHEDULE_COLORS[s] || "#64748b";
                return (
                  <button key={s} onClick={() => onToggle(s)} style={{
                    padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:sel?700:500, cursor:"pointer",
                    border: sel ? `2px solid ${col}` : "2px solid #c5d8ce",
                    background: sel ? col : "#fff",
                    color: sel ? "#fff" : "#2d5240",
                    boxShadow: sel ? "0 2px 8px "+col+"50" : "0 1px 3px rgba(0,0,0,0.08)",
                    transition:"all 0.15s",
                  }}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {selectedSections.length > 0 && (
        <div style={{ marginTop:4, padding:"10px 14px", background:"#eef5f0", border:"1px solid #a8d4bc", borderRadius:8, fontSize:12, color:"#1a5c35" }}>
          {selectedSections.length} schedule{selectedSections.length>1?"s":""} selected: {selectedSections.join(", ")}
        </div>
      )}
    </StepCard>
  );
}

// ─── Step 2: Fields ───────────────────────────────────────────
function StepFields({ catalogSections, selectedFieldIds, onToggleField, onToggleSection }) {
  const [search, setSearch] = useState("");
  const [openSecs, setOpenSecs] = useState({});  // all collapsed by default

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalogSections;
    const r = {};
    for (const [sec, fields] of Object.entries(catalogSections)) {
      const m = fields.filter(f => f.item_code.toLowerCase().includes(q) || (f.description||"").toLowerCase().includes(q));
      if (m.length) r[sec] = m;
    }
    return r;
  }, [catalogSections, search]);

  return (
    <StepCard title="Select Fields" subtitle={`Pick individual fields. ${selectedFieldIds.size > 0 ? selectedFieldIds.size+" selected" : "All will be fetched for every bank and period."}`} accent="#1d4ed8">
      {/* Search */}
      <div style={{ position:"relative", marginBottom:16 }}>
        <span style={{ position:"absolute", left:11, top:"50%", transform:"translateY(-50%)", fontSize:13, color:"#94a3b8", pointerEvents:"none" }}>⌕</span>
        <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search by code or description…"
          style={{ width:"100%", padding:"8px 12px 8px 30px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:13, outline:"none", boxSizing:"border-box" }}
          onFocus={e=>e.target.style.borderColor="#2563eb"}
          onBlur={e=>e.target.style.borderColor="#e2e8f0"}
        />
      </div>

      {Object.entries(filtered).map(([section, fields]) => {
        const open     = openSecs[section] === true;  // default collapsed
        const allSel   = fields.every(f => selectedFieldIds.has(f.item_code));
        const someSel  = fields.some(f  => selectedFieldIds.has(f.item_code));
        const selCount = fields.filter(f => selectedFieldIds.has(f.item_code)).length;
        const col      = SCHEDULE_COLORS[section] || "#64748b";

        return (
          <div key={section} style={{ marginBottom:8, border:"1px solid #e2e8f0", borderRadius:10, overflow:"hidden" }}>
            {/* Section header */}
            <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background: open?"#fff":"#f8fafc", cursor:"pointer", userSelect:"none", borderBottom: open?"1px solid #f1f5f9":"none" }}
              onClick={() => setOpenSecs(p=>({...p,[section]:!open}))}>
              <input type="checkbox" checked={allSel}
                ref={el => { if(el) el.indeterminate = someSel && !allSel; }}
                onChange={e => { e.stopPropagation(); onToggleSection(fields, !allSel); }}
                onClick={e => e.stopPropagation()}
                style={{ accentColor:col, flexShrink:0 }} />
              <div style={{ width:28, height:28, borderRadius:6, background: open?col:col+"15", color: open?"#fff":col, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:800, flexShrink:0 }}>
                {section.slice(0,3)}
              </div>
              <span style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>Schedule {section}</span>
              <span style={{ fontSize:11, color:"#94a3b8" }}>{selCount}/{fields.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11, color: open?col:"#94a3b8", fontWeight:open?600:400 }}>{open?"▲ collapse":"▼ expand"}</span>
            </div>

            {open && (
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"#f8fafc" }}>
                    <th style={{ padding:"6px 12px", width:32, borderBottom:`2px solid ${col}20` }} />
                    <th style={{ padding:"6px 12px", width:120, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"#94a3b8", borderBottom:`2px solid ${col}20`, textAlign:"left" }}>Code</th>
                    <th style={{ padding:"6px 12px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"#94a3b8", borderBottom:`2px solid ${col}20`, textAlign:"left" }}>Description</th>
                    <th style={{ padding:"6px 12px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"#94a3b8", borderBottom:`2px solid ${col}20`, textAlign:"right", width:130 }}>Sample Value</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={f.item_code} style={{ background: i%2===0?"#fff":"#fafbfc" }}
                      onMouseEnter={e=>e.currentTarget.style.background=col+"08"}
                      onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"#fff":"#fafbfc"}>
                      <td style={{ padding:"6px 12px", borderBottom:"1px solid #f8fafc" }}>
                        <input type="checkbox" checked={selectedFieldIds.has(f.item_code)} onChange={()=>onToggleField(f.item_code)} style={{ accentColor:col }} />
                      </td>
                      <td style={{ padding:"6px 12px", borderBottom:"1px solid #f8fafc" }}>
                        <span style={{ fontSize:11, fontFamily:"monospace", fontWeight:700, color:col, background:col+"10", border:`1px solid ${col}20`, padding:"2px 6px", borderRadius:4 }}>{f.item_code}</span>
                      </td>
                      <td style={{ padding:"6px 12px", fontSize:12, color:"#374151", borderBottom:"1px solid #f8fafc", lineHeight:1.4 }}>{f.description}</td>
                      <td style={{ padding:"6px 12px", fontSize:12, fontFamily:"monospace", color:"#0f172a", textAlign:"right", borderBottom:"1px solid #f8fafc", whiteSpace:"nowrap" }}>{fmt(f.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </StepCard>
  );
}

// ─── Step 3: Banks ────────────────────────────────────────────
function StepBanks({ banks, selectedBankIds, allCatalogs, selectedFieldIds, bankFieldOverrides, onSetOverride }) {
  const [expandedBank, setExpandedBank] = useState(null);

  const bankStatus = useMemo(() => {
    const status = {};
    for (const rssdId of selectedBankIds) {
      const available = new Set();
      Object.entries(allCatalogs).filter(([k]) => k.startsWith(String(rssdId)+"::")).forEach(([,v]) => {
        Object.values(v.sections||{}).forEach(fields => fields.forEach(f => available.add(f.item_code)));
      });
      const wanted  = [...selectedFieldIds];
      status[rssdId] = { available, present: wanted.filter(c=>available.has(c)), missing: wanted.filter(c=>!available.has(c)) };
    }
    return status;
  }, [selectedBankIds, allCatalogs, selectedFieldIds]);

  if (selectedBankIds.length === 1) {
    const rssdId = selectedBankIds[0];
    const st = bankStatus[rssdId] || {};
    const bank = banks[rssdId];
    const accent = CARD_ACCENTS[0];
    return (
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.05)" }}>
        <div style={{ background:accent, padding:"16px 20px", display:"flex", alignItems:"center", gap:12 }}>
          <BankLogo bankName={bank?.Name || String(rssdId)} size={22} />
          <div>
            <div style={{ fontSize:12, fontWeight:800, color:"#fff", textTransform:"uppercase", letterSpacing:0.4 }}>{bank?.Name || rssdId}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.7)", marginTop:2 }}>
              {st.present?.length||0} of {selectedFieldIds.size} fields found · {st.missing?.length||0} missing
            </div>
          </div>
        </div>
        <div style={{ padding:"20px" }}>
          {st.missing?.length > 0 ? (
            <div style={{ padding:"10px 14px", background:"#fffbeb", border:"1px solid #fcd34d", borderRadius:8, fontSize:12, color:"#92400e" }}>
              <strong>Not found in this filing:</strong> {st.missing.join(", ")}
            </div>
          ) : (
            <div style={{ padding:"10px 14px", background:"#eef5f0", border:"1px solid #a8d4bc", borderRadius:8, fontSize:12, color:"#1a5c35" }}>
              All {selectedFieldIds.size} selected fields are present in this bank's filing.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <StepCard title="Field Matching" subtitle={`${selectedFieldIds.size} fields will be applied to all banks. Missing fields show as —.`} accent="#1d4ed8">
      {selectedBankIds.map((rssdId, bi) => {
        const bank  = banks[rssdId];
        const st    = bankStatus[rssdId] || {};
        const overr = bankFieldOverrides[rssdId] || new Set(selectedFieldIds);
        const isOpen = expandedBank === rssdId;
        const accent = CARD_ACCENTS[bi % CARD_ACCENTS.length];

        return (
          <div key={rssdId} style={{ marginBottom:10, border:"1px solid #e2e8f0", borderRadius:10, overflow:"hidden" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background: isOpen?"#fff":"#f8fafc", cursor:"pointer" }}
              onClick={() => setExpandedBank(isOpen ? null : rssdId)}>
              <BankLogo bankName={bank?.Name || String(rssdId)} size={18} />
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>{bank?.Name || rssdId}</div>
                <div style={{ fontSize:11, color:"#94a3b8", marginTop:1 }}>{st.present?.length||0} found · {st.missing?.length||0} missing</div>
              </div>
              {st.missing?.length > 0
                ? <span style={{ fontSize:11, background:"#fffbeb", color:"#92400e", border:"1px solid #fcd34d", padding:"2px 9px", borderRadius:99 }}>⚠ {st.missing.length} missing</span>
                : <span style={{ fontSize:11, background:"#f0fdf4", color:"#1a5c35", border:"1px solid #86efac", padding:"2px 9px", borderRadius:99 }}>✓ All found</span>}
              <span style={{ fontSize:10, color:"#94a3b8" }}>{isOpen?"▲":"▼"}</span>
            </div>
            {isOpen && (
              <div style={{ padding:"12px 14px", borderTop:"1px solid #f1f5f9" }}>
                <p style={{ fontSize:12, color:"#64748b", marginBottom:10 }}>Uncheck fields to exclude for this bank:</p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                  {[...selectedFieldIds].map(code => {
                    const present = st.available?.has(code);
                    const checked = overr.has(code);
                    return (
                      <label key={code} style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", borderRadius:6, fontSize:12, cursor:"pointer",
                        background: present?(checked?accent+"12":"#f9fafb"):"#fef9c3",
                        border:"1px solid "+(present?(checked?accent+"30":"#e2e8f0"):"#fde68a"),
                        color: present?(checked?accent:"#94a3b8"):"#92400e",
                        textDecoration: !checked?"line-through":"none", opacity: !checked?0.6:1 }}>
                        <input type="checkbox" checked={checked} onChange={()=>onSetOverride(rssdId,code,!checked)} style={{ accentColor:accent }} />
                        {code}{!present && <span style={{ fontSize:10 }}> (missing)</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </StepCard>
  );
}

// ─── Step 4: Preview ──────────────────────────────────────────
function StepPreview({ allCatalogs, selectedBankIds, selectedPeriods, selectedFieldIds, bankFieldOverrides, banks, exportRef }) {
  const isMultiBank   = selectedBankIds.length > 1;
  const isMultiPeriod = selectedPeriods.length > 1;

  const pivoted = useMemo(() => {
    const data = {};
    for (const [catKey, cat] of Object.entries(allCatalogs)) {
      if (!cat?.sections) continue;
      const rssdId = cat.rssdId;
      if (!selectedBankIds.includes(rssdId) && !selectedBankIds.includes(Number(rssdId))) continue;
      const overrides = bankFieldOverrides[rssdId] || bankFieldOverrides[Number(rssdId)] || selectedFieldIds;
      const colKey = isMultiBank && isMultiPeriod
        ? (banks[rssdId]?.Name || rssdId) + "\n" + cat.period
        : isMultiBank ? (banks[rssdId]?.Name || String(rssdId)) : cat.period;
      for (const [section, fields] of Object.entries(cat.sections)) {
        for (const f of fields) {
          if (!selectedFieldIds.has(f.item_code) || !overrides.has(f.item_code)) continue;
          if (!data[section]) data[section] = {};
          if (!data[section][f.item_code]) data[section][f.item_code] = { description:f.description, values:{} };
          data[section][f.item_code].values[colKey] = f.value;
        }
      }
    }
    return data;
  }, [allCatalogs, selectedBankIds, selectedPeriods, selectedFieldIds, bankFieldOverrides, banks, isMultiBank, isMultiPeriod]);

  const colKeys = useMemo(() => {
    if (!isMultiBank && !isMultiPeriod) return [];
    const keys = new Set();
    for (const section of Object.values(pivoted))
      for (const row of Object.values(section))
        Object.keys(row.values).forEach(k => keys.add(k));
    return [...keys].sort();
  }, [pivoted, isMultiBank, isMultiPeriod]);

  const handlePDF = () => {
    const label = selectedBankIds.length > 1 ? selectedBankIds.length+" Banks" : (banks[selectedBankIds[0]]?.Name||"");
    let html = "<h1>"+label+"</h1><div class=\"meta\">Periods: <strong>"+selectedPeriods.join(", ")+"</strong> | Generated: <strong>"+new Date().toLocaleString()+"</strong></div>";
    for (const [sec, rows] of Object.entries(pivoted)) {
      if (!Object.keys(rows).length) continue;
      html += "<div class=\"section-title\">"+sec+"</div><table><thead><tr><th>Code</th><th>Description</th>"+colKeys.map(k=>"<th class=\"num\">"+k.replace("\n"," · ")+"</th>").join("")+"</tr></thead><tbody>";
      for (const [code, row] of Object.entries(rows))
        html += "<tr><td>"+code+"</td><td>"+row.description+"</td>"+colKeys.map(k=>"<td class=\"num\">"+fmt(row.values[k]??null)+"</td>").join("")+"</tr>";
      html += "</tbody></table>";
    }
    triggerPrint(html, "FFIEC Custom Report");
  };
  const handleCSV = () => {
    const rows = [["Section","Item Code","Description",...colKeys.map(k=>k.replace("\n"," · "))]];
    for (const [sec, items] of Object.entries(pivoted))
      for (const [code, row] of Object.entries(items))
        rows.push([sec, code, row.description, ...colKeys.map(k=>row.values[k]??"")]);
    exportCSV(rows, "call_report_custom_"+new Date().toISOString().slice(0,10)+".csv");
  };

  if (exportRef) { exportRef.current._csv = handleCSV; exportRef.current._pdf = handlePDF; }

  const totalFields = Object.values(pivoted).reduce((s,r) => s+Object.keys(r).length, 0);

  return (
    <div>
      {/* Summary card */}
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.05)", marginBottom:16 }}>
        <div style={{ background:"#1d4ed8", padding:"16px 20px", display:"flex", alignItems:"center", gap:20 }}>
          <div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", textTransform:"uppercase", letterSpacing:0.8 }}>Banks</div>
            <div style={{ fontSize:22, fontWeight:800, color:"#fff" }}>{selectedBankIds.length}</div>
          </div>
          <div style={{ width:1, height:36, background:"rgba(255,255,255,0.2)" }} />
          <div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", textTransform:"uppercase", letterSpacing:0.8 }}>Periods</div>
            <div style={{ fontSize:22, fontWeight:800, color:"#fff" }}>{selectedPeriods.length}</div>
          </div>
          <div style={{ width:1, height:36, background:"rgba(255,255,255,0.2)" }} />
          <div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", textTransform:"uppercase", letterSpacing:0.8 }}>Fields</div>
            <div style={{ fontSize:22, fontWeight:800, color:"#fff" }}>{totalFields.toLocaleString()}</div>
          </div>
          <div style={{ marginLeft:"auto", fontSize:11, color:"rgba(255,255,255,0.7)" }}>
            {selectedPeriods.join(" · ")}
          </div>
        </div>
      </div>

      {/* One card per section */}
      {Object.entries(pivoted).map(([section, rows]) => {
        if (!Object.keys(rows).length) return null;
        const col = SCHEDULE_COLORS[section] || "#64748b";
        const [sectionOpen, setSectionOpen] = React.useState(false);
        return (
          <div key={section} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,0.05)", marginBottom:12 }}>
            {/* Clickable section header */}
            <div
              onClick={() => setSectionOpen(o => !o)}
              style={{ background:col, padding:"12px 20px", display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none" }}
            >
              <div style={{ width:32, height:32, borderRadius:7, background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, color:"#fff", flexShrink:0 }}>
                {section.slice(0,3)}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#fff", textTransform:"uppercase", letterSpacing:0.5 }}>Schedule {section}</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.65)", marginTop:2 }}>{Object.keys(rows).length} fields selected</div>
              </div>
              {/* Summary pills when collapsed */}
              {!sectionOpen && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", maxWidth:300 }}>
                  {Object.keys(rows).slice(0,5).map(code => (
                    <span key={code} style={{ fontSize:10, fontFamily:"monospace", background:"rgba(255,255,255,0.18)", color:"#fff", padding:"2px 7px", borderRadius:4 }}>{code}</span>
                  ))}
                  {Object.keys(rows).length > 5 && <span style={{ fontSize:10, color:"rgba(255,255,255,0.6)" }}>+{Object.keys(rows).length - 5} more</span>}
                </div>
              )}
              <div style={{ width:22, height:22, borderRadius:"50%", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#fff", fontWeight:700, flexShrink:0, marginLeft:8 }}>
                {sectionOpen ? "▲" : "▼"}
              </div>
            </div>

            {/* Table — only shown when expanded */}
            {sectionOpen && (() => {
              const dataCols = Math.max(colKeys.length, 1);
              const minW     = 110 + 260 + dataCols * 160;
              return (
              <SyncScrollTable tableWidth={minW} accentColor={col}>
              <table style={{ borderCollapse:"collapse", tableLayout:"fixed", minWidth:minW, width:"100%" }}>
                <colgroup>
                  <col style={{ width:110 }} />
                  <col style={{ width:260 }} />
                  {(colKeys.length > 0 ? colKeys : ["Value"]).map(k => (
                    <col key={k} style={{ minWidth:160 }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ background:"#f8fafc" }}>
                    <th style={{ padding:"8px 14px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"#94a3b8", borderBottom:`2px solid ${col}25`, textAlign:"left", position:"sticky", left:0, background:"#f8fafc", zIndex:2, boxShadow:"2px 0 0 #e2e8f0" }}>
                      Code
                    </th>
                    <th style={{ padding:"8px 14px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, color:"#94a3b8", borderBottom:`2px solid ${col}25`, textAlign:"left", position:"sticky", left:110, background:"#f8fafc", zIndex:2, boxShadow:"2px 0 0 #e2e8f0" }}>
                      Description
                    </th>
                    {(colKeys.length > 0 ? colKeys : ["Value"]).map(k => (
                      <th key={k} style={{ padding:"8px 14px", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.6, color:"#94a3b8", borderBottom:`2px solid ${col}25`, textAlign:"right", whiteSpace:"normal", lineHeight:1.3, wordBreak:"break-word" }}>
                        {k.replace("\n", " · ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(rows).map(([code, row], i) => {
                    const bg = i%2===0 ? "#fff" : "#fafbfc";
                    return (
                      <tr key={code} style={{ background:bg }}
                        onMouseEnter={e=>e.currentTarget.style.background=col+"08"}
                        onMouseLeave={e=>e.currentTarget.style.background=bg}>
                        <td style={{ padding:"7px 14px", borderBottom:"1px solid #f8fafc", whiteSpace:"nowrap", position:"sticky", left:0, background:"inherit", zIndex:1, boxShadow:"2px 0 0 #f1f5f9" }}>
                          <span style={{ fontSize:11, fontFamily:"monospace", fontWeight:700, color:col, background:col+"10", border:`1px solid ${col}20`, padding:"2px 7px", borderRadius:4 }}>{code}</span>
                        </td>
                        <td style={{ padding:"7px 14px", fontSize:12, color:"#374151", borderBottom:"1px solid #f8fafc", lineHeight:1.4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", position:"sticky", left:110, background:"inherit", zIndex:1, boxShadow:"2px 0 0 #f1f5f9" }}>
                          {row.description}
                        </td>
                        {colKeys.length > 0
                          ? colKeys.map(k => (
                              <td key={k} style={{ padding:"7px 14px", textAlign:"right", fontFamily:"monospace", fontSize:13, fontWeight:600, color:row.values[k]!==undefined?"#0f172a":"#cbd5e1", borderBottom:"1px solid #f8fafc", whiteSpace:"nowrap" }}>
                                {row.values[k]!==undefined ? fmt(row.values[k]) : "—"}
                              </td>
                            ))
                          : <td style={{ padding:"7px 14px", textAlign:"right", fontFamily:"monospace", fontSize:13, fontWeight:600, color:"#0f172a", borderBottom:"1px solid #f8fafc", whiteSpace:"nowrap" }}>
                              {fmt(Object.values(row.values)[0])}
                            </td>
                        }
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </SyncScrollTable>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────
export default function CustomReport({ selectedBanks, selectedPeriods, banksById }) {
  const periods = selectedPeriods || [];
  const bankIds = selectedBanks  || [];

  const [step, setStep]                       = useState(0);
  const exportRef                             = React.useRef({});
  const [selectedSections, setSelectedSections] = useState([]);
  const [allCatalogs, setAllCatalogs]         = useState({});
  const [loadingCatalog, setLoadingCatalog]   = useState(false);
  const [catalogError, setCatalogError]       = useState(null);
  const [catalogLoaded, setCatalogLoaded]     = useState(false);
  const [selectedFieldIds, setSelectedFieldIds] = useState(new Set());
  const [bankFieldOverrides, setBankFieldOverrides] = useState({});

  const loadCatalogs = async () => {
    if (!bankIds.length || !periods.length) return;
    setLoadingCatalog(true); setCatalogError(null);
    try {
      const combos  = bankIds.flatMap(rssdId => periods.map(period => ({ rssdId, period })));
      const results = await Promise.all(combos.map(({rssdId, period}) =>
        fetchAllFields(rssdId, period).then(d => ({
          key: String(rssdId)+"::"+period,
          data: {...d, rssdId, period, bankName:(banksById||{})[rssdId]?.Name||String(rssdId)},
        }))
      ));
      const map = {}; results.forEach(({key,data}) => { map[key]=data; });
      setAllCatalogs(map); setCatalogLoaded(true);
    } catch(e) { setCatalogError("Failed to load field catalog: "+e.message); }
    finally { setLoadingCatalog(false); }
  };

  const availableSections = useMemo(() => {
    const s = new Set();
    Object.values(allCatalogs).forEach(c => Object.keys(c.sections||{}).forEach(k=>s.add(k)));
    return [...s].sort();
  }, [allCatalogs]);

  const catalogForFieldPicker = useMemo(() => {
    if (!catalogLoaded) return {};
    const ref = Object.values(allCatalogs)[0]; if (!ref) return {};
    const r = {};
    for (const sec of selectedSections) {
      const fields = (ref.sections||{})[sec]||[];
      if (fields.length) r[sec] = fields;
    }
    return r;
  }, [allCatalogs, selectedSections, catalogLoaded]);

  const handleToggleSection = s => setSelectedSections(p => p.includes(s)?p.filter(x=>x!==s):[...p,s]);
  const handleToggleField   = code => setSelectedFieldIds(prev => { const n=new Set(prev); n.has(code)?n.delete(code):n.add(code); return n; });
  const handleToggleSectionFields = (fields, sel) => setSelectedFieldIds(prev => { const n=new Set(prev); fields.forEach(f=>sel?n.add(f.item_code):n.delete(f.item_code)); return n; });
  const handleSetOverride = (rssdId, code, include) => setBankFieldOverrides(prev => {
    const cur = prev[rssdId] ? new Set(prev[rssdId]) : new Set(selectedFieldIds);
    include ? cur.add(code) : cur.delete(code);
    return {...prev, [rssdId]:cur};
  });

  // Load catalog on mount or when bank/period combo changes.
  // catalogLoaded persists in component state — if the combo hasn't changed,
  // we skip the fetch. Since React re-mounts this component on tab switch,
  // we track the loaded combo in a ref to avoid redundant fetches.
  const loadedComboRef = React.useRef("");
  React.useEffect(() => {
    const combo = bankIds.join(",") + "|" + periods.join(",");
    if (bankIds.length > 0 && periods.length > 0 && loadedComboRef.current !== combo) {
      loadedComboRef.current = combo;
      loadCatalogs();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankIds.join(","), periods.join(",")]);

  const handleNextFromSections = () => setStep(1);  // catalog already loaded
  const handleNextFromFields   = () => { const init={}; bankIds.forEach(id=>{init[id]=new Set(selectedFieldIds);}); setBankFieldOverrides(init); setStep(2); };
  const restart = () => { setStep(0); setSelectedSections([]); setSelectedFieldIds(new Set()); setBankFieldOverrides({}); };

  if (!bankIds.length || !periods.length) {
    return (
      <div style={{ padding:"60px 0", textAlign:"center", color:"#94a3b8" }}>
        <div style={{ fontSize:32, marginBottom:12, fontWeight:300 }}>⊞</div>
        <p style={{ fontSize:14 }}>Select at least one <strong style={{color:"#0f172a"}}>bank</strong> and one <strong style={{color:"#0f172a"}}>reporting period</strong>, then click <strong style={{color:"#0f172a"}}>Load Reports</strong>.</p>
      </div>
    );
  }

  return (
    <div style={{ width:"100%" }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:18, fontWeight:800, color:"#1a2e20", letterSpacing:"-0.5px" }}>Custom Report Builder</div>
        <div style={{ fontSize:12, color:"#5a7a68", marginTop:2 }}>
          {bankIds.length} bank{bankIds.length>1?"s":""} · {periods.length} period{periods.length>1?"s":""}
          {periods.length>1 && " · Pivoted comparison view"}
        </div>
      </div>

      <StepBar
        steps={STEPS} current={step} isPreview={step===3} exportRef={exportRef} onRestart={restart}
        onBack={step===1?()=>setStep(0):step===2?()=>setStep(1):step===3?()=>setStep(2):undefined}
        onNext={step===0?handleNextFromSections:step===1?handleNextFromFields:step===2?()=>setStep(3):undefined}
        nextDisabled={step===0?!selectedSections.length:step===1?!selectedFieldIds.size:false}
        nextLabel={step===1&&selectedFieldIds.size>0?selectedFieldIds.size+" fields selected":null}
      />

      {catalogError && <div style={{ padding:"10px 14px", background:"#fef2f2", border:"1px solid #fca5a5", borderRadius:8, color:"#dc2626", fontSize:13, marginBottom:16 }}>{catalogError}</div>}

      {/* Step 0 — show spinner while catalog loads, then real sections from API */}
      {step===0 && (
        loadingCatalog ? (
          <div style={{ padding:"40px 0", textAlign:"center", color:"#94a3b8", fontSize:14 }}>
            <div style={{ width:24, height:24, border:"2.5px solid #e2e8f0", borderTopColor:"#115740", borderRadius:"50%", animation:"spin 0.7s linear infinite", margin:"0 auto 12px" }} />
            Loading schedules from FFIEC API…
          </div>
        ) : (
          <StepSections
            availableSections={availableSections}
            selectedSections={selectedSections}
            onToggle={handleToggleSection}
          />
        )
      )}
      {step===1 && catalogLoaded && (
        <StepFields catalogSections={catalogForFieldPicker} selectedFieldIds={selectedFieldIds} onToggleField={handleToggleField} onToggleSection={handleToggleSectionFields} />
      )}
      {step===2 && (
        <StepBanks banks={banksById||{}} selectedBankIds={bankIds} allCatalogs={allCatalogs} selectedFieldIds={selectedFieldIds} bankFieldOverrides={bankFieldOverrides} onSetOverride={handleSetOverride} />
      )}
      {step===3 && (
        <StepPreview allCatalogs={allCatalogs} selectedBankIds={bankIds} selectedPeriods={periods} selectedFieldIds={selectedFieldIds} bankFieldOverrides={bankFieldOverrides} banks={banksById||{}} exportRef={exportRef} />
      )}
    </div>
  );
}