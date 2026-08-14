import { spawnSync } from "node:child_process";

const repository = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});

if (repository.status !== 0 || !repository.stdout.trim()) {
  process.exit(0);
}

const configured = spawnSync(
  "git",
  ["config", "core.hooksPath", ".githooks"],
  { cwd: repository.stdout.trim(), stdio: "inherit" },
);

if (configured.error) throw configured.error;
if (configured.status !== 0) {
  throw new Error("Could not configure the repository Git hooks path.");
}
