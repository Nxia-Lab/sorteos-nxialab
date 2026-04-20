export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0a0a',
        cyan: '#00FFFF',
        azure: '#0070f3',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(0, 255, 255, 0.15), 0 0 32px rgba(0, 112, 243, 0.18)',
      },
      backgroundImage: {
        grid: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
