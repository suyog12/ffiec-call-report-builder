const BASE_URL = "http://127.0.0.1:8000";

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

/**
 * Fetch the full field catalog (all sections + all rows).
 * Used exclusively by the Custom Report builder.
 *
 * Returns:
 *   { available_sections, sections: { RC: [...], RI: [...] }, total_fields }
 */
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
