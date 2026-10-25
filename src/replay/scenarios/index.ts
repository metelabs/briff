import type { ReplayScenario } from "../types";

import { nodeOct2026 } from "./node-oct-2026";
import { php2shell } from "./php2shell";

export const SCENARIOS: Readonly<Record<string, ReplayScenario>> = {
  [php2shell.id]: php2shell,
  [nodeOct2026.id]: nodeOct2026,
};
