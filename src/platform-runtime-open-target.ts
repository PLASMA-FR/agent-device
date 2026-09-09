import { isDeepLinkTarget } from '@agent-device/contracts/command';
import { parseSessionSurface, type SessionSurface } from '@agent-device/contracts/session';
import { isMacOs, isApplePlatform, type DeviceInfo } from '@agent-device/kernel/device';
import { AppError } from '@agent-device/kernel/errors';
import { loadAndroidMechanics } from './platform-runtime-android-mechanics.ts';

let appleApplicationsModule:
  | Promise<typeof import('./platform-runtime-apple-application-tools.ts')>
  | undefined;
const loadAppleApplications = () =>
  (appleApplicationsModule ??= import('./platform-runtime-apple-application-tools.ts'));

let androidApplicationsModule:
  | Promise<typeof import('./platform-runtime-android-application-tools.ts')>
  | undefined;
const loadAndroidApplications = () =>
  (androidApplicationsModule ??= import('./platform-runtime-android-application-tools.ts'));

const LINUX_SUPPORTED_SURFACES = new Set<SessionSurface>(['app', 'desktop', 'frontmost-app']);

/**
 * Open surface policy. Daemon handlers retain response construction and the choice to reuse
 * an existing session surface; application tools own device observations.
 */
export function resolveRequestedOpenSurface(params: {
  device: DeviceInfo;
  surfaceFlag: string | undefined;
  openTarget: string | undefined;
  existingSurface?: SessionSurface;
}): SessionSurface {
  const { device, surfaceFlag, openTarget, existingSurface } = params;
  if (device.platform === 'linux') {
    return resolveLinuxOpenSurface(surfaceFlag, openTarget, existingSurface);
  }
  if (isMacOs(device)) {
    return resolveMacOsOpenSurface(surfaceFlag, openTarget, existingSurface);
  }
  return resolveNonDesktopOpenSurface(surfaceFlag);
}

function resolveLinuxOpenSurface(
  surfaceFlag: string | undefined,
  openTarget: string | undefined,
  existingSurface: SessionSurface | undefined,
): SessionSurface {
  if (!surfaceFlag) return existingSurface ?? 'app';
  const surface = parseSessionSurface(surfaceFlag);
  if (!LINUX_SUPPORTED_SURFACES.has(surface)) {
    throw new AppError(
      'INVALID_ARGS',
      `Linux supports --surface app, desktop, and frontmost-app (got "${surfaceFlag}")`,
    );
  }
  assertOpenSurfaceHasNoTarget(surface, openTarget);
  return surface;
}

function resolveMacOsOpenSurface(
  surfaceFlag: string | undefined,
  openTarget: string | undefined,
  existingSurface: SessionSurface | undefined,
): SessionSurface {
  if (!surfaceFlag) return existingSurface ?? 'app';
  const surface = parseSessionSurface(surfaceFlag);
  if (surface !== 'app' && surface !== 'menubar') {
    assertOpenSurfaceHasNoTarget(surface, openTarget);
  }
  return surface;
}

function resolveNonDesktopOpenSurface(surfaceFlag: string | undefined): SessionSurface {
  if (surfaceFlag) {
    throw new AppError('INVALID_ARGS', 'surface is only supported on macOS and Linux');
  }
  return 'app';
}

function assertOpenSurfaceHasNoTarget(
  surface: SessionSurface,
  openTarget: string | undefined,
): void {
  if (surface !== 'app' && surface !== 'menubar' && openTarget) {
    throw new AppError('INVALID_ARGS', `open --surface ${surface} does not accept an app target`);
  }
}

/** Platform-specific relaunch classification stays alongside target resolution. */
export async function validateOpenRelaunchTarget(params: {
  target: string | undefined;
  platform: string | undefined;
  surface?: SessionSurface;
}): Promise<string | undefined> {
  const { target, platform, surface } = params;
  if (target && isDeepLinkTarget(target)) {
    return 'open --relaunch does not support URL targets.';
  }
  if (surface !== undefined && surface !== 'app') {
    return 'open --relaunch is supported only for app surfaces.';
  }
  if (platform === 'android' && target) {
    const { classifyAndroidAppTarget, formatAndroidInstalledPackageRequiredMessage } =
      await loadAndroidMechanics();
    if (classifyAndroidAppTarget(target) === 'binary') {
      return formatAndroidInstalledPackageRequiredMessage(target);
    }
  }
  return undefined;
}

/** Harmony's local target contract accepts an explicit dotted package without an adb lookup. */
function bundleIdFromOpenTarget(openTarget: string | undefined): string | undefined {
  const trimmed = openTarget?.trim();
  if (!trimmed || isDeepLinkTarget(trimmed) || !trimmed.includes('.')) return undefined;
  return trimmed;
}

export async function resolveSessionAppBundleIdForTarget(
  device: DeviceInfo,
  openTarget: string | undefined,
  currentAppBundleId: string | undefined,
): Promise<string | undefined> {
  if (device.platform === 'harmonyos') {
    return bundleIdFromOpenTarget(openTarget) ?? currentAppBundleId;
  }
  const input = { target: openTarget, currentAppBundleId, surface: 'app' as const };
  if (isApplePlatform(device.platform)) {
    const { createAppleApplicationTools } = await loadAppleApplications();
    return (await createAppleApplicationTools().resolveOpenTarget(device, input)).appBundleId;
  }
  if (device.platform === 'android') {
    const { createAndroidApplicationTools } = await loadAndroidApplications();
    return (await createAndroidApplicationTools().resolveOpenTarget(device, input)).appBundleId;
  }
  return undefined;
}
