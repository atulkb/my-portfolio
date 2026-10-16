import { z } from 'zod';
import { CurrencySchema, InstrumentKeySchema, PlatformSchema } from './primitives';

/** Default portfolio sort options (S09 "Sort holdings by default"). */
export const DefaultSortSchema = z.enum(['VALUE_DESC', 'PNL_PCT_DESC', 'NAME_ASC']);

/** Per-user settings synced across devices (LLD §1.4). Device-local settings live in MMKV. */
export const UserSettingsSchema = z.object({
  /** Currency of the portfolio summary only; holdings always show their own currency (HLD D25). */
  summaryCurrency: CurrencySchema.default('INR'),
  defaultSort: DefaultSortSchema.default('VALUE_DESC'),
  /** User toggle; the effective value also requires the build flag `FEATURES.aiSuggestions` (D29). */
  aiSuggestions: z.boolean().default(true),
});
/** Synced user settings. */
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/** Maximum platforms in the managed list. */
export const MAX_PLATFORMS = 30;

/** `users/{uid}` document. */
export const UserProfileSchema = z.object({
  schemaVersion: z.literal(1),
  displayName: z.string().trim().min(1).max(80),
  email: z.email(),
  authProvider: z.enum(['google', 'password']),
  settings: UserSettingsSchema.prefault({}),
  /** Managed broker list (Settings → Platforms), dropdown source. */
  platforms: z.array(PlatformSchema).max(MAX_PLATFORMS).default([]),
  /** One sector per instrument, so a stock held on several brokers has one sector. */
  sectorOverrides: z.record(InstrumentKeySchema, z.string().trim().min(1).max(60)).default({}),
  createdAt: z.number(),
  updatedAt: z.number(),
});
/** Validated user profile. */
export type UserProfile = z.infer<typeof UserProfileSchema>;

/** Data needed to create a profile on first sign-in. */
export type ProfileSeed = Pick<UserProfile, 'displayName' | 'email' | 'authProvider'>;
