# 🌿 Plant Scanner PWA

A Progressive Web App for plant identification and disease detection using Pl@ntNet and Gemini APIs.

## Features

- 📸 **Plant Identification** - Scan plants using your camera
- 🦠 **Disease Detection** - Detect plant diseases
- 🤖 **AI-Powered Analysis** - Uses Gemini API for advanced insights
- 📱 **PWA Support** - Install on your device for offline access

## Tech Stack

- **Backend**: Node.js (native modules)
- **Frontend**: HTML, CSS, JavaScript
- **APIs**: Pl@ntNet, Google Gemini

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/zeusato/PlantScaner.git
cd PlantScaner

# Install dependencies
npm install
```

### Development

```bash
# Start development server with hot-reload
npm run dev
```

### Production

```bash
npm start
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `PLANTNET_API_KEY` | Your Pl@ntNet API key |

## Deployment

This project is configured for automatic deployment to Vercel via GitHub Actions.

### Manual Vercel Setup

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` and follow the prompts
3. Add secrets to GitHub repository:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`

## License

MIT
