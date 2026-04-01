/***************************
 * Tailwind config
 ***************************/
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f5f7fb",
          900: "#0c1424",
        },
        acid: "#9ef01a",
        lava: "#ff6b35",
      },
    },
  },
  plugins: [],
};
