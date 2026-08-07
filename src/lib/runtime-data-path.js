import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const appRootDir = path.resolve(moduleDir, "..", "..");

function resolveFromRoot(value, rootDir) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(rootDir, raw);
}

export function resolveRuntimeDataDir({ env = process.env, rootDir = appRootDir } = {}) {
  return resolveFromRoot(env.OMNIFM_RUNTIME_DATA_DIR, rootDir) || rootDir;
}

export function resolveRuntimeDataPath(relativePath, options = {}) {
  const raw = String(relativePath || "").trim();
  if (!raw || path.isAbsolute(raw)) {
    throw new Error("Runtime data path must be a non-empty relative path.");
  }

  const segments = raw.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Runtime data path must not contain traversal segments.");
  }

  return path.join(resolveRuntimeDataDir(options), ...segments);
}
