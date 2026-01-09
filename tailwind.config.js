/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        tokyo: {
          bg: "#1a1b26",
          surface: "#24283b",
          border: "#414868",
          text: "#c0caf5",
          muted: "#9aa5ce",
          blue: "#7aa2f7",
          green: "#9ece6a",
          red: "#f7768e",
          yellow: "#e0af68",
          purple: "#bb9af7",
        },
      },
      fontFamily: {
        sans: ["SF Pro Text", "Inter", "system-ui", "sans-serif"],
        mono: ["SF Mono", "JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
