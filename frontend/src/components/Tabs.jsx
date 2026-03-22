const TAB_ICONS = {
  Overview: "◈",
  PDF: "⎙",
  Sections: "≡",
  Metrics: "◎",
  Custom: "⊞",
};

export default function Tabs({ active, setActive }) {
  const tabs = ["Overview", "PDF", "Sections", "Metrics", "Custom"];
  return (
    <nav className="tab-nav">
      {tabs.map(tab => (
        <button key={tab} className={"tab-btn" + (active === tab ? " active" : "")} onClick={() => setActive(tab)}>
          <span style={{ fontSize: 12 }}>{TAB_ICONS[tab]}</span>
          {tab}
        </button>
      ))}
    </nav>
  );
}
