import type { Step } from "../step.ts";
import { runPackageScript } from "../package-script.ts";

export default {
  name: "npm:build",
  detect: ({ scripts }) => typeof scripts.build === "string" && scripts.build.trim() !== "",
  run: context => runPackageScript(context, "build"),
} satisfies Step;
