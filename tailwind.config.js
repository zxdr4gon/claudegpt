/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: token('paper'),
        raised: token('raised'),
        ink: token('ink'),
        muted: token('muted'),
        rule: token('rule'),
        focus: token('focus'),
        mark: {
          due: token('mark-due'),
          tag: token('mark-tag'),
          priority: token('mark-priority'),
          url: token('mark-url'),
        },
      },
      fontFamily: {
        sans: ['"Schibsted Grotesk Variable"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
