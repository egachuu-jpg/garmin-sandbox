import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f0f0f',
          card: '#1a1a1a',
          border: '#2a2a2a',
        },
        primary: {
          DEFAULT: '#10b981',
          dim: '#065f46',
        },
        muted: '#6b7280',
      },
    },
  },
  plugins: [],
};

export default config;
