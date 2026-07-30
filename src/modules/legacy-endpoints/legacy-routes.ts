export type LegacyHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type LegacyMiddlewareName =
  | "token"
  | "admin"
  | "reports"
  | "projects"
  | "preview"
  | "uploads"
  | "keyImpact"
  | "orders";

export interface LegacyRoute {
  method: LegacyHttpMethod;
  path: string;
  controller: string;
  handler: string;
  middleware?: readonly LegacyMiddlewareName[];
}

const projects = ["token", "projects"] as const;

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
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
