import { createKeyValueCache, memoryRawStore } from '@/services/cache/kv';
import { createUiStore } from './uiStore';

describe('uiStore summary visibility', () => {
  it('shows the summary by default', () => {
    expect(createUiStore(createKeyValueCache(memoryRawStore())).getState().summaryHidden).toBe(false);
  });

  it('remembers a hidden summary across launches', () => {
    const kv = createKeyValueCache(memoryRawStore());
    createUiStore(kv).getState().toggleSummaryHidden();
    expect(createUiStore(kv).getState().summaryHidden).toBe(true);
    const store = createUiStore(kv);
    store.getState().toggleSummaryHidden();
    expect(createUiStore(kv).getState().summaryHidden).toBe(false);
  });

  it('shows it again after sign-out', () => {
    const store = createUiStore(createKeyValueCache(memoryRawStore()));
    store.getState().toggleSummaryHidden();
    store.getState().reset();
    expect(store.getState().summaryHidden).toBe(false);
  });
});
