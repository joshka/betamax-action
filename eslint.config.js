import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**", ".artifacts/**"] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
];
