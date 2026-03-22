const TAB_ICONS = {
  Overview: "◈",
  PDF:      "⎙",
  Sections: "≡",
  Metrics:  "◎",
  Custom:   "⊞",
};

export default function Tabs({ active, setActive }) {
  const tabs = ["Overview", "PDF", "Sections", "Metrics", "Custom"];
  return (
    <nav style={{
      background: "#fafbf8",
      borderBottom: "1px solid #e4e9e2",
      padding: "0 24px",
      display: "flex", gap: 2,
    }}>
      {tabs.map(tab => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            style={{
              padding: "12px 16px",
              border: "none",
              background: "transparent",
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "#115740" : "#5a7a68",
              cursor: "pointer",
              borderBottom: isActive ? "2px solid #115740" : "2px solid transparent",
              transition: "color 0.15s, border-color 0.15s",
              whiteSpace: "nowrap",
              display: "flex", alignItems: "center", gap: 6,
            }}
            onMouseEnter={e => { if (!isActive) { e.currentTarget.style.color = "#1a2e20"; } }}
            onMouseLeave={e => { if (!isActive) { e.currentTarget.style.color = "#5a7a68"; } }}
          >
            <span style={{ fontSize: 12, opacity: isActive ? 1 : 0.7 }}>{TAB_ICONS[tab]}</span>
            {tab}
          </button>
        );
      })}
    </nav>
  );
}