// ---------------------------------------------------------------------------
// Discord Component Registry
// ---------------------------------------------------------------------------
//
// Extensions register button handler specs (plain objects) during plugin
// registration. The Discord provider drains the registry at startup and
// creates real Carbon Button subclass instances using the bundled @buape/carbon
// classes — ensuring instanceof checks in ComponentHandler work correctly.
//
// Why specs instead of Button instances?
//   Extensions are loaded via jiti (runtime TS transpiler) which resolves
//   @buape/carbon from node_modules. The gateway's built dist/ code bundles
//   its own copy of @buape/carbon. The two Button classes are different
//   objects, so `extensionButton instanceof bundledButton` returns false,
//   causing Carbon's ComponentHandler to reject the component.
//
// Flow:
//   1. Extension calls registerDiscordButton({ customId, run, ... })
//   2. Provider calls drainDiscordButtonSpecs() at startup
//   3. Provider creates real Button subclasses from specs
//   4. Carbon Client receives proper bundled-class instances

import { Button, type ButtonInteraction } from "@buape/carbon";
import { ButtonStyle } from "discord-api-types/v10";

/** Spec for a button handler that extensions register. */
export interface DiscordButtonSpec {
  /** Custom ID prefix (e.g., "scoutprop:seed=1"). Used as the button's customId. */
  customId: string;
  /** Label displayed on the button (optional, only matters if button is shown in a message). */
  label?: string;
  /** Button style (default: Primary). */
  style?: ButtonStyle;
  /** Whether to defer the interaction. */
  defer?: boolean;
  /** Whether to respond ephemerally. */
  ephemeral?: boolean;
  /** The handler function called when the button is clicked. */
  run: (interaction: ButtonInteraction, data: Record<string, unknown>) => Promise<void> | void;
}

// Use globalThis so jiti-loaded extensions and built dist/ code share the same array.
const REGISTRY_KEY = "__openclaw_discord_button_specs__";

function getSpecs(): DiscordButtonSpec[] {
  if (!(globalThis as any)[REGISTRY_KEY]) {
    (globalThis as any)[REGISTRY_KEY] = [];
  }
  return (globalThis as any)[REGISTRY_KEY];
}

/** Register a button handler spec. Extensions call this during register(). */
export function registerDiscordButton(spec: DiscordButtonSpec): void {
  getSpecs().push(spec);
}

/** Drain all registered specs and create real Carbon Button instances. */
export function drainDiscordButtonSpecs(): Button[] {
  const specs = getSpecs();
  const result: Button[] = [];
  for (const spec of specs) {
    result.push(createButtonFromSpec(spec));
  }
  specs.length = 0;
  return result;
}

/** Create a Carbon Button subclass instance from a spec. */
function createButtonFromSpec(spec: DiscordButtonSpec): Button {
  const btn = new (class extends Button {
    customId = spec.customId;
    label = spec.label ?? "";
    style = spec.style ?? ButtonStyle.Primary;
    defer = spec.defer ?? false;
    ephemeral = spec.ephemeral ?? false;

    async run(interaction: ButtonInteraction, data: Record<string, unknown>) {
      await spec.run(interaction, data);
    }
  })();
  return btn;
}
