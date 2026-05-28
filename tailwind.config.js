/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/renderer/**/*.{html,js,jsx,ts,tsx}",
  ],
  theme: {
    /* ----------------------------------------------------------
       Colors — LCH-based design tokens
       ---------------------------------------------------------- */
    colors: {
      transparent: "transparent",
      current:     "currentColor",

      "c-base":    "#0c0c10",   /* LCH 8%  5% 280 */
      "c-s1":      "#12121a",   /* LCH 12% 4% 280 */
      "c-s2":      "#1a1a24",   /* LCH 16% 4% 280 */
      "c-s3":      "#22222e",   /* LCH 20% 5% 280 */

      "c-accent":  "#6366f1",   /* LCH 55% 60% 280 — use sparingly */
      "c-accent-hover": "#818cf8",

      "c-text":    "#e8e8ec",   /* primary   */
      "c-text2":   "#94949c",   /* secondary */
      "c-muted":   "#6b6b73",   /* muted     */
      "c-dim":     "#4a4a52",   /* barely visible */

      "c-ok":      "#10b981",   /* emerald */
      "c-warn":    "#f59e0b",   /* amber   */
      "c-err":     "#ef4444",   /* red     */
      "c-info":    "#60a5fa",   /* blue    */

      "c-border":  "rgba(255, 255, 255, 0.04)",
      "c-border-active": "rgba(99, 102, 241, 0.30)",
    },

    /* ----------------------------------------------------------
       Font Family — Geist Mono primary
       ---------------------------------------------------------- */
    fontFamily: {
      mono: [
        '"Geist Mono"',
        '"JetBrains Mono"',
        '"Fira Code"',
        '"Consolas"',
        "monospace",
      ],
    },

    /* ----------------------------------------------------------
       Font Size — strict 10–16px range
       ---------------------------------------------------------- */
    fontSize: {
      xs:   ["10px", { lineHeight: "1.4" }],   /* labels         */
      sm:   ["11px", { lineHeight: "1.4" }],   /* data / numbers */
      base: ["12px", { lineHeight: "1.4" }],   /* body           */
      lg:   ["13px", { lineHeight: "1.4" }],   /* headings       */
      xl:   ["14px", { lineHeight: "1.4" }],   /* emphasis       */
      "2xl": ["16px", { lineHeight: "1.2" }],  /* MAX allowed    */
    },

    /* ----------------------------------------------------------
       Spacing — strict 4–24px range
       ---------------------------------------------------------- */
    spacing: {
      0:  "0px",
      1:  "4px",    /* icon gaps              */
      2:  "6px",    /* button padding-y       */
      3:  "8px",    /* section gaps, card pad */
      4:  "12px",   /* panel padding          */
      5:  "16px",   /* major section sep      */
      6:  "24px",   /* page margins           */
    },

    /* ----------------------------------------------------------
       Border Radius — sharp by default
       ---------------------------------------------------------- */
    borderRadius: {
      none: "0px",
      sm:   "2px",    /* buttons            */
      DEFAULT: "2px",
      md:   "4px",    /* dropdown menus     */
      lg:   "4px",    /* max radius         */
    },

    /* ----------------------------------------------------------
       Line Height
       ---------------------------------------------------------- */
    lineHeight: {
      tight:  "1.2",
      normal: "1.4",
      relaxed: "1.6",
    },

    /* ----------------------------------------------------------
       Letter Spacing
       ---------------------------------------------------------- */
    letterSpacing: {
      tight:  "-0.01em",
      normal: "0em",
      wide:   "0.02em",
      wider:  "0.08em",
    },

    /* ----------------------------------------------------------
       Transition Duration — minimal
       ---------------------------------------------------------- */
    transitionDuration: {
      fast:   "100ms",
      normal: "150ms",
    },

    /* ----------------------------------------------------------
       Transition Timing Function
       ---------------------------------------------------------- */
    transitionTimingFunction: {
      default: "cubic-bezier(0.4, 0, 0.2, 1)",
    },

    /* ----------------------------------------------------------
       extend — keep empty, all tokens defined above
       ---------------------------------------------------------- */
    extend: {},
  },
  plugins: [],
};
