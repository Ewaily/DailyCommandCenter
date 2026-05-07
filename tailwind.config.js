/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/frontend/**/*.{html,ts,js}',
  ],
  // Theming is handled via [data-theme] CSS custom properties, not Tailwind's
  // dark-mode class strategy. Preflight is disabled to avoid conflicting with
  // the existing hand-authored CSS reset.
  darkMode: ['class', '[data-theme="dark"]'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        paper: {
          0: '#F7F7F4',
          1: '#FDFDFB',
          2: '#F2F2EE',
          3: '#EAEAE5',
        },
        ink: {
          1: '#0F0F10',
          2: '#3A3A3D',
          3: '#71706C',
          4: '#A4A29A',
          inverse: '#FDFDFB',
        },
        line: {
          1: '#E4E2DA',
          2: '#D2CFC4',
          focus: '#0F0F10',
        },
        sig: {
          now:   '#D14B3D',
          go:    '#1E7A52',
          hold:  '#B57A14',
          info:  '#2B5BD7',
          focus: '#1A1A1B',
          new:   '#7A3FCC',
        },
      },
      fontFamily: {
        sans: ['Söhne', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"Berkeley Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
      borderRadius: {
        1: '3px',
        2: '6px',
        3: '10px',
      },
      transitionTimingFunction: {
        'ease-out-curve': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
