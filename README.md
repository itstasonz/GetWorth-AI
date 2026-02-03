# GetWorth - AI-Powered Item Valuation App

An intelligent app that uses AI to recognize items from photos and provide instant market valuations.

## Features

- 📸 **Camera Scan** - Take photos directly in the app
- 🖼️ **Image Upload** - Upload existing photos
- 🤖 **AI Recognition** - Automatically identifies items using Claude AI
- 💰 **Instant Valuation** - Get market value estimates with price ranges
- 👤 **User Accounts** - Sign up with email, Google, or Apple
- 📋 **Personal Listings** - Save items you want to sell
- 📜 **Search History** - Track all your scanned items

## Quick Deploy to Vercel (Recommended)

### Option 1: One-Click Deploy
1. Push this code to a GitHub repository
2. Go to [vercel.com](https://vercel.com)
3. Click "New Project" → Import your GitHub repo
4. Click "Deploy"
5. Done! Access your app at `your-project.vercel.app`

### Option 2: Vercel CLI
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
cd getworth-app
vercel
```

## Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Deploy to Other Platforms

### Netlify
1. Go to [netlify.com](https://netlify.com)
2. Drag and drop the `dist` folder after running `npm run build`
3. Or connect your GitHub repo for auto-deploys

### GitHub Pages
1. Run `npm run build`
2. Push the `dist` folder to a `gh-pages` branch
3. Enable GitHub Pages in repo settings

## Mobile App Experience

After deploying, you can add the app to your phone's home screen:

### iOS (Safari)
1. Open your deployed URL in Safari
2. Tap the Share button
3. Tap "Add to Home Screen"

### Android (Chrome)
1. Open your deployed URL in Chrome
2. Tap the menu (three dots)
3. Tap "Add to Home screen"

## API Configuration

This app uses the Anthropic Claude API for image analysis. The API is configured to work within Claude.ai artifacts. For production deployment with your own API key:

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Get your API key
3. Add `VITE_ANTHROPIC_API_KEY` to your environment variables
4. Update the fetch call in `App.jsx` to include your API key in headers

## Tech Stack

- **React 18** - UI Framework
- **Vite** - Build Tool
- **Tailwind CSS** - Styling
- **Lucide React** - Icons
- **Claude AI** - Image Recognition & Valuation

## License

MIT License - Feel free to use for your own projects!

---

Built with ❤️ using Claude AI
