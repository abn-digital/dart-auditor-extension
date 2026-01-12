# DART Event Auditor

Chrome extension that captures tracking events from websites for the DART Tracking Portal.

## Supported Platforms

- Google Analytics 4 (GA4)
- Google Tag Manager (GTM)
- Meta Pixel (Facebook)
- Google Ads Conversions
- TikTok Pixel
- DataLayer events
- User interactions (clicks, forms, navigation)

## Installation

### Step 1: Download

Download or clone this repository to your computer.

### Step 2: Open Chrome Extensions

1. Open Chrome browser
2. Navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner)

### Step 3: Load the Extension

1. Click **"Load unpacked"**
2. Select the `DART Event Auditor` folder
3. The extension will appear in your toolbar

## Usage

1. Connect to the DART Tracking Portal
2. Enter the target domain in the portal
3. Browse the website normally
4. Events will be captured and sent to the portal in real-time

## How It Works

The extension monitors network requests to tracking endpoints and captures:

| Platform | Detection |
|----------|-----------|
| GA4 | `google-analytics.com/g/collect` |
| GTM | `googletagmanager.com/gtm.js` |
| Meta | `facebook.com/tr`, `facebook.net/tr` |
| Google Ads | `googleadservices.com/pagead/conversion` |
| TikTok | `analytics.tiktok.com/api/v2/pixel` |

Events are sent via WebSocket to `ws://127.0.0.1:3001` for the portal to receive.

## Files

```
DART Event Auditor/
├── manifest.json    # Extension configuration
├── background.js    # Service worker (event capture)
├── content.js       # Content script
├── popup.html       # Extension popup UI
└── popup.js         # Popup logic
```

## Requirements

- Google Chrome (or Chromium-based browser)
- DART Tracking Portal running on localhost:3000
