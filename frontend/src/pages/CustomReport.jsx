import React, { useState, useMemo } from "react";
import { fetchAllFields } from "../services/api";

// ─── constants ────────────────────────────────────────────────────────────────
const STEPS = ["Sections", "Fields", "Banks", "Preview"];

// ─── tiny helpers ─────────────────────────────────────────────────────────────
function fmt(value) {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  if (isNaN(n)) return String(value ?? "") || "—";
  return n.toLocaleString("en-US");
}

// ─── print + export ───────────────────────────────────────────────────────────
const PRINT_STYLE = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; font-size: 11px; color: #111; }
  @page { margin: 1.2cm 1.5cm; size: A4 landscape; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .meta { font-size: 10px; color: #555; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid #2563eb; }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: #2563eb; margin: 14px 0 4px; border-bottom: 1px solid #2563eb; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th { background: #f3f4f6; font-size: 9px; text-transform: uppercase; letter-spacing: .5px; padding: 4px 6px; text-align: left; border: 1px solid #ddd; }
  td { padding: 3px 6px; border: 1px solid #eee; font-size: 10px; }
  .num { text-align: right; font-family: monospace; }
  .subtotal-row td { font-weight: 700; background: #f9fafb; border-color: #ddd; }
`;

function triggerPrint(html, title) {
  const doc = "<!DOCTYPE html><html><head><meta charset='utf-8'/><title>" + title + "</title><style>" + PRINT_STYLE + "</style></head><body>" + html + "</body></html>";
  const old = document.getElementById("ffiec-iframe");
  if (old) old.remove();
  const f = document.createElement("iframe");
  f.id = "ffiec-iframe";
  f.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;border:none;visibility:hidden;";
  document.body.appendChild(f);
  f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); };
  f.srcdoc = doc;
}

function exportCSV(rows, filename) {
  const csv = rows.map((r) => r.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepBar({ steps, current, onBack, onNext, nextLabel, nextDisabled, isPreview, exportRef, onRestart }) {
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const actionsRef = React.useRef(null);

  React.useEffect(() => {
    const h = (e) => { if (actionsRef.current && !actionsRef.current.contains(e.target)) setActionsOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 20,
      background: "#fff", borderBottom: "1px solid #e2e8f0",
      marginBottom: 24, marginLeft: -28, marginRight: -28,
      padding: "0 28px",
    }}>
      {/* Progress dots */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, paddingTop: 16, paddingBottom: 8 }}>
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: "50%",
                  background: done ? "#059669" : active ? "#0ea5e9" : "#e5e7eb",
                  color: done || active ? "#fff" : "#9ca3af",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                }}>
                  {done ? "✓" : i + 1}
                </div>
                <span style={{ fontSize: 10, fontWeight: active ? 700 : 400, color: active ? "#0f172a" : done ? "#374151" : "#9ca3af", whiteSpace: "nowrap" }}>
                  {s}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div style={{ flex: 1, height: 2, background: done ? "#059669" : "#e2e8f0", margin: "0 6px", marginBottom: 14 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Nav bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 12 }}>
        {/* Left: Back or Start Over */}
        <div style={{ display: "flex", gap: 8 }}>
          {current > 0 && !isPreview && (
            <button className="btn btn-ghost" onClick={onBack}>← Back</button>
          )}
          {isPreview && (
            <>
              <button className="btn btn-ghost" onClick={onBack}>← Back</button>
              <button className="btn btn-ghost" onClick={onRestart}>↺ Start Over</button>
            </>
          )}
        </div>

        {/* Right: Next or Actions */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!isPreview && (
            <>
              {nextLabel && (
                <span style={{ fontSize: 12, color: "#64748b" }}>{nextLabel}</span>
              )}
              <button className="btn btn-primary" onClick={onNext} disabled={nextDisabled}
                style={{ opacity: nextDisabled ? 0.5 : 1, cursor: nextDisabled ? "not-allowed" : "pointer" }}>
                Next →
              </button>
            </>
          )}
          {isPreview && (
            <div className="actions-dropdown" ref={actionsRef}>
              <button className="btn btn-primary" onClick={() => setActionsOpen(o => !o)}>
                Actions ▾
              </button>
              {actionsOpen && (
                <div className="actions-menu">
                  <button className="actions-menu-item" onClick={() => { exportRef && exportRef.current._csv && exportRef.current._csv(); setActionsOpen(false); }}>
                    <span>⬇</span> Export CSV
                  </button>
                  <button className="actions-menu-item" onClick={() => { exportRef && exportRef.current._pdf && exportRef.current._pdf(); setActionsOpen(false); }}>
                    <span>🖨</span> Save as PDF
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Section picker ───────────────────────────────────────────────────
function StepSections({ availableSections, selectedSections, onToggle, onNext }) {
  const groups = {
    "Balance Sheet": ["RC", "RC-C", "RC-B", "RC-D", "RC-E", "RC-F", "RC-G", "RC-H", "RC-K", "RC-L", "RC-M", "RC-N", "RC-O", "RC-P", "RC-Q", "RC-R", "RC-S", "RC-T", "RC-U", "RC-V"],
    "Income": ["RI", "RIA", "RIB", "RIBI", "RIBII", "RIC", "RID", "RIE"],
    "Other": [],
  };
  const grouped = { "Balance Sheet": [], "Income": [], "Other": [] };
  for (const s of availableSections) {
    if (groups["Balance Sheet"].includes(s)) grouped["Balance Sheet"].push(s);
    else if (groups["Income"].includes(s)) grouped["Income"].push(s);
    else grouped["Other"].push(s);
  }

  return (
    <div>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Which schedules do you want to include?</h3>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
        Select one or more FFIEC schedules. Fields within each will be available in the next step.
      </p>

      {Object.entries(grouped).map(([group, sections]) => {
        if (sections.length === 0) return null;
        return (
          <div key={group} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{group}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {sections.map((s) => {
                const sel = selectedSections.includes(s);
                return (
                  <button key={s} onClick={() => onToggle(s)}
                    style={{
                      padding: "6px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                      border: sel ? "2px solid #2563eb" : "2px solid #e5e7eb",
                      background: sel ? "#eff6ff" : "#fff",
                      color: sel ? "#1d4ed8" : "#374151",
                      fontWeight: sel ? 700 : 400,
                    }}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}


    </div>
  );
}

// ─── Step 2: Field picker ─────────────────────────────────────────────────────
function StepFields({ catalogSections, selectedFieldIds, onToggleField, onToggleSection, onBack, onNext }) {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalogSections;
    const result = {};
    for (const [sec, fields] of Object.entries(catalogSections)) {
      const m = fields.filter((f) => f.item_code.toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q));
      if (m.length > 0) result[sec] = m;
    }
    return result;
  }, [catalogSections, search]);

  const totalSelected = selectedFieldIds.size;

  return (
    <div>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Which fields do you need?</h3>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
        Select individual fields. These will be fetched for all selected banks and periods.
      </p>

      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by code or description…"
        style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, marginBottom: 16, boxSizing: "border-box" }} />

      {Object.entries(filtered).map(([section, fields]) => {
        const open = openSections[section] !== false; // default open
        const allSel = fields.every((f) => selectedFieldIds.has(f.item_code));
        const someSel = fields.some((f) => selectedFieldIds.has(f.item_code));
        const selCount = fields.filter((f) => selectedFieldIds.has(f.item_code)).length;

        return (
          <div key={section} style={{ marginBottom: 8, border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "#f9fafb", cursor: "pointer", userSelect: "none" }}
              onClick={() => setOpenSections((p) => ({ ...p, [section]: !open }))}>
              <input type="checkbox" checked={allSel}
                ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
                onChange={(e) => { e.stopPropagation(); onToggleSection(fields, !allSel); }}
                onClick={(e) => e.stopPropagation()}
                style={{ accentColor: "#2563eb" }} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>{section}</span>
              <span style={{ fontSize: 12, color: "#9ca3af" }}>{selCount}/{fields.length} selected</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
            </div>
            {open && (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#fff", fontSize: 11, color: "#6b7280", textAlign: "left" }}>
                    <th style={{ padding: "4px 8px", width: 32 }} />
                    <th style={{ padding: "4px 8px", width: 110 }}>Code</th>
                    <th style={{ padding: "4px 8px" }}>Description</th>
                    <th style={{ padding: "4px 8px", textAlign: "right" }}>Sample Value</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.item_code} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "4px 8px" }}>
                        <input type="checkbox" checked={selectedFieldIds.has(f.item_code)}
                          onChange={() => onToggleField(f.item_code)}
                          style={{ accentColor: "#2563eb" }} />
                      </td>
                      <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: 11, color: "#555" }}>{f.item_code}</td>
                      <td style={{ padding: "4px 8px", fontSize: 13 }}>{f.description}</td>
                      <td style={{ padding: "4px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 12, color: "#374151" }}>{fmt(f.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}


    </div>
  );
}

// ─── Step 3: Bank + field matching ────────────────────────────────────────────
function StepBanks({ banks, selectedBankIds, allCatalogs, selectedSections, selectedFieldIds, bankFieldOverrides, onSetOverride, onBack, onNext }) {
  const [expandedBank, setExpandedBank] = useState(null);

  // For each bank, compute which selected fields are present / missing
  const bankStatus = useMemo(() => {
    const status = {};
    for (const rssdId of selectedBankIds) {
      const bankCatalogs = Object.entries(allCatalogs)
        .filter(([k]) => k.startsWith(String(rssdId) + "::"))
        .map(([, v]) => v);

      // Collect all item_codes available for this bank (across all periods)
      const available = new Set();
      for (const cat of bankCatalogs) {
        for (const fields of Object.values(cat.sections || {})) {
          for (const f of fields) available.add(f.item_code);
        }
      }

      const wanted = [...selectedFieldIds];
      const present = wanted.filter((c) => available.has(c));
      const missing = wanted.filter((c) => !available.has(c));
      status[rssdId] = { available, present, missing };
    }
    return status;
  }, [selectedBankIds, allCatalogs, selectedFieldIds]);

  if (selectedBankIds.length === 1) {
    // Single bank — nothing to configure, just confirm
    const rssdId = selectedBankIds[0];
    const st = bankStatus[rssdId] || {};
    const bank = banks[rssdId];
    return (
      <div>
        <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Confirm fields for {bank?.Name || rssdId}</h3>
        <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
          {st.present?.length || 0} of {selectedFieldIds.size} selected fields are present in this bank's filing.
          {st.missing?.length > 0 && ` ${st.missing.length} will show as —.`}
        </p>
        {st.missing?.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 6, padding: "10px 14px", marginBottom: 16, fontSize: 12 }}>
            <strong>Not found in this filing:</strong> {st.missing.join(", ")}
          </div>
        )}

      </div>
    );
  }

  // Multi-bank: show each bank's match status + allow overrides
  return (
    <div>
      <h3 style={{ margin: "0 0 6px", fontSize: 15 }}>Field matching across banks</h3>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
        The {selectedFieldIds.size} fields you selected will be applied to all banks.
        Where a field is missing for a bank, it will show as —. You can customize per bank below.
      </p>

      {selectedBankIds.map((rssdId) => {
        const bank = banks[rssdId];
        const st = bankStatus[rssdId] || {};
        const overrides = bankFieldOverrides[rssdId] || new Set(selectedFieldIds);
        const isOpen = expandedBank === rssdId;

        return (
          <div key={rssdId} style={{ marginBottom: 10, border: "1px solid #e5e7eb", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f9fafb", cursor: "pointer" }}
              onClick={() => setExpandedBank(isOpen ? null : rssdId)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{bank?.Name || rssdId}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                  {st.present?.length || 0} fields found · {st.missing?.length || 0} missing
                </div>
              </div>
              {st.missing?.length > 0
                ? <span style={{ fontSize: 11, background: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d", borderRadius: 99, padding: "2px 8px" }}>⚠ {st.missing.length} missing</span>
                : <span style={{ fontSize: 11, background: "#f0fdf4", color: "#166534", border: "1px solid #86efac", borderRadius: 99, padding: "2px 8px" }}>✓ All found</span>
              }
              <span style={{ fontSize: 11, color: "#9ca3af" }}>{isOpen ? "▲" : "▼"}</span>
            </div>

            {isOpen && (
              <div style={{ padding: "12px 14px", borderTop: "1px solid #f3f4f6" }}>
                <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
                  Uncheck fields you don't want included for this bank:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[...selectedFieldIds].map((code) => {
                    const present = st.available?.has(code);
                    const checked = overrides.has(code);
                    return (
                      <label key={code} style={{
                        display: "flex", alignItems: "center", gap: 4,
                        padding: "4px 10px", borderRadius: 4, fontSize: 12, cursor: "pointer",
                        background: present ? (checked ? "#eff6ff" : "#f9fafb") : "#fef9c3",
                        border: "1px solid " + (present ? "#bfdbfe" : "#fde68a"),
                        color: present ? "#1d4ed8" : "#92400e",
                        textDecoration: !checked ? "line-through" : "none",
                        opacity: !checked ? 0.6 : 1,
                      }}>
                        <input type="checkbox" checked={checked}
                          onChange={() => onSetOverride(rssdId, code, !checked)}
                          style={{ accentColor: "#2563eb" }} />
                        {code}
                        {!present && <span style={{ fontSize: 10 }}> (missing)</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}


    </div>
  );
}

// ─── Step 4: Preview ──────────────────────────────────────────────────────────
function StepPreview({ allCatalogs, selectedBankIds, selectedPeriods, selectedFieldIds, bankFieldOverrides, banks, exportRef }) {
  const isMultiBank = selectedBankIds.length > 1;
  const isMultiPeriod = selectedPeriods.length > 1;

  // Build the pivoted data structure:
  // { section: { item_code: { description, values: { "bankKey::period": value } } } }
  const pivoted = useMemo(() => {
    const data = {};

    for (const [catKey, cat] of Object.entries(allCatalogs)) {
      if (!cat || !cat.sections) continue;
      const rssdId = cat.rssdId;
      const period = cat.period;

      // Only include banks the user selected
      if (!selectedBankIds.includes(rssdId) && !selectedBankIds.includes(Number(rssdId))) continue;

      const overrides = bankFieldOverrides[rssdId] || bankFieldOverrides[Number(rssdId)] || selectedFieldIds;
      const colKey = isMultiBank && isMultiPeriod
        ? (banks[rssdId]?.Name || rssdId) + "\n" + period
        : isMultiBank
        ? (banks[rssdId]?.Name || String(rssdId))
        : period;

      for (const [section, fields] of Object.entries(cat.sections)) {
        for (const f of fields) {
          if (!selectedFieldIds.has(f.item_code)) continue;
          if (!overrides.has(f.item_code)) continue;

          if (!data[section]) data[section] = {};
          if (!data[section][f.item_code]) data[section][f.item_code] = { description: f.description, values: {} };
          data[section][f.item_code].values[colKey] = f.value;
        }
      }
    }
    return data;
  }, [allCatalogs, selectedBankIds, selectedPeriods, selectedFieldIds, bankFieldOverrides, banks, isMultiBank, isMultiPeriod]);

  // Column headers
  const colKeys = useMemo(() => {
    if (!isMultiBank && !isMultiPeriod) return [];
    const keys = new Set();
    for (const section of Object.values(pivoted)) {
      for (const row of Object.values(section)) {
        Object.keys(row.values).forEach((k) => keys.add(k));
      }
    }
    // Sort: by period desc for multi-period, by bank name for multi-bank
    return [...keys].sort();
  }, [pivoted, isMultiBank, isMultiPeriod]);

  const handlePDF = () => {
    const bankLabel = selectedBankIds.length > 1
      ? selectedBankIds.length + " Banks"
      : (banks[selectedBankIds[0]]?.Name || "");
    let html = "<h1>" + bankLabel + "</h1><div class=\"meta\">Periods: <strong>" +
      selectedPeriods.join(", ") + "</strong> | Generated: <strong>" + new Date().toLocaleString() + "</strong></div>";
    for (const [section, rows] of Object.entries(pivoted)) {
      if (Object.keys(rows).length === 0) continue;
      html += "<div class=\"section-title\">" + section + "</div><table><thead><tr><th>Code</th><th>Description</th>" +
        colKeys.map((k) => "<th class=\"num\">" + k.replace("\n", " · ") + "</th>").join("") +
        "</tr></thead><tbody>";
      for (const [code, row] of Object.entries(rows)) {
        html += "<tr><td>" + code + "</td><td>" + row.description + "</td>" +
          colKeys.map((k) => "<td class=\"num\">" + fmt(row.values[k] ?? null) + "</td>").join("") + "</tr>";
      }
      html += "</tbody></table>";
    }
    triggerPrint(html, "FFIEC Call Report");
  };

  const handleCSV = () => {
    const colLabels = colKeys.map((k) => k.replace("\n", " · "));
    const rows = [["Section", "Item Code", "Description", ...colLabels]];
    for (const [section, items] of Object.entries(pivoted)) {
      for (const [code, row] of Object.entries(items)) {
        rows.push([section, code, row.description, ...colKeys.map((k) => row.values[k] ?? "")]);
      }
    }
    exportCSV(rows, "call_report_" + new Date().toISOString().slice(0, 10) + ".csv");
  };

  // Register handlers via useEffect — runs after render, stable via useCallback
  React.useEffect(() => {
    if (exportRef) {
      exportRef.current._csv = handleCSV;
      exportRef.current._pdf = handlePDF;
    }
  }); // no deps — re-registers on every render so pivoted/colKeys stay fresh

  return (
    <div>

      {/* report header */}
      <div style={{ marginBottom: 20, padding: "14px 16px", background: "#eff6ff", borderRadius: 8, border: "1px solid #bfdbfe" }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>
          {selectedBankIds.length === 1 ? (banks[selectedBankIds[0]]?.Name || selectedBankIds[0]) : selectedBankIds.length + " Banks Compared"}
        </div>
        <div style={{ fontSize: 12, color: "#3b82f6", marginTop: 3 }}>
          {selectedPeriods.join(" · ")} · {Object.values(pivoted).reduce((s, r) => s + Object.keys(r).length, 0)} fields
        </div>
      </div>

      {/* pivoted tables */}
      {Object.entries(pivoted).map(([section, rows]) => {
        if (Object.keys(rows).length === 0) return null;
        return (
          <div key={section} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: "#2563eb", marginBottom: 6, borderBottom: "1px solid #2563eb", paddingBottom: 3 }}>
              {section}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 500 }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    <th style={{ padding: "6px 10px", textAlign: "left", border: "1px solid #ddd", minWidth: 100 }}>Code</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", border: "1px solid #ddd" }}>Description</th>
                    {colKeys.map((k) => (
                      <th key={k} style={{ padding: "6px 10px", textAlign: "right", border: "1px solid #ddd", minWidth: 120, whiteSpace: "pre-line", lineHeight: 1.3 }}>
                        {k}
                      </th>
                    ))}
                    {colKeys.length === 0 && (
                      <th style={{ padding: "6px 10px", textAlign: "right", border: "1px solid #ddd" }}>Value</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(rows).map(([code, row]) => (
                    <tr key={code} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "5px 10px", fontFamily: "monospace", fontSize: 11, color: "#555", border: "1px solid #eee" }}>{code}</td>
                      <td style={{ padding: "5px 10px", border: "1px solid #eee" }}>{row.description}</td>
                      {colKeys.length > 0
                        ? colKeys.map((k) => (
                            <td key={k} style={{ padding: "5px 10px", textAlign: "right", fontFamily: "monospace", border: "1px solid #eee" }}>
                              {row.values[k] !== undefined ? fmt(row.values[k]) : <span style={{ color: "#9ca3af" }}>—</span>}
                            </td>
                          ))
                        : (
                          <td style={{ padding: "5px 10px", textAlign: "right", fontFamily: "monospace", border: "1px solid #eee" }}>
                            {fmt(Object.values(row.values)[0])}
                          </td>
                        )
                      }
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function CustomReport({ selectedBanks, selectedPeriods, banksById }) {
  const periods = selectedPeriods || [];
  const bankIds = selectedBanks || [];

  // Wizard state
  const [step, setStep] = useState(0);
  const previewExportRef = React.useRef({});
  const isMultiPeriod = periods.length > 1;
  // If multi-period, wizard starts at step 0 (sections), same as single-period
  // The difference is what we show in preview (pivoted by period)

  // Step 1: sections
  const [selectedSections, setSelectedSections] = useState([]);

  // All catalogs loaded from API, keyed by "rssdId::period"
  const [allCatalogs, setAllCatalogs] = useState({});
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // Step 2: fields (by item_code, not unique per period)
  const [selectedFieldIds, setSelectedFieldIds] = useState(new Set());

  // Step 3: per-bank field overrides
  const [bankFieldOverrides, setBankFieldOverrides] = useState({});

  // Load all catalogs once on mount (or when banks/periods change)
  const loadCatalogs = async () => {
    if (bankIds.length === 0 || periods.length === 0) return;
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const combos = bankIds.flatMap((rssdId) => periods.map((period) => ({ rssdId, period })));
      const results = await Promise.all(
        combos.map(({ rssdId, period }) =>
          fetchAllFields(rssdId, period).then((d) => ({
            key: String(rssdId) + "::" + period,
            data: { ...d, rssdId, period, bankName: (banksById || {})[rssdId]?.Name || String(rssdId) },
          }))
        )
      );
      const map = {};
      results.forEach(({ key, data }) => { map[key] = data; });
      setAllCatalogs(map);
      setCatalogLoaded(true);
    } catch (e) {
      setCatalogError("Failed to load field catalog: " + e.message);
    } finally {
      setLoadingCatalog(false);
    }
  };

  // Sections available across all loaded catalogs
  const availableSections = useMemo(() => {
    const secs = new Set();
    for (const cat of Object.values(allCatalogs)) {
      Object.keys(cat.sections || {}).forEach((s) => secs.add(s));
    }
    return [...secs].sort();
  }, [allCatalogs]);

  // Catalog filtered to selected sections, deduplicated by item_code
  // (use first bank's first period as the "reference" for the field picker)
  const catalogForFieldPicker = useMemo(() => {
    if (!catalogLoaded) return {};
    const ref = Object.values(allCatalogs)[0];
    if (!ref) return {};
    const result = {};
    for (const section of selectedSections) {
      const fields = (ref.sections || {})[section] || [];
      if (fields.length > 0) result[section] = fields;
    }
    return result;
  }, [allCatalogs, selectedSections, catalogLoaded]);

  const handleToggleSection_step1 = (s) =>
    setSelectedSections((p) => p.includes(s) ? p.filter((x) => x !== s) : [...p, s]);

  const handleToggleField = (code) =>
    setSelectedFieldIds((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  const handleToggleSectionFields = (fields, select) =>
    setSelectedFieldIds((prev) => {
      const next = new Set(prev);
      fields.forEach((f) => select ? next.add(f.item_code) : next.delete(f.item_code));
      return next;
    });

  const handleSetOverride = (rssdId, code, include) => {
    setBankFieldOverrides((prev) => {
      const current = prev[rssdId] ? new Set(prev[rssdId]) : new Set(selectedFieldIds);
      include ? current.add(code) : current.delete(code);
      return { ...prev, [rssdId]: current };
    });
  };

  const handleNextFromSections = async () => {
    if (!catalogLoaded) await loadCatalogs();
    setStep(1);
  };

  const handleNextFromFields = () => {
    // Init overrides to full selection for each bank
    const init = {};
    bankIds.forEach((id) => { init[id] = new Set(selectedFieldIds); });
    setBankFieldOverrides(init);
    setStep(2);
  };

  const restart = () => {
    setStep(0);
    setSelectedSections([]);
    setSelectedFieldIds(new Set());
    setBankFieldOverrides({});
  };

  // Guard
  if (bankIds.length === 0 || periods.length === 0) {
    return (
      <div style={{ padding: 32, color: "#6b7280", fontSize: 14 }}>
        <h2 style={{ marginBottom: 12, fontSize: 18, color: "#111" }}>Custom Report Builder</h2>
        <p>Select at least one <strong>bank</strong> and one <strong>reporting period</strong> in the sidebar, then click <strong>Load Reports</strong>.</p>
      </div>
    );
  }

  const stepsToShow = STEPS;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1100 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Custom Report Builder</h2>
        <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
          {bankIds.length} bank{bankIds.length > 1 ? "s" : ""} · {periods.length} period{periods.length > 1 ? "s" : ""}
          {isMultiPeriod && " · Pivoted comparison view"}
        </p>
      </div>

      {/* Wizard nav — sticky, always visible */}
      {(() => {
        const navProps = {
          steps: stepsToShow,
          current: step,
          isPreview: step === 3,
          onBack: step === 1 ? () => setStep(0)
                : step === 2 ? () => setStep(1)
                : step === 3 ? () => setStep(2)
                : undefined,
          onNext: step === 0 ? handleNextFromSections
                : step === 1 ? handleNextFromFields
                : step === 2 ? () => setStep(3)
                : undefined,
          nextDisabled: step === 0 ? selectedSections.length === 0
                      : step === 1 ? selectedFieldIds.size === 0
                      : false,
          nextLabel: step === 1 && selectedFieldIds.size > 0 ? selectedFieldIds.size + " fields selected" : null,
          exportRef: previewExportRef,
          onRestart: restart,
        };
        return <StepBar {...navProps} />;
      })()}

      {catalogError && (
        <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, color: "#dc2626", fontSize: 13, marginBottom: 16 }}>
          {catalogError}
        </div>
      )}

      {loadingCatalog && (
        <div style={{ padding: 20, textAlign: "center", color: "#6b7280", fontSize: 14 }}>
          Loading field catalog for {bankIds.length} bank{bankIds.length > 1 ? "s" : ""} × {periods.length} period{periods.length > 1 ? "s" : ""}…
        </div>
      )}

      {!loadingCatalog && step === 0 && (
        <StepSections
          availableSections={availableSections.length > 0 ? availableSections : ["RC", "RI", "RC-C", "RIA", "RIE", "RIBII", "RIC", "ENT", "SU", "NARR", "CI", "RID", "RIBI", "RIB"]}
          selectedSections={selectedSections}
          onToggle={handleToggleSection_step1}
        />
      )}

      {!loadingCatalog && step === 1 && catalogLoaded && (
        <StepFields
          catalogSections={catalogForFieldPicker}
          selectedFieldIds={selectedFieldIds}
          onToggleField={handleToggleField}
          onToggleSection={handleToggleSectionFields}
        />
      )}

      {!loadingCatalog && step === 2 && (
        <StepBanks
          banks={banksById || {}}
          selectedBankIds={bankIds}
          allCatalogs={allCatalogs}
          selectedSections={selectedSections}
          selectedFieldIds={selectedFieldIds}
          bankFieldOverrides={bankFieldOverrides}
          onSetOverride={handleSetOverride}
        />
      )}

      {!loadingCatalog && step === 3 && (
        <StepPreview
          allCatalogs={allCatalogs}
          selectedBankIds={bankIds}
          selectedPeriods={periods}
          selectedFieldIds={selectedFieldIds}
          bankFieldOverrides={bankFieldOverrides}
          banks={banksById || {}}
          exportRef={previewExportRef}
        />
      )}
    </div>
  );
}