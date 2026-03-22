import { useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import Tabs from "./components/Tabs";

import Overview from "./pages/Overview";
import PDFPage from "./pages/PDFPage";
import Sections from "./pages/Sections";
import Metrics from "./pages/Metrics";
import CustomReport from "./pages/CustomReport";

import {
  fetchBanks, fetchPeriods, fetchMetrics,
  fetchAvailableSections, fetchSectionData, getPdfUrl,
} from "./services/api";

// ── Startup splash ────────────────────────────────────────────
function Splash({ status }) {
  return (
    <div className="app-splash">
      <div>
        <div className="app-splash-logo">FFIEC</div>
      </div>
      <div className="app-splash-badge">Call Reports</div>
      <div className="app-splash-spinner" />
      <div className="app-splash-status">{status}</div>
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
      background: "rgba(15, 23, 42, 0.65)",
      backdropFilter: "blur(3px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100,
      animation: "fadeIn 0.2s ease",
    }}>
      <div style={{
        background: "#fff",
        borderRadius: 14,
        padding: "32px 40px",
        width: 360,
        boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: "#eff6ff",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <div style={{
              width: 18, height: 18,
              border: "2.5px solid #bfdbfe",
              borderTopColor: "#0ea5e9",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
              Loading Reports
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
              Fetching data from FFIEC API
            </div>
          </div>
        </div>

        {/* Progress bar track */}
        <div>
          <div style={{
            height: 6, background: "#f1f5f9",
            borderRadius: 99, overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              width: pct + "%",
              background: "linear-gradient(90deg, #0ea5e9, #38bdf8)",
              borderRadius: 99,
              transition: "width 0.35s ease",
            }} />
          </div>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 8,
            fontSize: 11,
          }}>
            <span style={{ color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>
              {label}
            </span>
            <span style={{ color: "#0ea5e9", fontWeight: 700, flexShrink: 0 }}>
              {pct}%
            </span>
          </div>
        </div>

        {/* Step indicators */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "#f8fafc",
          borderRadius: 8,
        }}>
          {["Metrics", "Schedules", "Section Data"].map((step, i) => {
            // Each step covers 1/3 of progress per combo
            const stepsPerCombo  = 3;
            const combos         = total / stepsPerCombo;
            const stepThreshold  = Math.round(((i + 1) / stepsPerCombo) * 100);
            const stepDone       = pct >= stepThreshold || (i === 2 && pct === 100);
            const stepActive     = !stepDone && pct >= Math.round((i / stepsPerCombo) * 100);
            return (
              <div key={step} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: stepDone ? "#0ea5e9" : stepActive ? "#e0f2fe" : "#f1f5f9",
                  border: stepActive ? "2px solid #0ea5e9" : "2px solid transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s",
                }}>
                  {stepDone
                    ? <span style={{ fontSize: 10, color: "#fff", fontWeight: 800 }}>✓</span>
                    : stepActive
                    ? <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#0ea5e9" }} />
                    : null
                  }
                </div>
                <span style={{ fontSize: 10, color: stepDone ? "#0ea5e9" : "#94a3b8", fontWeight: stepDone ? 600 : 400 }}>
                  {step}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step count */}
        <div style={{ textAlign: "center", fontSize: 11, color: "#94a3b8" }}>
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

  // ── Render ────────────────────────────────────────────────
  const renderPage = () => {
    if (activeTab === "Custom") {
      return (
        <CustomReport
          selectedBanks={selectedBanks}
          selectedPeriods={selectedPeriods}
          banksById={banksById}
        />
      );
    }

    if (loadedReports.length === 0) {
      return (
        <div style={{ padding: "60px 0", textAlign: "center", color: "#94a3b8" }}>
          <div style={{ fontSize: 32, marginBottom: 12, fontWeight: 300 }}>◈</div>
          <p style={{ fontSize: 14 }}>
            Select a bank and period, then click <strong style={{ color: "#0f172a" }}>Load Report</strong>.
          </p>
        </div>
      );
    }

    if (activeTab === "Overview") {
      return <Overview reports={loadedReports} />;
    }
    if (activeTab === "Metrics") {
      return <Metrics reports={loadedReports} />;
    }

    // Sections receives all reports at once for unified card layout
    if (activeTab === "Sections") {
      return <Sections reports={loadedReports} />;
    }

    // PDF renders per-report
    return loadedReports.map((r) => {
      const key = String(r.rssdId) + "::" + r.period;
      return (
        <div key={key} style={{ marginBottom: isMulti ? 36 : 0 }}>
          <ReportGroupHeader report={r} show={isMulti} />
          {activeTab === "PDF" && <PDFPage pdfUrl={r.pdfUrl} />}
        </div>
      );
    });
  };

  // Show splash until both periods and initial bank list are ready
  if (!appReady) {
    return <Splash status={splashStatus} />;
  }

  return (
    <div className="app-shell app-ready">
      {loadingReport && <LoadingOverlay progress={loadProgress} />}
      <Sidebar
        collapsed={sidebarCollapsed}
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
          bank={headerBank}
          period={headerPeriod}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        />
        <Tabs active={activeTab} setActive={setActiveTab} />
        <main className="page-content">{renderPage()}</main>
      </div>
    </div>
  );
}