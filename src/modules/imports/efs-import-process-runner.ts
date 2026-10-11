import { PrismaService } from "../../database/prisma.service.js";
import { HistoricalImportService } from "./historical-import.service.js";
import { ProgramEfsWorker } from "./program-efs-jobs.js";

// If the queue owner dies, its child must stop too. A recovered queue job can
// then clean up its private staging survey and restart without overlapping it.
const stopWithOwner = () => process.exit(1);
process.once("disconnect", stopWithOwner);
const prisma = new PrismaService();
try {
  const jobId = process.argv[2];
  if (!jobId) throw new Error("An EFS save job ID is required");
  await prisma.$connect();
  const worker = new ProgramEfsWorker(
    prisma,
    new HistoricalImportService(prisma),
  );
  await worker.runImport(jobId);
  process.send?.({ saved: true });
} catch (error) {
  process.send?.({
    error: error instanceof Error ? error.message : "EFS import failed",
  });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  process.removeListener("disconnect", stopWithOwner);
  if (process.connected) process.disconnect();
}
