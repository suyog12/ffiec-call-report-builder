import { useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import Tabs from "./components/Tabs";

import Overview from "./pages/Overview";
import PDFPage from "./pages/PDFPage";
import Sections from "./pages/Sections";
import Metrics from "./pages/Metrics";
import CustomReport from "./pages/CustomReport";
import UBPRDashboard from "./pages/UBPRDashboard";

import {
  fetchBanks, fetchPeriods, fetchMetrics,
  fetchAvailableSections, fetchSectionData, getPdfUrl,
} from "./services/api";

// ── W&M bookmark SVG ─────────────────────────────────────────
function WMBookmark({ size = 140, opacity = 1 }) {
  return (
    <svg
      width={size}
      height={size * 1.35}
      viewBox="0 0 100 135"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ opacity, filter: "drop-shadow(0 8px 24px rgba(0,0,0,0.25))" }}
    >
      {/* Bookmark body */}
      <path
        d="M8 0 H92 Q100 0 100 8 V135 L50 105 L0 135 V8 Q0 0 8 0 Z"
        fill="rgba(255,255,255,0.10)"
        stroke="rgba(181,161,106,0.55)"
        strokeWidth="1.5"
      />
      {/* Inner gold border */}
      <path
        d="M14 8 H86 Q92 8 92 14 V120 L50 95 L8 120 V14 Q8 8 14 8 Z"
        fill="none"
        stroke="rgba(181,161,106,0.30)"
        strokeWidth="0.8"
      />
      {/* W&M monogram — W */}
      <text
        x="50" y="52"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="28"
        fontWeight="700"
        fill="#b5a16a"
        letterSpacing="1"
      >W&amp;M</text>
      {/* Divider line */}
      <line x1="28" y1="62" x2="72" y2="62" stroke="rgba(181,161,106,0.45)" strokeWidth="0.8"/>
      {/* EST year */}
      <text
        x="50" y="76"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="9"
        fill="rgba(209,232,223,0.7)"
        letterSpacing="2"
      >EST. 1693</text>
    </svg>
  );
}

// ── Startup splash ────────────────────────────────────────────
function Splash({ status }) {
  return (
    <div className="app-splash">
      <div className="app-splash-inner">

        {/* W&M Bookmark — large, centered, prominent */}
        <div className="app-splash-bookmark-wrap">
          <WMBookmark size={160} opacity={1} />
        </div>

        {/* Brand name */}
        <div className="app-splash-brand-text">
          <div className="app-splash-kicker">William &amp; Mary</div>
          <div className="app-splash-program">MSBA · Team 9 · Class of 2026</div>
        </div>

        {/* Title block */}
        <div className="app-splash-header-block">
          <div className="app-splash-logo">FFIEC</div>
          <div className="app-splash-divider" />
          <div className="app-splash-title">Reports Analysis Dashboard</div>
          <div className="app-splash-subtitle">
            Federal Financial Institutions Examination Council
          </div>
        </div>

        {/* Spinner */}
        <div className="app-splash-spinner-wrap">
          <div className="app-splash-spinner" />
          <div className="app-splash-status">{status}</div>
        </div>

        {/* Footer */}
        <div className="app-splash-footer">
          <div className="app-splash-footer-copy">
            © 2026 FFIEC Reports Analysis Dashboard. All rights reserved. For academic use only.
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Report loading overlay ───────────────────────────────────
function LoadingOverlay({ progress }) {
  const { done, total, label } = progress;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(15, 23, 42, 0.35)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100,
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 10,
        padding: "24px 28px",
        width: 340,
        boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
      }}>
        {/* Title */}
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 14 }}>
          Fetching reports…
        </div>

        {/* File row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>
              FFIEC Call Report data
            </span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>
            {pct}%
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ height: 5, background: "#e5e7eb", borderRadius: 99, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: pct + "%",
            background: "#115740",
            borderRadius: 99,
            transition: "width 0.3s ease",
          }} />
        </div>

        {/* Sub-label */}
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
          {done} of {total} requests complete
        </div>
      </div>
    </div>
  );
}

// ── Report group label (multi-bank/period) ────────────────────
function ReportGroupHeader({ report, show }) {
  if (!show) return null;
  return (
    <div className="report-group-header">
      <span className="bank-name">{report.bankName}</span>
      <span>·</span>
      <span className="period">{report.period}</span>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("Overview");
  const [activeSection, setActiveSection] = useState("call"); // "call" | "ubpr"
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Startup loading state ─────────────────────────────────
  const [splashStatus, setSplashStatus] = useState("Connecting to FFIEC API…");
  const [appReady, setAppReady] = useState(false);

  // ── Periods ──────────────────────────────────────────────
  const [periods, setPeriods] = useState([]);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [selectedPeriods, setSelectedPeriods] = useState([]);

  // ── Banks ─────────────────────────────────────────────────
  const [banks, setBanks] = useState([]);
  const [bankQuery, setBankQuery] = useState("");
  const [selectedBanks, setSelectedBanks] = useState([]);
  const [banksLoading, setBanksLoading] = useState(false);

  // ── Startup sequence: load periods then banks, then show app ─
  useEffect(() => {
    async function startup() {
      try {
        setSplashStatus("Loading reporting periods…");
        const data = await fetchPeriods();
        const list = Array.isArray(data) ? data : [];
        setPeriods(list);
        setPeriodsLoading(false);

        if (list.length > 0) {
          const first = list[0];
          setSelectedPeriods([first]);
          setSplashStatus("Loading bank directory…");
          setBanksLoading(true);
          try {
            const bankData = await fetchBanks(first);
            setBanks(Array.isArray(bankData) ? bankData : []);
          } catch {
            setBanks([]);
          } finally {
            setBanksLoading(false);
          }
        }
      } catch (e) {
        console.error("Startup failed:", e);
        setPeriodsLoading(false);
      }

      setSplashStatus("Ready");
      // Short delay so "Ready" is visible before fade
      await new Promise((r) => setTimeout(r, 300));
      setAppReady(true);
    }

    startup();
  }, []);

  // ── Reload banks when period changes (after startup) ─────
  const primaryPeriod = selectedPeriods[0] || "";
  const [prevPrimaryPeriod, setPrevPrimaryPeriod] = useState("");

  useEffect(() => {
    if (!appReady) return;             // startup handles the first load
    if (!primaryPeriod) return;
    if (primaryPeriod === prevPrimaryPeriod) return;
    setPrevPrimaryPeriod(primaryPeriod);
    setBanksLoading(true);
    fetchBanks(primaryPeriod)
      .then((d) => setBanks(Array.isArray(d) ? d : []))
      .catch(() => setBanks([]))
      .finally(() => setBanksLoading(false));
  }, [primaryPeriod, appReady]);

  const handleTogglePeriod = (p) =>
    setSelectedPeriods((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );

  const handleToggleBank = (id) =>
    setSelectedBanks((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const banksById = useMemo(() => {
    const m = {};
    banks.forEach((b) => { m[b.ID_RSSD] = b; });
    return m;
  }, [banks]);

  // ── Reports ───────────────────────────────────────────────
  const [reportsByKey, setReportsByKey] = useState({});
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ done: 0, total: 0, label: "" });

  const handleLoadReport = async () => {
    if (selectedBanks.length === 0 || selectedPeriods.length === 0) return;

    const combos = selectedBanks.flatMap((rssdId) =>
      selectedPeriods.map((period) => ({ rssdId, period }))
    );
    // 3 API calls per combo: metrics, available-sections, section-data
    const totalSteps = combos.length * 3;
    let doneSteps = 0;

    const tick = (label) => {
      doneSteps += 1;
      setLoadProgress({ done: doneSteps, total: totalSteps, label });
    };

    setLoadingReport(true);
    setLoadProgress({ done: 0, total: totalSteps, label: "Starting…" });
    const results = {};

    await Promise.all(
      combos.map(async ({ rssdId, period }) => {
        const key  = String(rssdId) + "::" + period;
        const name = banksById[rssdId]?.Name || String(rssdId);
        const tag  = name.length > 22 ? name.slice(0, 22) + "…" : name;
        try {
          const m = await fetchMetrics(rssdId, period);
          tick("Metrics — " + tag);

          const s = await fetchAvailableSections(rssdId, period);
          tick("Schedules — " + tag);

          const sd = await fetchSectionData(rssdId, period, ["RC", "RI"]);
          tick("Section data — " + tag);

          results[key] = {
            rssdId, period,
            bankName: name,
            metrics: m.metrics,
            availableSections: s.available_sections,
            sectionsData: sd.sections,
            pdfUrl: getPdfUrl(rssdId, period),
          };
        } catch (e) {
          // Count remaining steps for this combo as done so bar reaches 100%
          const remaining = 3 - (doneSteps % 3 || 3);
          for (let i = 0; i < remaining; i++) tick("Error — " + tag);
          results[key] = { rssdId, period, error: e.message };
        }
      })
    );

    setReportsByKey(results);
    // Brief pause at 100% before hiding
    await new Promise((r) => setTimeout(r, 600));
    setLoadingReport(false);
    setLoadProgress({ done: 0, total: 0, label: "" });
  };

  const loadedReports = Object.values(reportsByKey).filter((r) => !r.error);
  const isMulti = loadedReports.length > 1;

  // ── Header labels ─────────────────────────────────────────
  const headerBank =
    selectedBanks.length === 0
      ? "No bank selected"
      : selectedBanks.length === 1
      ? banksById[selectedBanks[0]]?.Name || ""
      : selectedBanks.length + " banks selected";

  const headerPeriod =
    selectedPeriods.length === 0
      ? "—"
      : selectedPeriods.length === 1
      ? selectedPeriods[0]
      : selectedPeriods.length + " periods";

  // ── Persistent tab rendering ─────────────────────────────
  // All tabs stay mounted (never unmount) — switching just toggles display:none.
  // This preserves all state: PDF loaded, Custom wizard step, Sections expanded, etc.
  const emptyState = (
    <div style={{ padding: "60px 0", textAlign: "center", color: "#94a3b8" }}>
      <div style={{ fontSize: 32, marginBottom: 12, fontWeight: 300 }}>◈</div>
      <p style={{ fontSize: 14 }}>
        Select a bank and period, then click <strong style={{ color: "#1a2e20" }}>Load Report</strong>.
      </p>
    </div>
  );

  const tabContent = (tab) => ({
    display: activeTab === tab ? "block" : "none",
  });

  // Show splash until both periods and initial bank list are ready
  if (!appReady) {
    return <Splash status={splashStatus} />;
  }

  return (
    <div className="app-shell app-ready">
      {loadingReport && <LoadingOverlay progress={loadProgress} />}
      <Sidebar
        collapsed={sidebarCollapsed}
        activeSection={activeSection}
        onSectionChange={(section) => {
          setActiveSection(section);
          if (section === "ubpr") setActiveTab("UBPR");
          else setActiveTab("Overview");
        }}
        periods={periods}
        periodsLoading={false}
        selectedPeriods={selectedPeriods}
        onTogglePeriod={handleTogglePeriod}
        banks={banks}
        selectedBanks={selectedBanks}
        onToggleBank={handleToggleBank}
        bankQuery={bankQuery}
        setBankQuery={setBankQuery}
        onLoad={handleLoadReport}
        loading={loadingReport || banksLoading}
      />

      <div className="main-content">
        <Header
          bank={activeSection === "ubpr" ? "Financial Analysis" : headerBank}
          period={activeSection === "ubpr" ? "" : headerPeriod}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        />

        {/* UBPR mode — full page, no tabs */}
        {activeSection === "ubpr" ? (
          <main className="page-content" style={{ padding: 0 }}>
            <UBPRDashboard />
          </main>
        ) : (
          <>
            <Tabs active={activeTab} setActive={setActiveTab} />
            <main className="page-content">
              {/* Overview */}
              <div style={tabContent("Overview")}>
                {loadedReports.length === 0 ? emptyState : <Overview reports={loadedReports} />}
              </div>

              {/* PDF — always mounted so loaded PDFs don't re-fetch */}
              <div style={tabContent("PDF")}>
                {loadedReports.length === 0 ? emptyState : <PDFPage reports={loadedReports} />}
              </div>

              {/* Sections */}
              <div style={tabContent("Sections")}>
                {loadedReports.length === 0 ? emptyState : <Sections reports={loadedReports} />}
              </div>

              {/* Metrics */}
              <div style={tabContent("Metrics")}>
                {loadedReports.length === 0 ? emptyState : <Metrics reports={loadedReports} />}
              </div>

              {/* Custom — always mounted so wizard state is never lost */}
              <div style={tabContent("Custom")}>
                <CustomReport
                  selectedBanks={selectedBanks}
                  selectedPeriods={selectedPeriods}
                  banksById={banksById}
                />
              </div>
            </main>
          </>
        )}
      </div>
    </div>
  );
}