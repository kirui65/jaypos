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
          gold: "var(--ej-gold)",
          "gold-soft": "var(--ej-gold-soft)",
          "gold-deep": "var(--ej-gold-deep)",
          "gold-wash": "var(--ej-gold-wash)",
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
