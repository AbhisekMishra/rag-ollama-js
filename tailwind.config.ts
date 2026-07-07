import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#f2f3ef",
        surface: "#ffffff",
        "surface-muted": "#eceee8",
        border: "#dcded6",
        ink: "#1a1e1c",
        "ink-soft": "#5c625c",
        "ink-faint": "#8b9089",
        accent: {
          DEFAULT: "#2f6f5e",
          strong: "#234f42",
          soft: "#e2ede7",
        },
        danger: {
          DEFAULT: "#b3422f",
          soft: "#f6e6e2",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(26, 30, 28, 0.04), 0 8px 24px -12px rgba(26, 30, 28, 0.12)",
      },
      keyframes: {
        "message-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "message-in": "message-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
