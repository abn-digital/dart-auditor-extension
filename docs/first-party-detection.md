# First-Party GTM & Gtag Detection

This document explains how the DART extension detects when GTM containers and Gtag libraries are loaded from first-party (server-side) domains.

---

## Why First-Party Matters

When tracking scripts load from a **first-party domain** instead of Google's servers, it indicates:

- **Server-Side GTM (sGTM)** is configured
- Tracking bypasses ad blockers
- First-party cookies are used
- Data is routed through customer's own server

---

## What We Detect

### 1. GTM Container (`/gtm.js`)

**Standard (Client-Side):**
```
https://www.googletagmanager.com/gtm.js?id=GTM-XXXXX
```

**First-Party (Server-Side):**
```
https://metrics.example.com/gtm.js?id=GTM-XXXXX
```

**Detection Logic:**
- URL contains `/gtm.js`
- URL contains `id=GTM-`
- Domain is NOT `googletagmanager.com`

**Event Emitted:**
```json
{
  "type": "gtm-event",
  "platform": "GTM",
  "event": "container_load",
  "containerId": "GTM-XXXXX",
  "serverSide": {
    "isFirstParty": true,
    "endpoint": "metrics.example.com",
    "isServerSideGTM": true
  }
}
```

---

### 2. Gtag.js Library (`/gtag/js`)

**Standard (Client-Side):**
```
https://www.googletagmanager.com/gtag/js?id=G-XXXXX
```

**First-Party (Server-Side):**
```
https://gt.example.com/gtag/js?id=G-XXXXX
```

**Detection Logic:**
- URL contains `/gtag/js`
- URL contains `id=`
- Domain is NOT `googletagmanager.com`

**Event Emitted:**
```json
{
  "type": "gtag-event",
  "platform": "Gtag",
  "event": "library_load",
  "tagId": "G-XXXXX",
  "tagType": "GA4",
  "serverSide": {
    "isFirstParty": true,
    "endpoint": "gt.example.com",
    "isServerSideGTM": true
  }
}
```

**Tag Type by ID Prefix:**

| Prefix | Type |
|--------|------|
| `G-` | GA4 |
| `AW-` | Google Ads |
| `DC-` | Floodlight |
| `GT-` | Google Tag |

---

### 3. GA4 Events (`/g/collect`)

**Standard (Client-Side):**
```
https://www.google-analytics.com/g/collect?v=2&tid=G-XXXXX&en=page_view
```

**First-Party (Server-Side):**
```
https://gt.example.com/g/collect?v=2&tid=G-XXXXX&en=page_view
```

**Detection Logic:**
- URL contains `/g/collect`
- Domain is NOT `google-analytics.com` or `analytics.google.com`

**Event Emitted:**
```json
{
  "type": "ga4-event",
  "platform": "GA4",
  "event": "page_view",
  "measurementId": "G-XXXXX",
  "serverSide": {
    "isFirstParty": true,
    "endpoint": "gt.example.com",
    "isServerSideGTM": true
  }
}
```

---

## The `serverSide` Object

All detected events include a `serverSide` object:

```javascript
serverSide: {
  isFirstParty: boolean,    // true if loaded from custom domain
  endpoint: string | null,  // the custom domain (e.g., "gt.example.com")
  isServerSideGTM: boolean  // true if first-party (implies sGTM)
}
```

---

## How It Works in Practice

### Example: tyroola.com.au

Their setup:
```html
<script src="https://gt.tyroola.com.au/gtag/js?id=G-WXPR5V1KEG"></script>
<script>
  gtag('config', 'G-WXPR5V1KEG', {
    'server_container_url': 'https://gt.tyroola.com.au'
  });
</script>
```

**What we detect:**

1. **Gtag Library Load:**
```json
{
  "type": "gtag-event",
  "platform": "Gtag",
  "event": "library_load",
  "tagId": "G-WXPR5V1KEG",
  "tagType": "GA4",
  "serverSide": {
    "isFirstParty": true,
    "endpoint": "gt.tyroola.com.au",
    "isServerSideGTM": true
  }
}
```

2. **GA4 Events:**
```json
{
  "type": "ga4-event",
  "platform": "GA4",
  "event": "page_view",
  "measurementId": "G-WXPR5V1KEG",
  "serverSide": {
    "isFirstParty": true,
    "endpoint": "gt.tyroola.com.au",
    "isServerSideGTM": true
  }
}
```

---

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         BROWSER                                   │
│                                                                   │
│  1. Load gtag.js from gt.example.com/gtag/js                     │
│  2. Fire events to gt.example.com/g/collect                      │
│                                                                   │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                          │  Extension detects:
                          │  • First-party gtag load
                          │  • First-party GA4 events
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                    gt.example.com                                 │
│                  (sGTM Server)                                    │
│                                                                   │
│  Receives requests and forwards to:                               │
│  • Google Analytics                                               │
│  • Google Ads                                                     │
│  • Meta CAPI                                                      │
│  • Other destinations                                             │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
                          │
                          │  Server-to-server
                          │  (NOT visible to extension)
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│              Final Destinations                                   │
│                                                                   │
│  • google-analytics.com                                          │
│  • googleads.google.com                                          │
│  • graph.facebook.com (CAPI)                                     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## Portal Usage

### Check for First-Party Setup

```javascript
// When receiving events via WebSocket
ws.on('message', (data) => {
  const event = JSON.parse(data);

  if (event.serverSide?.isFirstParty) {
    console.log('First-party tracking detected!');
    console.log('Endpoint:', event.serverSide.endpoint);
  }
});
```

### Display Badge

```jsx
function EventBadge({ event }) {
  if (event.serverSide?.isFirstParty) {
    return <span className="badge server-side">Server-Side</span>;
  }
  return <span className="badge client-side">Client-Side</span>;
}
```

### Aggregate Detection Summary

```javascript
function getTrackingConfig(events) {
  const config = {
    gtm: { detected: false, isFirstParty: false, endpoint: null },
    gtag: { detected: false, isFirstParty: false, endpoint: null },
    ga4: { detected: false, isFirstParty: false, endpoint: null }
  };

  for (const event of events) {
    if (event.type === 'gtm-event') {
      config.gtm.detected = true;
      config.gtm.isFirstParty = event.serverSide?.isFirstParty || false;
      config.gtm.endpoint = event.serverSide?.endpoint || null;
    }

    if (event.type === 'gtag-event') {
      config.gtag.detected = true;
      config.gtag.isFirstParty = event.serverSide?.isFirstParty || false;
      config.gtag.endpoint = event.serverSide?.endpoint || null;
    }

    if (event.type === 'ga4-event') {
      config.ga4.detected = true;
      config.ga4.isFirstParty = event.serverSide?.isFirstParty || false;
      config.ga4.endpoint = event.serverSide?.endpoint || null;
    }
  }

  return config;
}
```

---

## Summary

| Detection | URL Pattern | First-Party Indicator |
|-----------|-------------|----------------------|
| GTM Container | `/gtm.js?id=GTM-*` | Domain ≠ googletagmanager.com |
| Gtag Library | `/gtag/js?id=*` | Domain ≠ googletagmanager.com |
| GA4 Events | `/g/collect` | Domain ≠ google-analytics.com |

When `serverSide.isFirstParty: true`, the site is using **server-side GTM** or a similar proxy setup to route tracking through their own domain.
