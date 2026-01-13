# Server-Side Tracking Detection

This document explains how the DART extension detects first-party and server-side tracking setups.

---

## What We Detect

The extension detects when tracking libraries and events are loaded/sent through **first-party domains** instead of directly to Google. This indicates a **server-side GTM (sGTM)** setup.

---

## Detection Overview

| Type | Standard (Direct) | First-Party (Server-Side) |
|------|-------------------|---------------------------|
| GTM Container | `googletagmanager.com/gtm.js` | `custom-domain.com/gtm.js` |
| Gtag.js Library | `googletagmanager.com/gtag/js` | `custom-domain.com/gtag/js` |
| GA4 Events | `google-analytics.com/g/collect` | `custom-domain.com/g/collect` |

---

## 1. GTM Container Detection (`/gtm.js`)

### What is it?
The GTM container is a JavaScript file that loads all your tags configured in Google Tag Manager.

### Standard Setup
```html
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXXX"></script>
```

### First-Party (Server-Side) Setup
```html
<script src="https://metrics.example.com/gtm.js?id=GTM-XXXXX"></script>
```

### How We Detect It
```javascript
// URL pattern check
if (url.includes('/gtm.js') && url.includes('id=gtm-')) {
  // Check if domain is NOT googletagmanager.com
  if (!url.includes('googletagmanager.com')) {
    return 'gtm-firstparty';  // Server-side GTM detected
  }
}
```

### Event Sent to Portal
```javascript
{
  type: 'gtm-event',
  platform: 'GTM',
  event: 'container_load',
  containerId: 'GTM-XXXXX',
  serverSide: {
    isFirstParty: true,
    endpoint: 'metrics.example.com',
    isServerSideGTM: true
  }
}
```

---

## 2. Gtag.js Library Detection (`/gtag/js`)

### What is it?
Gtag.js is Google's tag library that can be used standalone (without GTM) to send data to GA4, Google Ads, etc.

### Standard Setup
```html
<script src="https://www.googletagmanager.com/gtag/js?id=G-XXXXX"></script>
<script>
  gtag('config', 'G-XXXXX');
</script>
```

### First-Party (Server-Side) Setup
```html
<script src="https://gt.example.com/gtag/js?id=G-XXXXX"></script>
<script>
  gtag('config', 'G-XXXXX', {
    'server_container_url': 'https://gt.example.com'
  });
</script>
```

### How We Detect It
```javascript
// URL pattern check
if (url.includes('/gtag/js') && url.includes('id=')) {
  // Check if domain is NOT googletagmanager.com
  if (!url.includes('googletagmanager.com')) {
    return 'gtag-firstparty';  // Server-side gtag detected
  }
}
```

### Event Sent to Portal
```javascript
{
  type: 'gtag-event',
  platform: 'Gtag',
  event: 'library_load',
  tagId: 'G-XXXXX',
  tagType: 'GA4',  // Determined from ID prefix
  serverSide: {
    isFirstParty: true,
    endpoint: 'gt.example.com',
    isServerSideGTM: true
  }
}
```

### Tag Type Detection
The `tagId` prefix tells us what type of tag:

| Prefix | Tag Type |
|--------|----------|
| `G-` | GA4 |
| `AW-` | Google Ads |
| `DC-` | Floodlight |
| `GT-` | Google Tag |

---

## 3. GA4 Event Detection (`/g/collect`)

### What is it?
GA4 events (page views, purchases, etc.) are sent to a collection endpoint.

### Standard Setup
Events go directly to Google:
```
https://www.google-analytics.com/g/collect?v=2&tid=G-XXXXX&en=page_view...
```

### First-Party (Server-Side) Setup
Events go to custom domain first:
```
https://gt.example.com/g/collect?v=2&tid=G-XXXXX&en=page_view...
```

### How We Detect It
```javascript
// Check for /g/collect pattern
if (url.includes('/g/collect')) {
  // If NOT google-analytics.com or analytics.google.com
  if (!url.includes('google-analytics.com') && !url.includes('analytics.google.com')) {
    return 'ga4-firstparty';
  }
}
```

### Event Sent to Portal
```javascript
{
  type: 'ga4-event',
  platform: 'GA4',
  event: 'page_view',
  measurementId: 'G-XXXXX',
  serverSide: {
    isFirstParty: true,
    endpoint: 'gt.example.com',
    transportUrl: 'https://gt.example.com',  // If present in params
    hasTransportUrl: true,
    isServerSideGTM: true
  }
}
```

---

## Understanding the Flow

### Standard (Client-Side) Flow
```
Browser  ──────────────────────►  google-analytics.com
                                  googletagmanager.com
                                  facebook.com/tr
```
- Direct requests to vendor domains
- Easily blocked by ad blockers
- Third-party cookies

### Server-Side GTM Flow
```
Browser  ───►  gt.example.com  ───►  Google Analytics
               (sGTM Server)   ───►  Google Ads
                               ───►  Meta CAPI
                               ───►  etc.
```
- Requests go to first-party domain
- Bypasses most ad blockers
- First-party cookies
- Server can enrich/filter data

---

## What We CAN vs CANNOT Detect

### ✅ CAN Detect (Browser-Side)
| Detection | How |
|-----------|-----|
| GTM loaded from first-party | `/gtm.js` on custom domain |
| Gtag loaded from first-party | `/gtag/js` on custom domain |
| GA4 events to first-party | `/g/collect` on custom domain |
| `transport_url` configured | Parameter in GA4 request |

### ❌ CANNOT Detect (Server-Side)
| Not Detectable | Why |
|----------------|-----|
| sGTM → Google Analytics | Server-to-server, invisible |
| sGTM → Meta CAPI | Server-to-server, invisible |
| Server-side enrichment | Happens after browser request |
| Events without browser component | Never touches browser |

---

## Portal Implementation

### Display Server-Side Badge
When `serverSide.isFirstParty === true`, show a badge:

```jsx
{event.serverSide?.isFirstParty && (
  <span className="badge sgtm">Server-Side</span>
)}
```

### Tracking Configuration Panel
Aggregate detections to show setup summary:

```jsx
<div className="config-panel">
  <h3>Tracking Setup Detected</h3>

  {gtmFirstParty && (
    <div className="config-item">
      <span className="badge">GTM (Server-Side)</span>
      <span>Loaded from: {gtmEndpoint}</span>
    </div>
  )}

  {gtagFirstParty && (
    <div className="config-item">
      <span className="badge">Gtag (Server-Side)</span>
      <span>Endpoint: {gtagEndpoint}</span>
    </div>
  )}

  {ga4FirstParty && (
    <div className="config-item">
      <span className="badge">GA4 (First-Party)</span>
      <span>Events to: {ga4Endpoint}</span>
    </div>
  )}
</div>
```

---

## Summary

The extension detects **first-party setups** by checking if tracking requests go to custom domains instead of standard Google/vendor domains.

When `serverSide.isFirstParty: true`:
- The site is using **server-side GTM** or a similar proxy setup
- Tracking is routed through their own domain
- Server forwards data to final destinations (invisible to us)

This detection helps identify advanced tracking implementations that bypass ad blockers and use first-party cookies.
