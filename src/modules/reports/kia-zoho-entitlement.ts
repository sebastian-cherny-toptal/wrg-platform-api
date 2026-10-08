import type { Prisma } from "@prisma/client";
import { jsonObject } from "./report-catalog.js";
import { sortedVerbatimsEntitlementData } from "./sorted-verbatims-entitlement.js";

const paidReportPaymentTypes = new Set([
  "paid via credit card",
  "paid via ach",
  "paid via check",
]);

export function reportPaymentType(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isPaidReportPaymentType(value: unknown): boolean {
  return paidReportPaymentTypes.has(
    reportPaymentType(value)?.toLowerCase() ?? "",
  );
}

export function reportZohoEntitlementData(
  rdValue: unknown,
  kiaValue: unknown,
  current: { reportAccess: unknown; metrics: unknown },
): {
  rdPaymentType: string | null;
  kiaPaymentType: string | null;
  reportAccess: Prisma.InputJsonValue;
  metrics: Prisma.InputJsonValue;
} {
  const rdPaymentType = reportPaymentType(rdValue);
  const kiaPaymentType = reportPaymentType(kiaValue);
  const reportAccess = { ...jsonObject(current.reportAccess) };
  const metrics = { ...jsonObject(current.metrics) };

  if (isPaidReportPaymentType(rdPaymentType)) {
    reportAccess.RD_Access = "yes";
  }

  if (isPaidReportPaymentType(kiaPaymentType)) {
    reportAccess.KIA_Access = "yes";
    if (
      typeof metrics.KIA_Order_Status !== "string" ||
      !metrics.KIA_Order_Status.trim()
    ) {
      metrics.KIA_Order_Status = "Processing";
    }
  }

  return {
    rdPaymentType,
    kiaPaymentType,
    reportAccess: reportAccess as Prisma.InputJsonValue,
    metrics: metrics as Prisma.InputJsonValue,
  };
}

export function zohoPurchaseEntitlementData(
  purchasedSortingFilter: unknown,
  rdPaymentType: unknown,
  kiaPaymentType: unknown,
  current: {
    reportAccess: unknown;
    metrics: unknown;
    paymentDetails: unknown;
  },
) {
  const sorting = sortedVerbatimsEntitlementData(
    purchasedSortingFilter,
    current,
  );
  const reports = reportZohoEntitlementData(rdPaymentType, kiaPaymentType, {
    reportAccess: sorting.reportAccess,
    metrics: sorting.metrics,
  });
  return {
    ...sorting,
    ...reports,
    paymentDetails: sorting.paymentDetails,
  };
}
