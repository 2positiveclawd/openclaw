// ---------------------------------------------------------------------------
// Discord Component Registry
// ---------------------------------------------------------------------------
//
// Thin registry that allows extensions to register Discord button components
// during plugin registration. The Discord provider drains the registry when
// building the Carbon Client's component array.
//
// Flow:
//   1. Extension calls registerDiscordComponentFactory() in register()
//   2. Discord provider calls drainDiscordComponentFactories() at startup
//   3. Factories are invoked, components added to the Carbon Client
//   4. Registry is cleared after drain

import type { Button } from "@buape/carbon";

type DiscordComponentFactory = () => Button | Button[];

const factories: DiscordComponentFactory[] = [];

/** Register a factory that produces one or more Discord button components. */
export function registerDiscordComponentFactory(factory: DiscordComponentFactory): void {
  factories.push(factory);
}

/** Invoke all registered factories and return their components. Clears the registry. */
export function drainDiscordComponentFactories(): Button[] {
  const result: Button[] = [];
  for (const f of factories) {
    const r = f();
    if (Array.isArray(r)) result.push(...r);
    else result.push(r);
  }
  factories.length = 0;
  return result;
}
