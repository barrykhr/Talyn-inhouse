import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

// Next.js's recommended rules (React, hooks, Core Web Vitals). TypeScript itself is checked by `npm run typecheck`.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "prisma/migrations/**", "qa/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals"),
];

export default config;
