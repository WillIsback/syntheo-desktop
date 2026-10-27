import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Libraries that must come from the host rather than the Ubuntu build box:
// Wayland, because host Mesa and WebKitGTK need the matching ABI; PipeWire and
// its SPA modules, because libpipewire loads plugins from a directory baked in
// at build time (Ubuntu's multiarch path does not exist on Fedora), so a bundled
// copy silently fails to capture there. libpulse stays bundled: it only speaks a
// stable socket protocol to the daemon, and it dlopens its own libpulsecommon.
const hostLibraryPatterns = [
  /^libwayland-.*\.so(?:\..*)?$/,
  /^libpipewire-.*\.so(?:\..*)?$/,
  /^libspa-.*\.so(?:\..*)?$/,
];
const gdkBackendDefault = 'export GDK_BACKEND="${GDK_BACKEND:-x11,wayland}"';

function patchGtkHook(source) {
  if (source.includes(gdkBackendDefault)) {
    return source;
  }

  // Keep X11 preferred, but allow Wayland-only sessions and explicit overrides.
  const forcedX11 = /^export GDK_BACKEND=x11(?:[ \t]+#.*)?$/m;
  if (!forcedX11.test(source)) {
    throw new Error("Unrecognized GDK_BACKEND setting in AppImage GTK hook");
  }
  return source.replace(forcedX11, gdkBackendDefault);
}

function resolveBundleRoot(input) {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.split(path.sep).includes("..")
  ) {
    throw new Error("Invalid bundle directory");
  }
  return path.resolve(input);
}

function assertWithinBase(baseDirectory, candidate) {
  const base = path.resolve(baseDirectory);
  const target = path.resolve(candidate);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Path escapes the bundle directory: ${candidate}`);
  }
  return target;
}

async function findSingleBundleEntry(baseDirectory, suffix, isExpectedType) {
  const entries = await readdir(baseDirectory, { withFileTypes: true });
  const matches = entries.filter(
    (entry) => entry.name.endsWith(suffix) && isExpectedType(entry),
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${suffix} in ${baseDirectory}, found ${matches.length}`,
    );
  }

  return assertWithinBase(
    baseDirectory,
    path.join(baseDirectory, matches[0].name),
  );
}

export async function findBundledHostLibraries(
  directory,
  baseDirectory = path.resolve(directory),
) {
  const base = path.resolve(baseDirectory);
  const matches = [];

  async function walk(currentDirectory) {
    assertWithinBase(base, currentDirectory);
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = assertWithinBase(
        base,
        path.join(currentDirectory, entry.name),
      );
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (
        hostLibraryPatterns.some((pattern) => pattern.test(entry.name))
      ) {
        matches.push(entryPath);
      }
    }
  }

  await walk(directory);
  return matches.sort((left, right) => left.localeCompare(right));
}

function defaultPluginPath() {
  const cacheDirectory =
    process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  return path.join(
    cacheDirectory,
    "tauri",
    "linuxdeploy-plugin-appimage.AppImage",
  );
}

function resolveExecutable(command) {
  if (command === "pnpm") return command;
  if (
    typeof command !== "string" ||
    !path.isAbsolute(command) ||
    command.split(path.sep).includes("..")
  ) {
    throw new Error(`Refusing to execute unsafe command: ${command}`);
  }
  return command;
}

function runCommand(command, args, options = {}) {
  const executable = resolveExecutable(command);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
        ),
      );
    });
  });
}

export async function repackLinuxAppImage({
  bundleDirectory,
  arch = process.env.ARCH,
  pluginPath = process.env.TAURI_APPIMAGE_PLUGIN ?? defaultPluginPath(),
  run = runCommand,
}) {
  const baseDirectory = resolveBundleRoot(bundleDirectory);
  const resolvedPlugin = resolveExecutable(pluginPath);
  const appDirectory = await findSingleBundleEntry(
    baseDirectory,
    ".AppDir",
    (entry) => entry.isDirectory(),
  );
  const appImage = await findSingleBundleEntry(
    baseDirectory,
    ".AppImage",
    (entry) => entry.isFile(),
  );
  const hostLibraries = await findBundledHostLibraries(
    path.join(appDirectory, "usr"),
    baseDirectory,
  );
  const gtkHook = assertWithinBase(
    baseDirectory,
    path.join(appDirectory, "apprun-hooks", "linuxdeploy-plugin-gtk.sh"),
  );
  const originalGtkHook = await readFile(gtkHook, "utf8");
  const patchedGtkHook = patchGtkHook(originalGtkHook);
  const updatedGtkHook = originalGtkHook !== patchedGtkHook;

  if (hostLibraries.length === 0 && !updatedGtkHook) {
    console.log(
      `AppImage already uses host Wayland and PipeWire libraries and GTK backends: ${appImage}`,
    );
    return { appDirectory, appImage, removedLibraries: [], updatedGtkHook };
  }

  if (!arch) {
    throw new Error("AppImage architecture is required for repacking");
  }

  try {
    await access(resolvedPlugin, constants.X_OK);
  } catch {
    throw new Error(
      `AppImage output plugin is not executable: ${resolvedPlugin}`,
    );
  }

  if (updatedGtkHook) {
    await writeFile(gtkHook, patchedGtkHook);
  }
  await Promise.all(hostLibraries.map((library) => rm(library)));

  const remainingLibraries = await findBundledHostLibraries(
    path.join(appDirectory, "usr"),
    baseDirectory,
  );
  if (remainingLibraries.length > 0) {
    throw new Error(
      `Failed to remove bundled host libraries: ${remainingLibraries.join(", ")}`,
    );
  }

  console.log(`Removed bundled host libraries:\n${hostLibraries.join("\n")}`);

  await rm(appImage);
  await run(
    resolvedPlugin,
    ["--appimage-extract-and-run", "--appdir", appDirectory],
    {
      env: {
        ...process.env,
        APPIMAGE_EXTRACT_AND_RUN: "1",
        ARCH: arch,
        OUTPUT: appImage,
      },
    },
  );

  const appImageStat = await stat(appImage);
  if (appImageStat.size === 0) {
    throw new Error(`Repacked AppImage is empty: ${appImage}`);
  }

  const signature = `${appImage}.sig`;
  await rm(signature, { force: true });
  await run("pnpm", ["-F", "desktop", "tauri", "signer", "sign", appImage]);

  const signatureStat = await stat(signature);
  if (signatureStat.size === 0) {
    throw new Error(`Regenerated AppImage signature is empty: ${signature}`);
  }

  console.log(`Repacked and re-signed AppImage: ${appImage}`);
  return {
    appDirectory,
    appImage,
    removedLibraries: hostLibraries,
    updatedGtkHook,
  };
}

async function main() {
  const bundleDirectory = process.argv[2];
  if (!bundleDirectory) {
    throw new Error(
      "Usage: node scripts/repack-linux-appimage.mjs <appimage-bundle-directory>",
    );
  }

  await repackLinuxAppImage({
    bundleDirectory: path.resolve(bundleDirectory),
  });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
