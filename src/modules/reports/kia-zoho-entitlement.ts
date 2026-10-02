import type { Prisma } from "@prisma/client";
import { jsonObject } from "./report-catalog.js";
import { sortedVerbatimsEntitlementData } from "./sorted-verbatims-entitlement.js";

const paidRdPaymentTypes = new Set([
  "paid via credit card",
  "paid via ach",
  "paid via check",
]);

export function rdPaymentType(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isPaidRdPaymentType(value: unknown): boolean {
  return paidRdPaymentTypes.has(rdPaymentType(value)?.toLowerCase() ?? "");
}

export function kiaZohoEntitlementData(
  value: unknown,
  current: { reportAccess: unknown; metrics: unknown },
): {
  rdPaymentType: string | null;
  reportAccess: Prisma.InputJsonValue;
  metrics: Prisma.InputJsonValue;
} {
  const paymentType = rdPaymentType(value);
  const reportAccess = { ...jsonObject(current.reportAccess) };
  const metrics = { ...jsonObject(current.metrics) };

  if (isPaidRdPaymentType(paymentType)) {
    reportAccess.KIA_Access = "yes";
    if (
      typeof metrics.KIA_Order_Status !== "string" ||
      !metrics.KIA_Order_Status.trim()
    ) {
      metrics.KIA_Order_Status = "Processing";
    }
  }

  return {
    rdPaymentType: paymentType,
    reportAccess: reportAccess as Prisma.InputJsonValue,
    metrics: metrics as Prisma.InputJsonValue,
  };
}

export function zohoPurchaseEntitlementData(
  purchasedSortingFilter: unknown,
  paymentType: unknown,
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
  const kia = kiaZohoEntitlementData(paymentType, {
    reportAccess: sorting.reportAccess,
    metrics: sorting.metrics,
  });
  return {
    ...sorting,
    ...kia,
    paymentDetails: sorting.paymentDetails,
  };
}
