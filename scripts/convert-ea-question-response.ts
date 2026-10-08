import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  convertEaQuestionResponseBuffer,
  type EaQuestionResponseConversion,
} from "../src/modules/imports/ea-question-response-converter.js";
import { surveyDefinitionWorkbook } from "../src/modules/imports/program-survey-definition.service.js";
import { loadDefaultBenefitsBestPracticesDefinition } from "../src/modules/reports/benefits-best-practices-from-ea.js";

function usage(): never {
  throw new Error(
    "Usage: npm run convert:ea-question-response -- <input.xlsx> <output.xlsx> [report.json]",
  );
}

function report(
  input: string,
  output: string,
  result: EaQuestionResponseConversion,
) {
  return {
    input: basename(input),
    output: basename(output),
    sourceQuestionCount: result.sourceQuestionCount,
    convertedQuestionCount: result.supportedQuestionCount,
    convertedAnswerCount: result.answerCount,
    importableByCurrentEaDefinitionValidator: result.importable,
    blockingIssues: result.issues.filter(
      ({ code }) => code !== "unsupported-question",
    ),
    omittedUnsupportedQuestions: result.issues.filter(
      ({ code }) => code === "unsupported-question",
    ),
  };
}

const [inputArgument, outputArgument, reportArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) usage();
if (!inputArgument.toLowerCase().endsWith(".xlsx")) usage();
if (!outputArgument.toLowerCase().endsWith(".xlsx")) usage();

const input = resolve(inputArgument);
const output = resolve(outputArgument);
const result = await convertEaQuestionResponseBuffer(
  await readFile(input),
  await loadDefaultBenefitsBestPracticesDefinition(),
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, await surveyDefinitionWorkbook(result.definition));

const summary = report(input, output, result);
if (reportArgument) {
  const reportPath = resolve(reportArgument);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (!result.importable) process.exitCode = 2;
