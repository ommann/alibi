import type { Step } from "../step.ts";
import { runPackageScript } from "../package-script.ts";

export default {
  name: "lint",
  detect: ({ scripts }) => typeof scripts.lint === "string" && scripts.lint.trim() !== "",
  run: context => runPackageScript(context, "lint"),
} satisfies Step;
