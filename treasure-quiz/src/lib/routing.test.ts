import { describe, expect, it } from 'vitest';
import { getAppPath } from './routing';

describe('getAppPath', () => {
  it('selects the host shell for /host', () => {
    expect(getAppPath('/host')).toBe('/host');
  });

  it('selects the player shell for /play', () => {
    expect(getAppPath('/play')).toBe('/play');
  });

  it('defaults unknown paths to the player shell', () => {
    expect(getAppPath('/anything-else')).toBe('/play');
  });
});
