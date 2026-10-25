// Triage rows written by a rule rather than the model carry these instead of a model id.
// A module of their own so pure callers (the replay engine, the runtime urgent plan) do not
// import the triage job.
export const RULE_MODEL = "rule";
export const RULE_VERSION = "rule-v1";
