# Baton Rouge regression test fixture

`baton-rouge-test-data.zip` is the sanitized fixture generated from the six
2024–2026 Baton Rouge EA/EFS workbooks. It also contains the six aggregate
published-report workbooks required by the report importer.

Tests read the XLSX files from this archive. Production imports must use a
secure `BR_SEED_SOURCE`; do not replace this committed fixture with the raw
survey exports because those contain confidential row-level data.

SHA-256: `80f167a7e64cbdd677c155b13f0d5578e76bc30bf36db6df9455e3e9399be1ce`
