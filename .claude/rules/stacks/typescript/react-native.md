---
description: React Native + Expo conventions. Reusable stack rule for Expo projects.
paths: ['**/*.tsx', '**/app.json', '**/app.config.*', '**/eas.json', '**/metro.config.*']
---

# React Native / Expo Conventions

- Expo managed workflow with **development builds** (`expo-dev-client`) and Continuous Native Generation: never hand-edit `android/` or `ios/`; configure native behaviour through `app.json`/`app.config.ts` and config plugins. Those folders are git-ignored.
- Install native packages with `npx expo install <pkg>` so versions match the Expo SDK. Run `npx expo-doctor` after dependency changes.
- Routing with Expo Router (`src/app/` or `app/`). Only route files live there; components, hooks and utils live outside it. Route files stay thin — they compose feature components and hooks.
- State: Zustand stores for client/UI state, kept small and per-feature; derived values are computed with selectors, not stored.
- Persistence: `react-native-mmkv` (encrypted instance) for local cache. Never store secrets or auth tokens in plain AsyncStorage.
- Components are function components with typed props; no inline business logic — call domain functions/hooks.
- Lists use `FlatList`/`SectionList` (or FlashList) — never `.map()` large arrays inside a `ScrollView`.
- Accessibility: every touchable has an `accessibilityLabel`; colour is never the only signal (pair R/G/Y colours with an icon or text).
- Expo APIs change every SDK: check the versioned docs for the installed SDK (`https://docs.expo.dev/versions/v<major>.0.0/`, index at `https://docs.expo.dev/llms.txt`) rather than relying on memory.
- Configuration comes from `app.config.ts` `extra` / `EXPO_PUBLIC_*` env vars. Remember `EXPO_PUBLIC_*` values are embedded in the bundle — they are not secret.
