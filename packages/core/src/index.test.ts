import { CORE_VERSION } from './index';

describe('@portfolio/core', () => {
  it('exposes a semver version string (toolchain smoke test)', () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
