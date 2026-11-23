import { randomUUID } from "node:crypto";
import { InMemoryMockState, type MockStateStore } from "./state.js";

export interface ProviderDeps {
  store: MockStateStore;
  newId: () => string;
  now: () => Date;
}

export function defaultDeps(overrides: Partial<ProviderDeps> = {}): ProviderDeps {
  return {
    store: overrides.store ?? new InMemoryMockState(),
    newId: overrides.newId ?? randomUUID,
    now: overrides.now ?? (() => new Date()),
  };
}
