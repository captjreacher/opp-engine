/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Graphite scale shared by every operational surface.
        graphite: {
          50: '#F5F7FA', 100: '#F5F7FA', 200: '#E0E3E9',
          300: '#C4C9D2', 400: '#A7ADB7', 500: '#9299A5',
          600: '#737A86', 700: '#404650', 800: '#30343D',
          900: '#1D2027', 950: '#111318',
        },
        accent: {
          50: '#FFF3F2', 100: '#FFE2DF', 200: '#FFC3BE',
          300: '#FFABA5', 400: '#FF8179', 500: '#FF241D',
          600: '#E10600', 700: '#B80D08', 800: '#9F0804',
          900: '#3A1112',
        },
        console: { base: '#111318', raised: '#171A20', panel: '#1D2027', selected: '#252932' },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
