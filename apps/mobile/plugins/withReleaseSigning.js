/**
 * Expo config plugin: signs release builds with the personal upload key (HLD D39, LLD §4.19).
 *
 * The key and its passwords never enter the repo. Gradle reads them from a properties file,
 * by default `D:\learning\keys\my-portfolio-release.properties` (four levels above
 * `apps/mobile/android`), or from the path in `PORTFOLIO_SIGNING_PROPERTIES`:
 *
 *   storeFile=D:/learning/keys/my-portfolio-release.jks
 *   storePassword=…
 *   keyAlias=my-portfolio
 *   keyPassword=…
 *
 * Without that file, release builds fall back to the debug key with a warning, so the
 * project still builds elsewhere. Re-applied on every `expo prebuild`.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @portfolio release-signing';

const SIGNING_CONFIG = `
        ${MARKER}
        if (portfolioSigningFile.exists()) {
            release {
                storeFile file(portfolioSigning['storeFile'])
                storePassword portfolioSigning['storePassword']
                keyAlias portfolioSigning['keyAlias']
                keyPassword portfolioSigning['keyPassword']
            }
        }`;

const LOADER = `${MARKER}
def portfolioSigning = new Properties()
def portfolioSigningFile = new File(System.getenv('PORTFOLIO_SIGNING_PROPERTIES') ?: "\${rootDir}/../../../../keys/my-portfolio-release.properties")
if (portfolioSigningFile.exists()) {
    portfolioSigningFile.withInputStream { portfolioSigning.load(it) }
} else {
    logger.warn("Release signing properties not found at \${portfolioSigningFile}; release builds use the debug key.")
}

`;

/** @param {string} gradle */
function applySigning(gradle) {
  if (gradle.includes(MARKER)) return gradle;
  const out = gradle
    .replace(/^android \{/m, `${LOADER}android {`)
    .replace(/(signingConfigs \{\n\s+debug \{[\s\S]*?\n\s+\})/, `$1${SIGNING_CONFIG}`)
    .replace(
      /(release \{\n(?:\s*\/\/.*\n)*\s*)signingConfig signingConfigs\.debug/,
      '$1signingConfig portfolioSigningFile.exists() ? signingConfigs.release : signingConfigs.debug',
    );
  const applied = (out.match(/portfolioSigning/g) ?? []).length;
  if (applied < 8)
    throw new Error('withReleaseSigning: android/app/build.gradle layout changed; update the plugin.');
  return out;
}

/** @type {import('expo/config-plugins').ConfigPlugin} */
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    c.modResults.contents = applySigning(c.modResults.contents);
    return c;
  });
};

module.exports.applySigning = applySigning;
