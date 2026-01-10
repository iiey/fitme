import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Strava-inspired accent.
        brand: {
          DEFAULT: "#fc4c02",
          dark: "#d63e00",
        },
        surface: {
          DEFAULT: "#ffffff",
          muted: "#f5f6f8",
        },
      },
    },
  },
  plugins: [],
};

export default config;
