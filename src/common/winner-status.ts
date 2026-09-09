export type WinnerStatus = "Y" | "N";

export function winnerStatusFromExternalValue(
  value: unknown,
): WinnerStatus | null {
  if (value === true) return "Y";
  if (value === false) return "N";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(normalized)) return "Y";
  if (["n", "no", "false", "0"].includes(normalized)) return "N";
  return null;
}
