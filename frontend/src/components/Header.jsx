export default function Header({ bank, period, sidebarCollapsed, onToggleSidebar }) {
  return (
    <div className="topbar">
      <button className="topbar-toggle" onClick={onToggleSidebar} title={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}>
        {sidebarCollapsed ? "☰" : "✕"}
      </button>
      <span className="topbar-entity">{bank || "Select a Bank"}</span>
      {period && period !== "—" && <span className="topbar-period">{period}</span>}
    </div>
  );
}
