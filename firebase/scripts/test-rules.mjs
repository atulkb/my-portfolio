// Runs the Firestore rules tests inside the emulator.
// firebase-tools needs Java 21+, while Android builds use JDK 17. Set FIREBASE_JAVA_HOME to a
// Java 21+ install (e.g. Android Studio's bundled JBR) to use it only for this command; CI sets
// JAVA_HOME to Java 21 directly.
import { spawnSync } from 'node:child_process';
import { delimiter, join } from 'node:path';

const env = { ...process.env };
if (env.FIREBASE_JAVA_HOME) {
  env.JAVA_HOME = env.FIREBASE_JAVA_HOME;
  env.PATH = `${join(env.FIREBASE_JAVA_HOME, 'bin')}${delimiter}${env.PATH ?? ''}`;
}

const result = spawnSync(
  'firebase',
  ['emulators:exec', '--only', 'firestore', '--project', 'demo-portfolio', '"jest --runInBand"'],
  { stdio: 'inherit', env, shell: true },
);
process.exit(result.status ?? 1);
