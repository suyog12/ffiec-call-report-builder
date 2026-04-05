export default function Header({ bank, period, sidebarCollapsed, onToggleSidebar }) {
  return (
    <div style={{
      background: "#fff",
      borderBottom: "1px solid #e4e9e2",
      padding: "0 24px",
      height: 56,
      display: "flex",
      alignItems: "center",
      gap: 16,
      position: "sticky",
      top: 0,
      zIndex: 9,
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

      {/* W&M green accent bar */}
      <div style={{
        width: 3, height: 22, borderRadius: 2,
        background: "#115740",
        flexShrink: 0,
      }} />

      {/* Title in Georgia serif */}
      <span style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontWeight: 700,
        fontStyle: "italic",
        fontSize: 15,
        color: "#1a2e20",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: 420,
        letterSpacing: "0.01em",
      }}>
        {bank || "Select a Bank"}
      </span>

      {/* Period badge - only for call report (not UBPR) */}
      {period && period !== "-" && (
        <span style={{
          fontSize: 11,
          color: "#5a7a68",
          background: "#f4f6f0",
          border: "1px solid #d4ddd0",
          padding: "3px 10px",
          borderRadius: 4,
          whiteSpace: "nowrap",
          flexShrink: 0,
          fontWeight: 500,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
        }}>
          {period}
        </span>
      )}
    </div>
  );
}