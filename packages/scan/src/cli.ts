import { run } from "./run";

process.exitCode = await run(process.argv.slice(2), process.env, {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  cwd: process.cwd(),
});
