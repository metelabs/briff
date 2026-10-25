import { readFileSync } from "node:fs";
import path from "node:path";

// Prompts are versioned Markdown files in src/llm/prompts. The first line is
// `<!-- version: <id> -->`; the version is stored on every row the prompt produces.
// Read from the working directory: the worker image copies the folder to /app/src/llm/prompts.

export type PromptName = "triage" | "synthesis" | "profile";

export interface Prompt {
  name: PromptName;
  version: string;
  text: string;
}

const cache = new Map<PromptName, Prompt>();

export function parsePrompt(name: PromptName, raw: string): Prompt {
  const match = /^<!--\s*version:\s*([\w.-]+)\s*-->\s*\n/.exec(raw);
  if (!match) throw new Error(`prompt ${name}: missing "<!-- version: ... -->" header`);
  return { name, version: match[1], text: raw.slice(match[0].length).trim() };
}

export function loadPrompt(name: PromptName): Prompt {
  const hit = cache.get(name);
  if (hit) return hit;
  const file = path.join(process.cwd(), "src", "llm", "prompts", `${name}.md`);
  const prompt = parsePrompt(name, readFileSync(file, "utf8"));
  cache.set(name, prompt);
  return prompt;
}
