import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/modules/legacy-endpoints/legacy-routes.ts", import.meta.url),
  "utf8",
);
const requiredPrefixes = ["/webhook/"];
const missing = requiredPrefixes.filter(
  (prefix) => !source.includes(`path: \"${prefix}`),
);
if (missing.length) {
  throw new Error(
    `Missing native compatibility route prefixes: ${missing.join(", ")}`,
  );
}
const migratedPrefixes = ["/admin/", "/dashboard/", "/payment/", "/zoho/"];
const stale = migratedPrefixes.filter((prefix) =>
  source.includes(`path: "${prefix}`),
);
if (stale.length) {
  throw new Error(
    `Migrated route prefixes remain in the legacy registry: ${stale.join(", ")}`,
  );
}
const routeCount = (source.match(/\bmethod:\s*"/g) ?? []).length;
if (routeCount === 0) {
  throw new Error(
    "Expected at least one remaining native compatibility route.",
  );
}
console.log(
  `Native compatibility route registry contains ${routeCount} routes.`,
);
