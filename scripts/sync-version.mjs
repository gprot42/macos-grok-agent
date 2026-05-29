import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const versionPath = join(root, "version.md");
const packageJsonPath = join(root, "package.json");
const cargoTomlPath = join(root, "src-tauri", "Cargo.toml");
const tauriConfPath = join(root, "src-tauri", "tauri.conf.json");

const version = readFileSync(versionPath, "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Invalid version in version.md: "${version}"`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
packageJson.version = version;
writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

const cargoToml = readFileSync(cargoTomlPath, "utf8").replace(
  /^version\s*=\s*".*"$/m,
  `version = "${version}"`
);
writeFileSync(cargoTomlPath, cargoToml);

const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
tauriConf.version = version;
writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);

console.log(`Synced version ${version} from version.md`);