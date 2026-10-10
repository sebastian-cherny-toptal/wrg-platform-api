import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Supply the real large EFS fixture explicitly; it contains private survey data
// and must not be checked into the repository.
const workbookPath = process.env.EFS_LARGE_WORKBOOK;
test(
  "repeated large EFS passes fit in a 256 MB heap",
  { skip: !workbookPath },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=256",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
    import { readXlsxSurveyDefinition, forEachXlsxSurveyRow } from './src/modules/imports/xlsx-survey-importer.ts';
    const counts = [];
    let peakHeap = 0;
    for (let pass = 0; pass < 3; pass++) {
      const definition = await readXlsxSurveyDefinition({ fileName: 'efs.xlsx', filePath: process.env.EFS_LARGE_WORKBOOK, questionId: label => label });
      let respondents = 0, responses = 0;
      await forEachXlsxSurveyRow(definition, {}, row => {
        respondents++; responses += row.responses.length;
        if (respondents % 500 === 0) peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
      });
      counts.push({ respondents, responses });
    }
    console.log(JSON.stringify({ counts, peakHeap }));
  `,
      ],
      { encoding: "utf8", timeout: 180_000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout) as {
      counts: Array<{ respondents: number; responses: number }>;
      peakHeap: number;
    };
    assert.equal(output.counts.length, 3);
    assert.ok((output.counts[0]?.respondents ?? 0) > 0);
    assert.ok((output.counts[0]?.responses ?? 0) > 0);
    assert.deepEqual(output.counts[0], output.counts[1]);
    assert.deepEqual(output.counts[0], output.counts[2]);
    assert.ok(output.peakHeap < 256 * 1024 * 1024);
  },
);
