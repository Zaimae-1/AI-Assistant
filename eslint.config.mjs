import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**", "apps/mobile/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
];
