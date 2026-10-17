/** Signed-in user, mapped from the Firebase user at the service boundary (LLD §3.7). */
export type AuthUser = {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly emailVerified: boolean;
  readonly provider: 'google' | 'password';
};

/** Unsubscribe function returned by listeners. */
export type Unsubscribe = () => void;

/** Authentication operations used by the app (LLD §3.7). All failures throw `AppError`. */
export interface AuthService {
  onAuthStateChanged(cb: (user: AuthUser | null) => void): Unsubscribe;
  signInWithGoogle(): Promise<AuthUser>;
  /** Creates the account, sets the display name and sends the verification email. */
  signUpWithEmail(name: string, email: string, password: string): Promise<AuthUser>;
  signInWithEmail(email: string, password: string): Promise<AuthUser>;
  sendVerificationEmail(): Promise<void>;
  /** Reloads the current user ("I've verified"). */
  reloadUser(): Promise<AuthUser | null>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Confirms the current user before a sensitive action (account deletion): Google accounts sign
   * in with Google again, email accounts give their password.
   */
  reauthenticate(password: string | null): Promise<void>;
  /** Deletes the signed-in Firebase Auth user (needs a recent sign-in). */
  deleteUser(): Promise<void>;
}
