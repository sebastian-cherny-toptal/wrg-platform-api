const REPORT_CACHE_VERSIONS = {
  CLIENT_REPORTS: "v1",
  WFR: "v1",
  RESPONSE_DETAIL: "v1",
  WBC: "v1",
  BBP: "v1",
  ANNUAL_TRENDS: "v1",
};

function getReportCacheVersion(scope) {
  return REPORT_CACHE_VERSIONS[scope] || REPORT_CACHE_VERSIONS.CLIENT_REPORTS;
}

function getVersionedRedisKey(scope, key) {
  return `${getReportCacheVersion(scope)}:${key}`;
}

function getVersionedStorageKey(scope, key) {
  return `${getReportCacheVersion(scope)}/${key}`;
}

module.exports = {
  REPORT_CACHE_VERSIONS,
  getReportCacheVersion,
  getVersionedRedisKey,
  getVersionedStorageKey,
};
