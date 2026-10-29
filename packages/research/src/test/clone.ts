import { execFileSync } from "node:child_process";
import path from "node:path";
import { testEnv, type TestRepo } from "../../../git/src/test/repo.js";

export const DEMO_URL = "https://github.com/example/demo.git";

// A no-checkout clone of a local test repository whose origin claims to be the dataset URL,
// laid out the way `fetch` leaves it in the cache.
export function cachedClone(source: TestRepo, cacheRoot: string, id = "demo", url = DEMO_URL): string {
  const dir = path.join(cacheRoot, id);
  execFileSync("git", ["clone", "-q", "--no-checkout", `file://${source.root.replaceAll("\\", "/")}`, dir], {
    env: testEnv(),
  });
  execFileSync("git", ["remote", "set-url", "origin", url], { cwd: dir, env: testEnv() });
  return dir;
}
