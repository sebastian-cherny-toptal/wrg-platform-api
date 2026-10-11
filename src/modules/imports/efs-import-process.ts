import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Keep import allocations and garbage collection out of the API/BullMQ loop. */
export async function runEfsImportProcess(
  jobId: string,
  spawn: typeof fork = fork,
): Promise<void> {
  const source = import.meta.url.endsWith(".ts");
  const runner = new URL(
    `./efs-import-process-runner.${source ? "ts" : "js"}`,
    import.meta.url,
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(fileURLToPath(runner), [jobId], {
      execArgv: [
        "--max-old-space-size=512",
        ...(source ? ["--import", "tsx"] : []),
      ],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    let succeeded = false;
    let failure: string | undefined;
    child.on("message", (message: unknown) => {
      if (!message || typeof message !== "object") return;
      if ("saved" in message && message.saved === true) succeeded = true;
      if ("error" in message && typeof message.error === "string")
        failure = message.error;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && succeeded) resolve();
      else
        reject(
          new Error(
            failure ??
              `EFS import process stopped (${signal ?? `exit ${code}`}). It may have exceeded its 512 MB memory limit. The API remains available. Review the file before retrying.`,
          ),
        );
    });
  });
}
