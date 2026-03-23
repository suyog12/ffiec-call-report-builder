export default function Header({ bank, period, sidebarCollapsed, onToggleSidebar }) {
  return (
    <div style={{
      background: "#fafbf8",
      borderBottom: "1px solid #e4e9e2",
      padding: "0 24px",
      height: 56,
      display: "flex",
      alignItems: "center",
      gap: 16,
      position: "sticky",
      top: 0,
      zIndex: 9,
      // Subtle green-tinted left border -visual echo of the sidebar
      boxShadow: "0 1px 3px rgba(17,87,64,0.06)",
    }}>
      {/* Sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}
        style={{
          width: 32, height: 32,
          border: "1px solid #d4ddd0",
          borderRadius: 6,
          background: "transparent",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#5a7a68",
          fontSize: 16, flexShrink: 0,
          transition: "background 0.15s, color 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "#eef2eb"; e.currentTarget.style.color = "#115740"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#5a7a68"; }}
      >
        {sidebarCollapsed ? "☰" : "✕"}
      </button>

      {/* Green accent dot */}
      <div style={{
        width: 6, height: 6, borderRadius: "50%",
        background: "#115740",
        flexShrink: 0,
        opacity: 0.5,
      }} />

      {/* Bank name */}
      <span style={{
        fontWeight: 600, fontSize: 14,
        color: "#1a2e20",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        maxWidth: 400,
      }}>
        {bank || "Select a Bank"}
      </span>

      {/* Period badge */}
      {period && period !== "—" && (
        <span style={{
          fontSize: 12, color: "#5a7a68",
          background: "#eef2eb",
          border: "1px solid #d4ddd0",
          padding: "3px 10px",
          borderRadius: 99,
          whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {period}
        </span>
      )}
    </div>
  );
}