import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["node_modules/", "dist/", ".wrangler/", "worker-configuration.d.ts"],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"indent": ["error", "tab"],
			"quotes": ["error", "double", { avoidEscape: true }],
			"semi": ["error", "always"],
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", {
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
				caughtErrorsIgnorePattern: "^_",
			}],
			"@typescript-eslint/no-explicit-any": "warn",
		},
	},
);
