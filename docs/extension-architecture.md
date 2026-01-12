# GA4 Event Auditor Extension - Architecture & Event System

This document explains how the GA4 Event Auditor Chrome extension works and how it emits events throughout the system.

## Overview

The GA4 Event Auditor is a **Chrome Browser Extension (Manifest V3)** that captures and relays tracking events from websites. It monitors:

- Google Analytics 4 (GA4)
- Meta Pixel (Facebook)
- Google Ads Conversions
- TikTok Pixel

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHROME BROWSER                               │
│  ┌─────────────┐    ┌─────────────────────────────────────┐   │
│  │ Content     │───>│ Background Service Worker            │   │
│  │ Script      │    │ (webRequest API + WebSocket client) │   │
│  └─────────────┘    └─────────────────────────────────────┘   │
│         │                          │                           │
│         │                          │ WebSocket                 │
│         ▼                          ▼                           │
│  ┌─────────────┐           ┌─────────────┐                    │
│  │ Popup UI    │<──────────│ ws://127.0.0.1:3001             │
│  └─────────────┘           └─────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EVENT SERVER (Node.js)                       │
│  ┌─────────────────┐         ┌─────────────────┐              │
│  │ WebSocket Server │────────>│ Socket.io Server │             │
│  │ Port 3001        │         │ Port 3000        │             │
│  └─────────────────┘         └─────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│              CLIENT APPLICATIONS (Web Portal / Electron)        │
└─────────────────────────────────────────────────────────────────┘
```

## Event Emission Flow

### 1. Network Request Interception (Primary Source)

The background service worker uses Chrome's `webRequest.onBeforeRequest` API to intercept all outgoing tracking requests.

**File:** `ga4-extension/background.js` (lines 350-403)

```javascript
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Detect which platform the request belongs to
    const platform = detectPlatform(details.url);

    // Parse the request into a structured event object
    let eventData = parseGA4Event(details.url, requestBody);

    // Send to the portal via WebSocket
    sendEventToPortal(eventData, initiator);
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);
```

**Platform Detection** identifies requests by URL patterns:

| Platform | URL Pattern |
|----------|-------------|
| GA4 | `/g/collect` or `/j/collect` |
| Meta Pixel | `/tr` on `facebook.com` or `facebook.net` |
| Google Ads | `/pagead/conversion/` or `/pagead/viewthroughconversion/` |
| TikTok | `/api/v2/pixel` |

### 2. DataLayer Interception (Secondary Source)

The content script intercepts GTM dataLayer pushes before they become network requests.

**File:** `ga4-extension/content.js` (lines 22-76)

```javascript
// Override the dataLayer.push method
window.dataLayer.push = function() {
    args.forEach(item => {
        // Dispatch a custom DOM event
        window.dispatchEvent(new CustomEvent('__ga4_auditor_datalayer', {
            detail: JSON.stringify({
                event: item.event,
                ecommerce: item.ecommerce,
                data: item
            })
        }));
    });
    return originalPush.apply(window.dataLayer, arguments);
};

// Listen for the custom event and forward to background
window.addEventListener('__ga4_auditor_datalayer', (e) => {
    chrome.runtime.sendMessage({
        type: 'datalayer-event',
        event: data
    });
});
```

### 3. WebSocket Transmission to Server

Events captured by the background worker are sent to the event server via WebSocket.

**File:** `ga4-extension/background.js` (lines 225-345)

```javascript
function connectToPortal() {
    ws = new WebSocket('ws://127.0.0.1:3001');

    ws.onopen = () => {
        isConnected = true;
        broadcastStatus();
    };

    ws.onclose = () => {
        // Auto-reconnect after 3 seconds
        setTimeout(connectToPortal, 3000);
    };
}

function sendEventToPortal(eventData, initiator) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }

    // Also notify the popup UI
    chrome.runtime.sendMessage({
        type: 'event',
        event: payload
    });
}
```

### 4. Server Relay via Socket.io

The event server receives WebSocket messages and broadcasts them to all connected clients.

**File:** `server.js` (lines 27-64)

```javascript
wss.on('connection', (ws) => {
    extensionSocket = ws;
    io.emit('extension-status', { connected: true });

    ws.on('message', (data) => {
        const message = JSON.parse(data);

        if (message.type === 'ga4-event') {
            io.emit('tracking-event', message.event);
        }
        if (message.type === 'datalayer-event') {
            io.emit('datalayer-event', message.event);
        }
    });
});
```

### 5. Chrome Runtime Messaging (Internal)

Components within the extension communicate using Chrome's runtime messaging API.

```javascript
// Background -> Popup: Status updates
chrome.runtime.sendMessage({
    type: 'status',
    connected: isConnected,
    targetDomain: targetDomain
});

// Popup -> Background: Request status
chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
    updateStatus(response.connected, response.targetDomain);
});

// Popup -> Background: Trigger reconnect
chrome.runtime.sendMessage({ type: 'connect' });
```

## Event Types & Data Structures

### GA4 Event

```javascript
{
    type: 'ga4-event',
    platform: 'GA4',
    event: 'purchase',
    measurementId: 'G-XXXXXX',
    clientId: '1234567890.123',
    sessionId: '1703001234',
    pageLocation: 'https://example.com/checkout',
    pageTitle: 'Checkout Complete',
    value: 149.99,
    currency: 'USD',
    initiator: 'https://example.com',
    timestamp: '2024-01-15T10:30:00.000Z',
    source: 'extension',
    raw: { /* all URL parameters */ }
}
```

### DataLayer Event

```javascript
{
    type: 'datalayer-event',
    event: 'add_to_cart',
    ecommerce: {
        currency: 'USD',
        value: 79.99,
        items: [{ item_id: 'SKU123', item_name: 'Product', quantity: 1 }]
    },
    data: { /* full dataLayer object */ }
}
```

### Meta Pixel Event

```javascript
{
    type: 'meta-event',
    platform: 'Meta Pixel',
    event: 'Purchase',
    pixelId: '1234567890',
    pageLocation: 'https://example.com/thank-you',
    value: 99.99,
    currency: 'USD',
    raw: { /* all URL parameters */ }
}
```

## Event Emission Summary

| Mechanism | Source File | Transport | Destination |
|-----------|-------------|-----------|-------------|
| Chrome WebRequest API | `background.js` | Direct interception | Internal processing |
| Custom DOM Events | `content.js` | `window.dispatchEvent()` | Content script listener |
| Chrome Runtime Messages | Multiple | `chrome.runtime.sendMessage()` | Background / Popup |
| WebSocket | `background.js` | JSON over WS | Event Server (3001) |
| Socket.io | `server.js` | JSON over HTTP/WS | Web Clients (3000) |

## Domain Filtering

Events are filtered by target domain to reduce noise:

```javascript
function matchesDomain(eventUrl, targetDomain) {
    const eventHost = new URL(eventUrl).hostname.replace(/^www\./, '');
    const target = targetDomain.replace(/^www\./, '');
    return eventHost === target || eventHost.endsWith('.' + target);
}
```

Only events originating from the configured target domain are forwarded to the server.

## Connection Management

The extension implements automatic reconnection:

1. Connects to server on extension load
2. Reconnects every 3 seconds if connection drops
3. Broadcasts status changes to popup UI
4. Gracefully handles server unavailability

## Key Files Reference

| File | Purpose |
|------|---------|
| `ga4-extension/manifest.json` | Extension configuration & permissions |
| `ga4-extension/background.js` | Event capture, parsing, and relay |
| `ga4-extension/content.js` | DataLayer interception |
| `ga4-extension/popup.js` | Popup UI logic |
| `ga4-extension/popup.html` | Popup UI markup |
| `server.js` | Event relay server |

## Socket.io Events (Client Usage)

Clients can listen for these events:

```javascript
const socket = io('http://localhost:3000');

// Tracking events from network requests
socket.on('tracking-event', (event) => {
    console.log('Tracking event:', event);
});

// DataLayer events
socket.on('datalayer-event', (event) => {
    console.log('DataLayer event:', event);
});

// Extension connection status
socket.on('extension-status', (status) => {
    console.log('Extension connected:', status.connected);
});

// Start an audit
socket.emit('start-audit', { url: 'example.com' });
```
