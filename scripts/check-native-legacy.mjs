import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/modules/legacy-endpoints/legacy-routes.ts", import.meta.url),
  "utf8",
);
const requiredPrefixes = [
  "/user/",
  "/client/",
  "/admin/",
  "/dashboard/",
  "/payment/",
  "/zoho/",
  "/webhook/",
];
const missing = requiredPrefixes.filter((prefix) => !source.includes(`path: \"${prefix}`));
if (missing.length) {
  throw new Error(`Missing native compatibility route prefixes: ${missing.join(", ")}`);
}
const routeCount = (source.match(/\{ method:/g) ?? []).length;
if (routeCount < 100) {
  throw new Error(`Expected at least 100 native compatibility routes, found ${routeCount}`);
}
console.log(`Native compatibility route registry contains ${routeCount} routes.`);
