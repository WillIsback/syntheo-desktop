import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopVersionPath = "release-version.json";

function validateVersion(version) {
  if (
    typeof version !== "string" ||
    version !== version.trim() ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
  ) {
    throw new Error(
      "The desktop release version must use major.minor.patch, for example 1.4.23.",
    );
  }
  return version;
}

export function readReleaseVersion(root = repositoryRoot) {
  const { version } = JSON.parse(
    readFileSync(join(root, desktopVersionPath), "utf8"),
  );
  return validateVersion(version);
}

export function checkReleaseVersion(expected, root = repositoryRoot) {
  const version = readReleaseVersion(root);
  if (expected !== undefined && expected !== version) {
    throw new Error(
      `Requested version ${expected} does not match the desktop release version ${version}. Run node scripts/release-version.mjs ${expected} and commit the result first.`,
    );
  }
  return version;
}

export function setReleaseVersion(version, root = repositoryRoot) {
  validateVersion(version);
  writeFileSync(
    join(root, desktopVersionPath),
    `${JSON.stringify({ version }, null, 2)}\n`,
  );
}

function parseArgs(args) {
  const check = args.includes("--check");
  const positional = args.filter((arg) => arg !== "--check");
  if (positional.length > 1) {
    throw new Error(
      "Usage: node scripts/release-version.mjs [major.minor.patch | --check [expected-version]]",
    );
  }
  return { check, value: positional[0] };
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    const { check, value } = parseArgs(process.argv.slice(2));
    if (check) {
      const version = checkReleaseVersion(value);
      if (value === undefined) console.log(version);
    } else if (value !== undefined) {
      setReleaseVersion(value);
    } else {
      console.log(readReleaseVersion());
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
