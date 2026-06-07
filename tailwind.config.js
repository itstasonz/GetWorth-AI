/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // GetWorth design tokens — Stage 1
        // Maps Tailwind utility classes to CSS variables defined in index.css.
        // Usage: bg-app, bg-surface-lowest, bg-surface-low, bg-surface-high,
        //        text-primary, text-primary-dark, text-primary-on,
        //        border-outline (and all other Tailwind color utilities)
        'app':            'var(--color-app)',
        'surface-lowest': 'var(--color-surface-lowest)',
        'surface-low':    'var(--color-surface-low)',
        'surface-high':   'var(--color-surface-high)',
        'primary':        'var(--color-primary)',
        'primary-dark':   'var(--color-primary-dark)',
        'primary-on':     'var(--color-primary-on)',
        'outline':        'var(--color-outline)',
        // Stage 2: text and elevation tokens
        'app-secondary':  'var(--color-text-secondary)',
        'app-muted':      'var(--color-text-muted)',
        'surface-muted':  'var(--color-surface-muted)',
      },
    },
  },
  plugins: [],
}
