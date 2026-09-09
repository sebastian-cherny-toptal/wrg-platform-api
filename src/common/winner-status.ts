export type WinnerStatus = "Y" | "N";

export function winnerStatusFromBoolean(
  value: boolean | null | undefined,
): WinnerStatus | null {
  if (value === true) return "Y";
  if (value === false) return "N";
  return null;
}

export function winnerBooleanFromStatus(
  value: WinnerStatus | null | undefined,
): boolean | null {
  if (value === "Y") return true;
  if (value === "N") return false;
  return null;
}

export function winnerBooleanFromExternalValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(normalized)) return true;
  if (["n", "no", "false", "0"].includes(normalized)) return false;
  return null;
}
