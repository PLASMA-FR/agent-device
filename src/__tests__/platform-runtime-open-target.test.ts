import { expect, test } from 'vitest';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { resolveSessionAppBundleIdForTarget } from '../platform-runtime-open-target.ts';
import { ANDROID_EMULATOR } from './test-utils/device-fixtures.ts';

test('session target planning resolves an Android package without a platform callback', async () => {
  await expect(
    resolveSessionAppBundleIdForTarget(ANDROID_EMULATOR, 'com.example.app', undefined),
  ).resolves.toBe('com.example.app');
});

test('session target planning preserves Android app context across a deep link', async () => {
  await expect(
    resolveSessionAppBundleIdForTarget(ANDROID_EMULATOR, 'myapp://login', 'com.example.app'),
  ).resolves.toBe('com.example.app');
});

test.each([undefined, 'settings'])(
  'session target planning does not retain an Android package for a non-app target: %s',
  async (target) => {
    await expect(
      resolveSessionAppBundleIdForTarget(ANDROID_EMULATOR, target, 'com.example.previous'),
    ).resolves.toBeUndefined();
  },
);

const harmonyDevice: DeviceInfo = {
  platform: 'harmonyos',
  id: '127.0.0.1:5555',
  name: 'HarmonyOS Emulator',
  kind: 'emulator',
  booted: true,
};

test('HarmonyOS adopts an explicit bundle-id target for app-scoped commands', async () => {
  await expect(
    resolveSessionAppBundleIdForTarget(harmonyDevice, 'com.example.application', undefined),
  ).resolves.toBe('com.example.application');
});

test.each(['myapp://login', 'https://example.com', 'Demo App'])(
  'HarmonyOS retains the existing app across non-bundle targets: %s',
  async (openTarget) => {
    await expect(
      resolveSessionAppBundleIdForTarget(harmonyDevice, openTarget, 'com.example.application'),
    ).resolves.toBe('com.example.application');
  },
);
