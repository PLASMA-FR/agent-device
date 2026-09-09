import { afterEach, describe, expect, test, vi } from 'vitest';
import { AppError } from '@agent-device/kernel/errors';
import type { DeviceInfo } from '@agent-device/kernel/device';
import { createAndroidApplicationTools } from '../platform-runtime-android-application-tools.ts';
import * as androidMechanics from '../platform-runtime-android-mechanics.ts';

const activateAndroidTestIme = vi.hoisted(() => vi.fn());
const restoreAndroidTestIme = vi.hoisted(() => vi.fn());

vi.mock('@agent-device/platform-android/mechanics', () => ({
  activateAndroidTestIme,
  restoreAndroidTestIme,
  inferAndroidPackageAfterOpen: async () => 'com.example.foreground',
  listAndroidAdbSerialsQuick: async () => [],
  restoreOrphanedAndroidTestImeOnDaemonStartup: async () => undefined,
}));

const device: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel 9 Pro XL',
  kind: 'emulator',
  booted: true,
};

const settled = {
  outcome: 'settled' as const,
  helperServiceComponent: 'pkg/.Service',
  helperPackageName: 'pkg',
};

describe('android application tools: optional opened package inference', () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([
    ['a targetless fresh open', undefined, undefined],
    ['a targetless open with an existing identity', undefined, 'com.example.app'],
    ['a deep link with an existing identity', 'example://home', 'com.example.app'],
  ])('%s needs no Android mechanics', async (_name, target, currentAppBundleId) => {
    const load = vi
      .spyOn(androidMechanics, 'loadAndroidMechanics')
      .mockRejectedValue(new Error('Android mechanics unavailable'));

    await expect(
      createAndroidApplicationTools().inferOpenedAppBundleId(device, target, currentAppBundleId),
    ).resolves.toBe(currentAppBundleId);
    expect(load).not.toHaveBeenCalled();
  });

  test('a deep link leaves its package identity unset if Android mechanics cannot load', async () => {
    const load = vi
      .spyOn(androidMechanics, 'loadAndroidMechanics')
      .mockRejectedValue(new Error('Android mechanics unavailable'));

    await expect(
      createAndroidApplicationTools().inferOpenedAppBundleId(device, 'example://home', undefined),
    ).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledOnce();
  });

  test('a deep link adopts the inferred foreground package when mechanics are available', async () => {
    await expect(
      createAndroidApplicationTools().inferOpenedAppBundleId(device, 'example://home', undefined),
    ).resolves.toBe('com.example.foreground');
  });
});

describe('android application tools: test IME activation policy', () => {
  // Test IME is default-on for emulators, so an unobtainable helper must not fail the open.
  test('an unobtainable helper warns and leaves the open successful', async () => {
    activateAndroidTestIme.mockResolvedValueOnce({
      outcome: 'helper-unavailable',
      reason: 'the bundled Android IME helper artifact was not found',
    });

    await expect(
      createAndroidApplicationTools().activateTestIme(device, { stateDir: '/state' }),
    ).resolves.toBeUndefined();
  });

  test('a pre-switch persistence failure keeps the open successful without switching IME', async () => {
    activateAndroidTestIme.mockResolvedValueOnce({
      ...settled,
      activated: false,
      alreadyActive: false,
      persistFailed: true,
    });

    await expect(
      createAndroidApplicationTools().activateTestIme(device, { stateDir: '/state' }),
    ).resolves.toBeUndefined();
  });

  test('an already-active helper without a fresh recovery marker still fails closed', async () => {
    activateAndroidTestIme.mockResolvedValueOnce({
      ...settled,
      activated: false,
      alreadyActive: true,
      persistFailed: true,
    });

    await expect(
      createAndroidApplicationTools().activateTestIme(device, { stateDir: '/state' }),
    ).rejects.toMatchObject({
      code: 'COMMAND_FAILED',
      details: { reason: 'android_test_ime_recovery_fence_failed' },
    });
  });

  // The narrow point of the typed outcome: everything that is not helper acquisition — the startup
  // fence, the recovery lock, any read after the durable records were touched — still propagates,
  // because continuing would leave recovery incomplete or the mutation state unknown.
  test.each([
    ['a startup-recovery fence failure', new AppError('COMMAND_FAILED', 'startup recovery failed')],
    ['a recovery-lock failure', new AppError('COMMAND_FAILED', 'recovery lock was not acquired')],
    ['a post-record transport failure', new Error('adb connection dropped')],
  ])('%s propagates instead of falling back to ordinary text entry', async (_name, error) => {
    activateAndroidTestIme.mockRejectedValueOnce(error);

    await expect(
      createAndroidApplicationTools().activateTestIme(device, { stateDir: '/state' }),
    ).rejects.toBe(error);
  });

  test('a successful activation resolves', async () => {
    activateAndroidTestIme.mockResolvedValueOnce({
      ...settled,
      activated: true,
      alreadyActive: false,
      previousIme: 'com.google.android.inputmethod.latin/.LatinIME',
    });

    await expect(
      createAndroidApplicationTools().activateTestIme(device, { stateDir: '/state' }),
    ).resolves.toBeUndefined();
  });
});
