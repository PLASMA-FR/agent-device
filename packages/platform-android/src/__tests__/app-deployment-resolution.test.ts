import { expect, test } from 'vitest';
import { resolveAndroidPackageForOpen } from '../app-deployment-resolution.ts';
import { withFakeAdb } from './test-utils/fake-adb.ts';

test.each([
  ['com.example.app', 'com.example.app'],
  ['settings', undefined],
  ['myapp://login', undefined],
  ['https://example.com', undefined],
  [undefined, undefined],
])('open package resolution avoids a device probe for %s', async (target, expected) => {
  await withFakeAdb(
    () => new Error('unexpected device probe'),
    async ({ calls, device }) => {
      expect(await resolveAndroidPackageForOpen(device, target)).toBe(expected);
      expect(calls).toEqual([]);
    },
  );
});

test('open package resolution adopts a unique installed package match', async () => {
  await withFakeAdb(
    () => 'package:com.example.calendar\npackage:com.example.mail',
    async ({ calls, device }) => {
      expect(await resolveAndroidPackageForOpen(device, 'calendar')).toBe('com.example.calendar');
      expect(calls).toEqual([['shell', 'pm', 'list', 'packages']]);
    },
  );
});

test.each([
  ['missing', 'package:com.example.app'],
  ['ambiguous', 'package:com.example.ambiguous.one\npackage:com.example.ambiguous.two'],
  ['unavailable', new Error('device unavailable')],
] as const)('open package resolution leaves %s identity inconclusive', async (target, response) => {
  await withFakeAdb(
    () => response,
    async ({ device }) => {
      expect(await resolveAndroidPackageForOpen(device, target)).toBeUndefined();
    },
  );
});
