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
        // Paper / surface scale (light)
        paper: {
          0: '#F7F7F4',
          1: '#FDFDFB',
          2: '#F2F2EE',
          3: '#EAEAE5',
        },
        // Ink / text scale (light)
        ink: {
          1: '#0F0F10',
          2: '#3A3A3D',
          3: '#71706C',
          4: '#A4A29A',
          inverse: '#FDFDFB',
        },
        // Line / border scale (light)
        line: {
          1: '#E4E2DA',
          2: '#D2CFC4',
          focus: '#0F0F10',
        },
        // Signal / semantic colors (light)
        sig: {
          now:   '#D14B3D',
          go:    '#1E7A52',
          hold:  '#B57A14',
          info:  '#2B5BD7',
          focus: '#1A1A1B',
          new:   '#7A3FCC',
        },
        // Premium header gradient colors
        hdr: {
          from: '#0D1B2E',
          mid:  '#162D52',
          to:   '#0B1824',
        },
        // KPI accent bars
        kpi: {
          calendar: '#2B5BD7',
          slack:    '#D14B3D',
          jira:     '#0052CC',
          github:   '#1A1A1B',
        },
        // Dark-mode obsidian surfaces
        obsidian: {
          0: '#070A0C',
          1: '#0B1014',
          2: '#10161B',
          3: '#161E25',
        },
        // Dark accent (electric teal)
        teal: {
          glow: '#37D8B0',
          soft: '#5EEACB',
        },
      },
      fontFamily: {
        sans:    ['Söhne', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono:    ['"Berkeley Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        body:    ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        'mono-2': ['"IBM Plex Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'monospace'],
      },
      borderRadius: {
        1:    '3px',
        2:    '6px',
        3:    '10px',
        card: '12px',
        xl2:  '16px',
      },
      boxShadow: {
        'card':       '0 1px 3px rgba(15,15,16,.05), 0 4px 16px -4px rgba(15,15,16,.10), 0 0 0 1px #E4E2DA',
        'card-hover': '0 2px 6px rgba(15,15,16,.08), 0 12px 32px -8px rgba(15,15,16,.16), 0 0 0 1px #D2CFC4',
        'premium':    '0 8px 32px -8px rgba(15,15,16,.22), 0 32px 96px -16px rgba(15,15,16,.30)',
        'obsidian':   '0 8px 32px -8px rgba(0,0,0,.65), 0 32px 96px -16px rgba(0,0,0,.80)',
        'glow-teal':  '0 0 20px rgba(55,216,176,.25)',
        'glow-info':  '0 0 20px rgba(43,91,215,.20)',
      },
      transitionTimingFunction: {
        'ease-out-curve': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      backdropBlur: {
        'glass': '24px',
      },
    },
  },
  plugins: [],
};
