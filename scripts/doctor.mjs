// `pnpm run doctor`: checks the local environment and says exactly what to fix.
// Plain JS with no dependencies on purpose: it must run even before `pnpm install`.
import { execFileSync } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";

const REQUIRED_NODE_MAJOR = 22;

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function portInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => resolve(err.code === "EADDRINUSE"));
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen(port, "127.0.0.1");
  });
}

function composeServiceRunning(service) {
  try {
    return run("docker", ["compose", "ps", "--status", "running", "-q", service]) !== "";
  } catch {
    return false;
  }
}

export async function runChecks() {
  const results = [];
  const add = (name, ok, fix) => results.push({ name, ok, fix });

  const major = Number(process.versions.node.split(".")[0]);
  add(
    `Node ${process.versions.node}`,
    major >= REQUIRED_NODE_MAJOR,
    `Install Node ${REQUIRED_NODE_MAJOR} or newer (e.g. \`nvm install ${REQUIRED_NODE_MAJOR}\`).`,
  );

  let dockerCli = true;
  try {
    run("docker", ["--version"]);
  } catch {
    dockerCli = false;
  }
  add("Docker CLI", dockerCli, "Install Docker Desktop: https://docs.docker.com/get-docker/");

  let daemon = false;
  if (dockerCli) {
    try {
      run("docker", ["info", "--format", "{{.ServerVersion}}"]);
      daemon = true;
    } catch {
      daemon = false;
    }
  }
  add(
    "Docker daemon running",
    daemon,
    "Start Docker Desktop and wait until it says it is running.",
  );

  const ports = [
    ["postgres", config.postgres.port, "POSTGRES_PORT"],
    ["dynamodb-local", config.dynamodb.port, "DYNAMODB_PORT"],
  ];
  for (const [service, port, variable] of ports) {
    const busy = await portInUse(port);
    // A busy port is fine when it is our own compose service (re-running setup).
    const ours = busy && daemon && composeServiceRunning(service);
    add(
      `Port ${port} free for ${service}${ours ? " (already running from this project)" : ""}`,
      !busy || ours,
      `Port ${port} is taken by another process. Stop it, or set ${variable} in .env to a free port.`,
    );
  }

  return results;
}

export function report(results) {
  for (const r of results) {
    console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}`);
    if (!r.ok) console.log(`      -> ${r.fix}`);
  }
  return results.every((r) => r.ok);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = report(await runChecks());
  console.log(ok ? "\nAll checks passed." : "\nFix the items marked FAIL and run again.");
  process.exit(ok ? 0 : 1);
}
