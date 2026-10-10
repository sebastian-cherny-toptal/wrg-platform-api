const nativeCompatibilityPrefixes = [
  "user",
  "client",
  "admin",
  "dashboard",
  "payment",
  "zoho",
  "webhook",
];
export const nativeCompatibilityRoutes = nativeCompatibilityPrefixes.flatMap(
  (prefix) => [
    prefix,
    `${prefix}/:one`,
    `${prefix}/:one/:two`,
    `${prefix}/:one/:two/:three`,
    `${prefix}/:one/:two/:three/:four`,
    `${prefix}/:one/:two/:three/:four/:five`,
  ],
);
