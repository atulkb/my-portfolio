import * as LocalAuthentication from 'expo-local-authentication';

/** Device biometrics behind an interface (LLD §4.2); the only file importing the SDK. */
export type Biometrics = {
  /** True when the device has biometric hardware with a fingerprint or face enrolled. */
  available(): Promise<boolean>;
  /** Shows the system prompt (device PIN allowed as fallback); true when the user passed it. */
  authenticate(reason: string): Promise<boolean>;
};

/** `expo-local-authentication` implementation. */
export const deviceBiometrics: Biometrics = {
  async available() {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  },
  async authenticate(reason) {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return r.success;
  },
};
