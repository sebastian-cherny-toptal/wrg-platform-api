export type LegacyHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type LegacyMiddlewareName = "token" | "admin" | "adminOrSelf" | "reports" | "projects" | "preview" | "uploads" | "keyImpact" | "orders" | "benchmark" | "workforceData" | "employerData" | "annualTrend";
export interface LegacyRoute {
    method: LegacyHttpMethod;
    path: string;
    controller: string;
    handler: string;
    middleware?: readonly LegacyMiddlewareName[];
}
export declare const LEGACY_ROUTES: readonly LegacyRoute[];
export declare function findLegacyRoute(method: string, pathname: string): LegacyRoute | undefined;
