export type LegacyHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type LegacyMiddlewareName =
  | "token"
  | "admin"
  | "reports"
  | "projects"
  | "preview"
  | "uploads"
  | "keyImpact"
  | "orders"
  | "benchmark"
  | "employerData"
  | "annualTrend";

export interface LegacyRoute {
  method: LegacyHttpMethod;
  path: string;
  controller: string;
  handler: string;
  middleware?: readonly LegacyMiddlewareName[];
}

const token = ["token"] as const;
const reports = ["token", "reports"] as const;
const admin = ["token", "admin"] as const;
const projects = ["token", "projects"] as const;

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  {
    method: "POST",
    path: "/client/responseDetailReportQuestionResult",
    controller: "reports",
    handler: "responseDetailReportQuestionResult",
    middleware: [...reports],
  },
  {
    method: "GET",
    path: "/client/responseCountByDemographicCategory",
    controller: "reports",
    handler: "responseCountByDemographicCategory",
    middleware: [...reports],
  },
  {
    method: "GET",
    path: "/client/getCustomReport",
    controller: "reports",
    handler: "getCustomReport",
    middleware: [...reports],
  },
  {
    method: "GET",
    path: "/client/employerBenchmarkReportExcel",
    controller: "employer",
    handler: "respondBnBExcel",
    middleware: [...reports, "benchmark", "employerData"],
  },
  {
    method: "GET",
    path: "/client/employerBenchmarkReport",
    controller: "employer",
    handler: "respondBnBJSON",
    middleware: [...reports, "benchmark", "employerData"],
  },
  {
    method: "GET",
    path: "/client/getWinnersList",
    controller: "reports",
    handler: "getWinnersList",
    middleware: [...reports],
  },
  {
    method: "GET",
    path: "/client/getAllUsername",
    controller: "reports",
    handler: "getAllUsername",
    middleware: [...admin],
  },
  {
    method: "GET",
    path: "/client/deletOrganizationDataToReSync",
    controller: "reports",
    handler: "deletOrganizationDataToReSync",
    middleware: [...admin],
  },
  {
    method: "GET",
    path: "/client/replaceValues",
    controller: "reports",
    handler: "replaceValues",
    middleware: [...admin],
  },
  {
    method: "GET",
    path: "/client/getKeyImpactAnalysis",
    controller: "reports",
    handler: "getKeyImpactAnalysis",
    middleware: [...reports],
  },
  {
    method: "GET",
    path: "/client/surveyResponseRateAnuualTrend",
    controller: "reports",
    handler: "surveyResponseRateAnuualTrend",
    middleware: [...reports, "annualTrend"],
  },
  {
    method: "GET",
    path: "/client/employeeAnnualTrendsCategory",
    controller: "reports",
    handler: "employeeAnnualTrendsCategory",
    middleware: [...reports, "annualTrend"],
  },
  {
    method: "POST",
    path: "/client/employeeAnnualTrendsDetail",
    controller: "reports",
    handler: "employeeAnnualTrendsDetail",
    middleware: [...reports, "annualTrend"],
  },
  {
    method: "POST",
    path: "/client/annualTrensReportDownload",
    controller: "reports",
    handler: "downloadAnnualTrendReport",
    middleware: [...reports, "annualTrend"],
  },

  {
    method: "GET",
    path: "/admin/getroles",
    controller: "management",
    handler: "getRoles",
    middleware: [...admin],
  },
  {
    method: "GET",
    path: "/admin/getprojects",
    controller: "management",
    handler: "getprojects",
    middleware: [...projects],
  },
  {
    method: "GET",
    path: "/admin/getprojects/:id",
    controller: "management",
    handler: "getprojects",
    middleware: [...projects],
  },
  {
    method: "GET",
    path: "/admin/getProgramsByProjectId",
    controller: "management",
    handler: "getprograms",
    middleware: [...projects],
  },
  {
    method: "GET",
    path: "/admin/getProgramById/:programId",
    controller: "management",
    handler: "getProgramById",
    middleware: [...projects],
  },
  {
    method: "GET",
    path: "/admin/getpermissions/:roleId",
    controller: "management",
    handler: "getPermissions",
    middleware: [...projects],
  },
  {
    method: "POST",
    path: "/admin/addrole",
    controller: "management",
    handler: "addOrUpdateRole",
    middleware: [...admin],
  },
  {
    method: "PUT",
    path: "/admin/updaterole",
    controller: "management",
    handler: "addOrUpdateRole",
    middleware: [...admin],
  },
  {
    method: "POST",
    path: "/admin/managerole",
    controller: "management",
    handler: "manageRole",
    middleware: [...admin],
  },
  {
    method: "PUT",
    path: "/admin/managerole",
    controller: "management",
    handler: "manageRole",
    middleware: [...admin],
  },
  {
    method: "DELETE",
    path: "/admin/deleterole",
    controller: "management",
    handler: "deleteRole",
    middleware: [...admin],
  },
  {
    method: "POST",
    path: "/admin/uploadCustomReport",
    controller: "management",
    handler: "uploadCustomReport",
    middleware: ["token", "uploads"],
  },
  {
    method: "POST",
    path: "/admin/uploadKeyImpactAnalysis",
    controller: "management",
    handler: "uploadKeyImpactAnalysis",
    middleware: ["token", "keyImpact"],
  },
  {
    method: "DELETE",
    path: "/admin/keyImpactAnalysis/:id",
    controller: "management",
    handler: "deleteKeyImpactAnalysis",
    middleware: ["token", "keyImpact"],
  },
  {
    method: "DELETE",
    path: "/admin/customReport/:id",
    controller: "management",
    handler: "deleteCustomReport",
    middleware: ["token", "uploads"],
  },
  {
    method: "GET",
    path: "/admin/getOrganizations",
    controller: "management",
    handler: "getOrganizations",
    middleware: ["token", "preview"],
  },
  {
    method: "GET",
    path: "/admin/getOrganizations/:id",
    controller: "management",
    handler: "getOrganizations",
    middleware: ["token", "preview"],
  },
  {
    method: "GET",
    path: "/admin/order/log",
    controller: "management",
    handler: "orderLogs",
    middleware: ["token", "orders"],
  },
  {
    method: "GET",
    path: "/admin/system/log",
    controller: "management",
    handler: "readLogs",
    middleware: [...admin],
  },
  {
    method: "GET",
    path: "/admin/loginSession/log",
    controller: "management",
    handler: "getLoginSessions",
    middleware: [...admin],
  },
  {
    method: "POST",
    path: "/admin/resortOrg",
    controller: "webhook",
    handler: "resortOrg",
    middleware: ["token", "orders"],
  },

  {
    method: "GET",
    path: "/dashboard/surveyinformation",
    controller: "dashboard",
    handler: "surveyInformation",
    middleware: [...admin],
  },
  {
    method: "POST",
    path: "/payment/stripePaymentIntent",
    controller: "ecom",
    handler: "stripePaymentIntent",
    middleware: token,
  },
  {
    method: "POST",
    path: "/payment/checkout",
    controller: "ecom",
    handler: "checkout",
    middleware: [...reports],
  },
  {
    method: "GET",
    path: "/zoho/syncProjects",
    controller: "zoho",
    handler: "syncProjects",
    middleware: [...projects],
  },
  {
    method: "GET",
    path: "/zoho/syncPrograms",
    controller: "zoho",
    handler: "syncPrograms",
    middleware: [...projects],
  },
  {
    method: "GET",
    path: "/zoho/syncOrganizations",
    controller: "zoho",
    handler: "syncOrganizations",
    middleware: [...projects],
  },
  {
    method: "GET",
    path: "/zoho/syncClients",
    controller: "zoho",
    handler: "syncClients",
    middleware: [...projects],
  },

  { method: "GET", path: "/webhook/", controller: "inline", handler: "ok" },
  {
    method: "POST",
    path: "/webhook/surveycreated",
    controller: "webhook",
    handler: "surveyCreated",
  },
  {
    method: "POST",
    path: "/webhook/submittedPage",
    controller: "webhook",
    handler: "pageSubmitted",
  },
  {
    method: "POST",
    path: "/webhook/pageSubmitted",
    controller: "webhook",
    handler: "pageSubmitted",
  },
  {
    method: "POST",
    path: "/webhook/pageComplete",
    controller: "webhook",
    handler: "pageComplete",
  },
  {
    method: "POST",
    path: "/webhook/syncSurveys",
    controller: "schedule",
    handler: "syncSurveys",
  },
  {
    method: "POST",
    path: "/webhook/syncContacts",
    controller: "schedule",
    handler: "syncContacts",
  },
  {
    method: "POST",
    path: "/webhook/dealsWebhook",
    controller: "webhook",
    handler: "dealCreated",
  },
  {
    method: "POST",
    path: "/webhook/sendCrmEmails",
    controller: "webhook",
    handler: "sendCrmEmails",
  },
  {
    method: "PUT",
    path: "/webhook/dealUpdate",
    controller: "webhook",
    handler: "dealUpdated",
  },
  {
    method: "POST",
    path: "/webhook/dealUpdate",
    controller: "webhook",
    handler: "dealUpdated",
  },
  {
    method: "POST",
    path: "/webhook/reSyncDataWithCrm",
    controller: "webhook",
    handler: "reSyncDataWithCrm",
    middleware: projects,
  },
  {
    method: "POST",
    path: "/webhook/v2/reSyncDataWithCrm",
    controller: "webhook",
    handler: "reSyncDataWithCrmV2",
    middleware: projects,
  },
  {
    method: "POST",
    path: "/webhook/syncAllRespondents",
    controller: "webhook",
    handler: "syncAllRespondents",
  },
  {
    method: "DELETE",
    path: "/webhook/deleteDealWithData",
    controller: "webhook",
    handler: "deleteDealWithData",
  },
  {
    method: "DELETE",
    path: "/webhook/syncDealsWithCrm",
    controller: "webhook",
    handler: "syncDealsWithCrm",
  },
  {
    method: "POST",
    path: "/webhook/dealCreatedAll",
    controller: "webhook",
    handler: "dealCreatedAll",
  },
  {
    method: "POST",
    path: "/webhook/syncProgram",
    controller: "webhook",
    handler: "syncProgram",
  },
  {
    method: "POST",
    path: "/webhook/syncProject",
    controller: "webhook",
    handler: "syncProject",
  },
  {
    method: "POST",
    path: "/webhook/syncOrg",
    controller: "webhook",
    handler: "syncOrg",
  },
  {
    method: "GET",
    path: "/webhook/getDealsCount",
    controller: "webhook",
    handler: "getDealsCount",
  },
  {
    method: "POST",
    path: "/webhook/sendEmailToAllUsers",
    controller: "webhook",
    handler: "sendEmailToAllUsers",
  },
  {
    method: "POST",
    path: "/webhook/rankingAnalysisTrigger",
    controller: "webhook",
    handler: "rankingAnalysisTrigger",
  },
  {
    method: "POST",
    path: "/webhook/createProduct",
    controller: "webhook",
    handler: "createProduct",
  },
  {
    method: "POST",
    path: "/webhook/stripe/payment",
    controller: "webhook",
    handler: "stripePaymentWebhook",
  },
  {
    method: "POST",
    path: "/webhook/massResync",
    controller: "webhook",
    handler: "massResyncV2",
  },
  {
    method: "POST",
    path: "/webhook/massResyncByProgram",
    controller: "webhook",
    handler: "massResyncByProgramV2",
    middleware: projects,
  },
  {
    method: "POST",
    path: "/webhook/syncCheckmarketDataWithids",
    controller: "webhook",
    handler: "syncCheckmarketDataWithids",
  },
  {
    method: "POST",
    path: "/webhook/responseRateStage",
    controller: "webhook",
    handler: "responseRate",
  },
];

export function findLegacyRoute(
  method: string,
  pathname: string,
): LegacyRoute | undefined {
  const normalized =
    pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return LEGACY_ROUTES.find((route) => {
    if (route.method !== method.toUpperCase()) return false;
    const routeParts = route.path.replace(/\/$/, "").split("/").filter(Boolean);
    const pathParts = normalized.split("/").filter(Boolean);
    if (routeParts.length !== pathParts.length) return false;
    return routeParts.every(
      (part, index) => part.startsWith(":") || part === pathParts[index],
    );
  });
}
