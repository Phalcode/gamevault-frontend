/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-base": "#11101E",
        surface: "#1B1A27",
        "surface-alt": "#232230",
        accent: "#6459DF",
        text: "#f5f6fa",
        "text-dim": "#b2b4c7",
        border: "#2e2d3b",
      },
      borderRadius: {
        s: "6px",
        m: "10px",
        l: "18px",
      },
      keyframes: {
        "avatar-shimmer": { to: { backgroundPosition: "-200% 0" } },
        "dropdown-fade": {
          from: { opacity: "0", transform: "translateY(-4px) scale(.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "fade-in-scale": {
          from: { opacity: "0", transform: "scale(.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "dropdown-fade": "dropdown-fade .22s cubic-bezier(.4,.2,.2,1)",
        "fade-in-scale": "fade-in-scale .24s cubic-bezier(.22,.95,.55,1.2)",
      },
      boxShadow: {
        focus: "0 0 0 3px rgba(100,89,223,0.35)",
      },
    },
  },
  plugins: [],
};
