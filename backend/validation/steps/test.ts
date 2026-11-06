import type { Step } from "../step.ts";
import { runPackageScript } from "../package-script.ts";

export default {
  name: "npm:test",
  detect: ({ scripts }) => typeof scripts.test === "string" && scripts.test.trim() !== "",
  run: context => runPackageScript(context, "test"),
} satisfies Step;
