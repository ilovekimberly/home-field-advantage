import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ice: "#e6f2ff",
        rink: "#0b1f3a",
      },
    },
  },
  plugins: [],
};
export default config;
