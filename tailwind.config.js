/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        construct: {
          bg: "#1e1e2e",
          sidebar: "#181825",
          panel: "#11111b",
          border: "#313244",
          hover: "#585b70",
          active: "#45475a",
          text: "#cdd6f4",
          textMuted: "#6c7086",
          accent: "#89b4fa",
          accentHover: "#74c7ec",
          success: "#a6e3a1",
          warning: "#f9e2af",
          error: "#f38ba8",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        xs: "0.7rem",
        sm: "0.8rem",
        base: "0.9rem",
      },
    },
  },
  plugins: [],
};
