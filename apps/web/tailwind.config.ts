import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ej: {
          black: "var(--ej-black)",
          ink: "var(--ej-ink)",
          charcoal: "var(--ej-charcoal)",
          graphite: "var(--ej-graphite)",
          blue: "var(--ej-blue)",
          "blue-soft": "var(--ej-blue-soft)",
          "blue-deep": "var(--ej-blue-deep)",
          "blue-wash": "var(--ej-blue-wash)",
          yellow: "var(--ej-yellow)",
          "yellow-soft": "var(--ej-yellow-soft)",
          "yellow-deep": "var(--ej-yellow-deep)",
          "yellow-wash": "var(--ej-yellow-wash)",
          white: "var(--ej-white)",
          paper: "var(--ej-paper)",
          line: "var(--ej-line)",
          muted: "var(--ej-muted)",
          success: "var(--ej-success)",
          warning: "var(--ej-warning)",
          danger: "var(--ej-danger)",
        },
      },
      fontFamily: { sans: ["EJ Sans", "sans-serif"], serif: ["EJ Serif", "serif"] },
      borderRadius: {
        "ej-sm": "var(--ej-radius-sm)",
        "ej-md": "var(--ej-radius-md)",
        "ej-lg": "var(--ej-radius-lg)",
      },
    },
  },
  plugins: [],
} satisfies Config;
