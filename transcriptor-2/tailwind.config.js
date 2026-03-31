/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: "#0f1419", raised: "#1a2332", border: "#2d3a4d" },
        accent: { DEFAULT: "#38bdf8", muted: "#0ea5e9", foreground: "#0c1929" },
        danger: { DEFAULT: "#f43f5e", foreground: "#fff1f2" },
      },
      fontSize: { "2xs": ["0.6875rem", { lineHeight: "1rem" }] },
    },
  },
  plugins: [],
};
