import type { Prisma } from "@prisma/client";
import { jsonObject } from "./report-catalog.js";

export const ZOHO_SORTING_FILTER_PURCHASE_SOURCE = "Zoho";

export function purchasedEvSortingFilter(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function sortedVerbatimsEntitlementData(
  value: unknown,
  current: {
    reportAccess: unknown;
    metrics: unknown;
    paymentDetails: unknown;
  },
): {
  purchasedEvSortingFilter: string | null;
  reportAccess: Prisma.InputJsonValue;
  metrics: Prisma.InputJsonValue;
  paymentDetails: Prisma.InputJsonValue;
} {
  const filter = purchasedEvSortingFilter(value);
  const reportAccess = { ...jsonObject(current.reportAccess) };
  const metrics = { ...jsonObject(current.metrics) };
  const paymentDetails = { ...jsonObject(current.paymentDetails) };

  if (filter) {
    reportAccess.SEV_Access = "yes";
    metrics.SEV_Filter = filter;
    paymentDetails.EV_Sorting_Payment_Type =
      ZOHO_SORTING_FILTER_PURCHASE_SOURCE;
  } else if (
    paymentDetails.EV_Sorting_Payment_Type ===
    ZOHO_SORTING_FILTER_PURCHASE_SOURCE
  ) {
    reportAccess.SEV_Access = "no";
    delete metrics.SEV_Filter;
    delete paymentDetails.EV_Sorting_Payment_Type;
  }

  return {
    purchasedEvSortingFilter: filter,
    reportAccess: reportAccess as Prisma.InputJsonValue,
    metrics: metrics as Prisma.InputJsonValue,
    paymentDetails: paymentDetails as Prisma.InputJsonValue,
  };
}
