import { useState, useEffect, useRef, useMemo } from "react";
import { WM } from "../../theme/colors";

// Local aliases so component code stays readable
const G      = WM.green;
const BORDER = "#e4e9e2";
const BG     = "#f4f6f0";
const TEXT   = "#1a2e20";
const MUTED  = "#6b8878";

export default function BankSearch({ banks, value, onSelect, placeholder = "Search institution…" }) {
  const [query, setQuery] = useState(value?.Name ? String(value.Name).trim() : "");
  const [open, setOpen]   = useState(false);
  const ref               = useRef(null);

  // Keep input text in sync when parent resets the selection
  useEffect(() => {
    setQuery(value?.Name ? String(value.Name).trim() : "");
  }, [value]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() =>
    banks.filter(b => {
      if (!query) return false;
      const q = query.toLowerCase();
      return (
        String(b.Name || "").toLowerCase().includes(q) ||
        String(b.ID_RSSD || "").includes(query)
      );
    }).slice(0, 80),
    [banks, query]
  );

  const handleSelect = (b) => {
    onSelect(b);
    setQuery(String(b.Name || "").trim());
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); onSelect(null); }}
        placeholder={placeholder}
        onFocus={e => { e.target.style.borderColor = G; setOpen(true); }}
        onBlur={e => { e.target.style.borderColor = BORDER; }}
        style={{
          width: "100%", padding: "10px 14px", fontSize: 13,
          border: `1.5px solid ${BORDER}`, borderRadius: 8,
          outline: "none", boxSizing: "border-box", transition: "border-color 0.15s",
        }}
      />

      {open && filtered.length > 0 && (
        <div style={{
          position: "absolute", zIndex: 50,
          top: "calc(100% + 4px)", left: 0, right: 0,
          background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
          maxHeight: 260, overflowY: "auto",
        }}>
          {filtered.map(b => (
            <div
              key={b.ID_RSSD}
              onClick={() => handleSelect(b)}
              style={{ padding: "10px 14px", cursor: "pointer", borderBottom: `1px solid ${BG}`, fontSize: 13 }}
              onMouseEnter={e => e.currentTarget.style.background = BG}
              onMouseLeave={e => e.currentTarget.style.background = "#fff"}
            >
              <div style={{ fontWeight: 600, color: TEXT }}>{String(b.Name || "").trim()}</div>
              <div style={{ fontSize: 11, color: MUTED }}>
                RSSD {b.ID_RSSD}
                {b.City  ? ` · ${b.City}`  : ""}
                {b.State ? `, ${b.State}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}