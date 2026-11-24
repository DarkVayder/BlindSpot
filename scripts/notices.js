import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Every third-party package esbuild bundled into a file, with its license text, so bundled
// code keeps the notices its licenses require.
export function thirdPartyNotices(metafile, root, bundle) {
  const packages = new Map();
  for (const input of Object.keys(metafile.inputs)) {
    const file = input.replaceAll("\\", "/");
    const at = file.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const [scope = "", rest = ""] = file.slice(at + "node_modules/".length).split("/");
    const pkgName = scope.startsWith("@") ? `${scope}/${rest}` : scope;
    packages.set(pkgName, path.resolve(root, file.slice(0, at + "node_modules/".length + pkgName.length)));
  }
  const sections = [...packages.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([pkgName, dir]) => {
      const meta = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license"].find((f) =>
        existsSync(path.join(dir, f)),
      );
      if (!licenseFile) throw new Error(`${pkgName} has no license file to include.`);
      const text = readFileSync(path.join(dir, licenseFile), "utf8").replaceAll("\r\n", "\n").trim();
      return `## ${pkgName} ${meta.version} (${meta.license})\n\n\`\`\`\n${text}\n\`\`\`\n`;
    });
  return `# Third-party notices\n\nThis package bundles the following software into \`${bundle}\`.\n\n${sections.join("\n")}`;
}
