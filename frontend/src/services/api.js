const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function fetchPeriods() {
  const response = await fetch(`${BASE_URL}/periods/`);
  if (!response.ok) throw new Error("Failed to fetch periods");
  return response.json();
}

export async function fetchBanks(reportingPeriod) {
  const response = await fetch(
    `${BASE_URL}/banks/?reporting_period=${encodeURIComponent(reportingPeriod)}`
  );
  if (!response.ok) throw new Error("Failed to fetch banks");
  return response.json();
}

export async function fetchSDF(rssdId, reportingPeriod) {
  const response = await fetch(
    `${BASE_URL}/reports/sdf?rssd_id=${rssdId}&reporting_period=${encodeURIComponent(reportingPeriod)}`
  );
  if (!response.ok) throw new Error("Failed to fetch SDF report");
  return response.json();
}

export async function fetchAvailableSections(rssdId, reportingPeriod) {
  const response = await fetch(
    `${BASE_URL}/reports/available-sections?rssd_id=${rssdId}&reporting_period=${encodeURIComponent(reportingPeriod)}`
  );
  if (!response.ok) throw new Error("Failed to fetch available sections");
  return response.json();
}

export async function fetchSectionData(rssdId, reportingPeriod, sections) {
  const params = new URLSearchParams();
  params.append("rssd_id", rssdId);
  params.append("reporting_period", reportingPeriod);
  sections.forEach((s) => params.append("sections", s));
  const response = await fetch(`${BASE_URL}/reports/section-data?${params}`);
  if (!response.ok) throw new Error("Failed to fetch section data");
  return response.json();
}

export async function fetchMetrics(rssdId, reportingPeriod) {
  const response = await fetch(
    `${BASE_URL}/reports/metrics?rssd_id=${rssdId}&reporting_period=${encodeURIComponent(reportingPeriod)}`
  );
  if (!response.ok) throw new Error("Failed to fetch metrics");
  return response.json();
}

export async function fetchAllFields(rssdId, reportingPeriod) {
  const response = await fetch(
    `${BASE_URL}/reports/all-fields?rssd_id=${rssdId}&reporting_period=${encodeURIComponent(reportingPeriod)}`
  );
  if (!response.ok) throw new Error("Failed to fetch all fields");
  return response.json();
}

export function getPdfUrl(rssdId, reportingPeriod) {
  return `${BASE_URL}/reports/pdf?rssd_id=${rssdId}&reporting_period=${encodeURIComponent(reportingPeriod)}`;
}

// ── UBPR endpoints ────────────────────────────────────────────

export async function fetchUBPRQuarters() {
  const response = await fetch(`${BASE_URL}/ubpr/quarters`);
  if (!response.ok) throw new Error("Failed to fetch UBPR quarters");
  return response.json();
}

export async function fetchUBPRRatios(rssdId, quarterDate) {
  const response = await fetch(
    `${BASE_URL}/ubpr/ratios?rssd_id=${rssdId}&quarter_date=${quarterDate}`
  );
  if (!response.ok) throw new Error("Failed to fetch UBPR ratios");
  return response.json();
}

export async function fetchUBPRPeerComparison(rssdId, quarterDate, peerGroup = "all") {
  const response = await fetch(
    `${BASE_URL}/ubpr/peer-comparison?rssd_id=${rssdId}&quarter_date=${quarterDate}&peer_group=${peerGroup}`
  );
  if (!response.ok) throw new Error("Failed to fetch UBPR peer comparison");
  return response.json();
}

export async function fetchUBPRAllFields(rssdId, quarterDate) {
  const response = await fetch(
    `${BASE_URL}/ubpr/all-fields?rssd_id=${rssdId}&quarter_date=${quarterDate}`
  );
  if (!response.ok) throw new Error("Failed to fetch UBPR all fields");
  return response.json();
}

/**
 * Fetch trend data for specific metric codes across a quarter range.
 * Only fetches the exact columns the user selected - fast columnar pushdown.
 *
 * @param {string} rssdId
 * @param {string} fromQuarter - YYYYMMDD
 * @param {string} toQuarter   - YYYYMMDD
 * @param {string[]} codes     - UBPR column codes e.g. ["UBPR7204", "UBPRE013"]
 */
export async function fetchUBPRTrend(rssdId, fromQuarter, toQuarter, codes = []) {
  if (!codes.length) throw new Error("At least one metric code is required");
  const params = new URLSearchParams({
    rssd_id: rssdId,
    from_quarter: fromQuarter,
    to_quarter: toQuarter,
  });
  codes.forEach(c => params.append("codes", c));
  const response = await fetch(`${BASE_URL}/ubpr/trend?${params}`);
  if (!response.ok) throw new Error("Failed to fetch UBPR trend");
  return response.json();
}