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

  // ── Periods ──────────────────────────────────────────────────
  const [periods, setPeriods] = useState([]);
  const [periodsLoading, setPeriodsLoading] = useState(true);
  const [selectedPeriods, setSelectedPeriods] = useState([]);

  useEffect(() => {
    fetchPeriods()
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setPeriods(list);
        if (list.length > 0) setSelectedPeriods([list[0]]);
      })
      .catch(console.error)
      .finally(() => setPeriodsLoading(false));
  }, []);

  const handleTogglePeriod = p =>
    setSelectedPeriods(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  // ── Banks ────────────────────────────────────────────────────
  const [banks, setBanks] = useState([]);
  const [bankQuery, setBankQuery] = useState("");
  const [selectedBanks, setSelectedBanks] = useState([]);
  const primaryPeriod = selectedPeriods[0] || "";

  useEffect(() => {
    if (!primaryPeriod) return;
    fetchBanks(primaryPeriod)
      .then(data => setBanks(Array.isArray(data) ? data : []))
      .catch(() => setBanks([]));
  }, [primaryPeriod]);

  const handleToggleBank = id =>
    setSelectedBanks(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const banksById = useMemo(() => {
    const m = {};
    banks.forEach(b => { m[b.ID_RSSD] = b; });
    return m;
  }, [banks]);

  // ── Reports ──────────────────────────────────────────────────
  const [reportsByKey, setReportsByKey] = useState({});
  const [loadingReport, setLoadingReport] = useState(false);

  const handleLoadReport = async () => {
    if (selectedBanks.length === 0 || selectedPeriods.length === 0) return;
    setLoadingReport(true);
    const results = {};
    const combos = selectedBanks.flatMap(rssdId => selectedPeriods.map(period => ({ rssdId, period })));

    await Promise.all(combos.map(async ({ rssdId, period }) => {
      const key = String(rssdId) + "::" + period;
      try {
        const [m, s, sd] = await Promise.all([
          fetchMetrics(rssdId, period),
          fetchAvailableSections(rssdId, period),
          fetchSectionData(rssdId, period, ["RC", "RI"]),
        ]);
        results[key] = {
          rssdId, period,
          bankName: banksById[rssdId]?.Name || String(rssdId),
          metrics: m.metrics,
          availableSections: s.available_sections,
          sectionsData: sd.sections,
          pdfUrl: getPdfUrl(rssdId, period),
        };
      } catch (e) {
        results[key] = { rssdId, period, error: e.message };
      }
    }));

    setReportsByKey(results);
    setLoadingReport(false);
  };

  const loadedReports = Object.values(reportsByKey).filter(r => !r.error);
  const isMulti = loadedReports.length > 1;

  // ── Header labels ────────────────────────────────────────────
  const headerBank = selectedBanks.length === 0 ? "No bank selected"
    : selectedBanks.length === 1 ? (banksById[selectedBanks[0]]?.Name || "")
    : selectedBanks.length + " banks selected";

  const headerPeriod = selectedPeriods.length === 0 ? "—"
    : selectedPeriods.length === 1 ? selectedPeriods[0]
    : selectedPeriods.length + " periods";

  // ── Render ───────────────────────────────────────────────────
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
        <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
          <p style={{ fontSize: 14 }}>Select a bank and period, then click <strong>Load Report</strong>.</p>
        </div>
      );
    }

    return loadedReports.map(r => {
      const key = String(r.rssdId) + "::" + r.period;
      return (
        <div key={key} style={{ marginBottom: isMulti ? 36 : 0 }}>
          <ReportGroupHeader report={r} show={isMulti} />
          {activeTab === "Overview" && <Overview metrics={r.metrics || {}} bank={r.bankName} period={r.period} />}
          {activeTab === "PDF" && <PDFPage pdfUrl={r.pdfUrl} />}
          {activeTab === "Sections" && <Sections selectedSectionsData={r.sectionsData || {}} />}
          {activeTab === "Metrics" && <Metrics metrics={r.metrics || {}} />}
        </div>
      );
    });
  };

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
        periods={periods}
        periodsLoading={periodsLoading}
        selectedPeriods={selectedPeriods}
        onTogglePeriod={handleTogglePeriod}
        banks={banks}
        selectedBanks={selectedBanks}
        onToggleBank={handleToggleBank}
        bankQuery={bankQuery}
        setBankQuery={setBankQuery}
        onLoad={handleLoadReport}
        loading={loadingReport}
      />

      <div className="main-content">
        <Header
          bank={headerBank}
          period={headerPeriod}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed(c => !c)}
        />
        <Tabs active={activeTab} setActive={setActiveTab} />
        <main className="page-content">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}
