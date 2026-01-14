# 🌿 Plant Scanner PWA

![Plant Scanner Banner](public/Frame%2010134.png)

**Plant Scanner** is a modern Progressive Web App (PWA) that turns your smartphone into a powerful botanical assistant. It combines the identification capabilities of **Pl@ntNet** with the deep reasoning and localized knowledge of **Google Gemini AI** to provide instant plant identification, health assessments, and care guides in Vietnamese.

[**Live Demo**](https://plant-scanner-one.vercel.app/)

## ✨ Key Features

- **📸 Smart Scanning Flow**: Guided 3-step capture process (Overview, Leaf, Disease) ensures high-accuracy analysis.
- **🧠 Advanced AI Analysis**:
  - Uses **Google Gemini 2.0 Flash (Exp) / 3.0 (Preview)** via the official SDK for detailed insights.
  - Multi-modal analysis: Processes images + context simultaneously.
- **💾 Robust Session Persistence**:
  - Built on **IndexedDB** to store high-resolution images locally.
  - **Auto-Resume**: Never lose your progress even if the browser reloads or crashes due to memory pressure.
- **⚡ High Performance**:
  - **Dynamic Imports**: SDKs load only when needed, ensuring instant startup.
  - **PWA Ready**: Works offline, installable on Home Screen, and updates automatically via Service Workers.
- **🇻🇳 Localized Content**: All results, care guides, and fun facts are returned in natural Vietnamese.

## 🛠 Tech Stack

- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES Modules).
- **Storage**: IndexedDB (via native API) for session & settings.
- **AI Integration**: `@google/generative-ai` SDK (Client-side) + Pl@ntNet API (Server-side proxy).
- **Deployment**: Vercel (Serverless Functions for proxying).
- **PWA**: Service Worker (`v5+`) with aggressive cache-busting strategies.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (for local development)
- A Google Gemini API Key
- (Optional) PlantNet API Key

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/zeusato/PlantScaner.git
   cd PlantScaner
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start Local Server**
   ```bash
   npm run dev
   # or
   npx serve public
   ```

4. **Open in Browser**
   - Navigate to `http://localhost:3000` (or the port shown).
   - **Note**: Camera features require `HTTPS` or `localhost`.

## ⚙️ Configuration

### API Keys
The app allows users to input their **own Gemini API Key** directly in the UI.
1. Click the **Settings (⚙️)** icon in the app.
2. Enter your Gemini API Key.
3. The key is stored securely in your browser's **IndexedDB** and is never sent to our backend server (it goes directly to Google).

### Deployment
This project is optimized for **Vercel**.

1. Fork this repo.
2. Import to Vercel.
3. (Optional) Add Environment Variables in Vercel for the backend proxy:
   - `PLANTNET_API_KEY`: If you want to enable the fallback identification.

## 📱 Mobile Usage
1. Open the website on Chrome (Android) or Safari (iOS).
2. Tap **"Add to Home Screen"**.
3. Launch the app from your home screen for a full-screen, native-like experience.

## 📄 License
MIT License.
