/**
 * JSON rendering (RFC 10.2). Deterministic by construction: no timestamp unless asked, ordering
 * decided by the report, integers, NFC, two-space indent and a trailing newline.
 */

/**
 * @param {object} report the object built by `buildReport`
 * @param {{ timestamp?: string }} [options] `generatedAt`, excluded from golden tests by construction
 * @returns {string}
 */
export function renderJson(report, { timestamp } = {}) {
  const document = {
    ...report,
    findings: report.findings.filter((finding) => finding.status !== 'pass'),
  };
  if (timestamp !== undefined) document.generatedAt = timestamp;
  return `${JSON.stringify(document, null, 2)}\n`;
}
