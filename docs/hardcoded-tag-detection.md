# Hardcoded Tag Detection

This document explains how the DART extension detects hardcoded tracking tags in page HTML and how the portal should handle this data.

---

## Overview

The extension scans each page's HTML to detect tracking tags that are hardcoded directly into the page source. This provides visibility into the site's tracking implementation without relying on network requests.

---

## What We Detect

| Platform | Detection Pattern | Data Extracted |
|----------|-------------------|----------------|
| **Gtag** | `gtag('config', ...)` | Tag ID, type, server_container_url, enhanced conversions |
| **GTM** | `GTM-XXXXX` in HTML | Container ID, endpoint, first-party status |
| **Meta Pixel** | `fbq('init', ...)` | Pixel ID |
| **TikTok Pixel** | `ttq.load(...)` | Pixel ID |
| **Google Ads** | `AW-XXXXX` patterns | Conversion ID, conversion label |

---

## Message Format

When hardcoded tags are detected, the extension sends this message to the portal:

```json
{
  "type": "hardcoded-tags",
  "platform": "Hardcoded Tags",
  "event": "page_scan",
  "detections": {
    "gtag": [...],
    "gtm": [...],
    "meta": [...],
    "tiktok": [...],
    "gads": [...]
  },
  "pageLocation": "https://example.com/page",
  "pageTitle": "Page Title",
  "timestamp": "2025-01-14T10:30:00.000Z",
  "source": "content-script"
}
```

---

## Detection Details

### 1. Gtag Detection

Detects `gtag('config', ...)` calls and gtag.js script loading.

**Detection Patterns:**
```javascript
// Config calls
gtag('config', 'G-XXXXX')
gtag('config', 'G-XXXXX', { server_container_url: 'https://gt.example.com' })

// Script loading
<script src="https://www.googletagmanager.com/gtag/js?id=G-XXXXX"></script>
<script src="https://gt.example.com/gtag/js?id=G-XXXXX"></script>
```

**Output Format:**
```json
{
  "tagId": "G-WXPR5V1KEG",
  "type": "GA4",
  "raw": "gtag('config', 'G-WXPR5V1KEG', {...})",
  "serverContainerUrl": "https://gt.example.com",
  "isServerSide": true,
  "enhancedConversions": true,
  "sendPageView": false,
  "scriptEndpoint": "gt.example.com",
  "isFirstParty": true
}
```

**Tag Type by ID Prefix:**

| Prefix | Type |
|--------|------|
| `G-` | GA4 |
| `AW-` | Google Ads |
| `DC-` | Floodlight |
| `GT-` | Google Tag |
| `GTM-` | GTM |

---

### 2. GTM Container Detection

Detects GTM container IDs in the page HTML.

**Detection Pattern:**
```javascript
// Regex: GTM-[A-Z0-9]+
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXXX"></script>
<script src="https://metrics.example.com/gtm.js?id=GTM-XXXXX"></script>
```

**Output Format:**
```json
{
  "containerId": "GTM-XXXXX",
  "endpoint": "metrics.example.com",
  "isFirstParty": true
}
```

---

### 3. Meta Pixel Detection

Detects Meta (Facebook) Pixel initialization calls.

**Detection Patterns:**
```javascript
fbq('init', '123456789')
fbq.push(['init', '123456789'])
_fbq.push(['init', '123456789'])
```

**Output Format:**
```json
{
  "pixelId": "123456789",
  "raw": "fbq('init', '123456789')"
}
```

---

### 4. TikTok Pixel Detection

Detects TikTok Pixel load calls.

**Detection Patterns:**
```javascript
ttq.load('ABC123')
ttq.instance('ABC123')
```

**Output Format:**
```json
{
  "pixelId": "ABC123",
  "raw": "ttq.load('ABC123')"
}
```

---

### 5. Google Ads Detection

Detects Google Ads conversion IDs in script content.

**Detection Patterns:**
```javascript
// Conversion IDs
'AW-123456789'
'AW-123456789/AbCdEfGhI'
gtag('config', 'AW-123456789')
```

**Output Format:**
```json
{
  "conversionId": "AW-123456789",
  "conversionLabel": "AbCdEfGhI"
}
```

---

## Portal Implementation

### Receiving Hardcoded Tags

```javascript
ws.on('message', (data) => {
  const event = JSON.parse(data);

  if (event.type === 'hardcoded-tags') {
    const { detections, pageLocation, pageTitle } = event;

    // Process each platform
    if (detections.gtag.length > 0) {
      console.log('Gtag configs found:', detections.gtag);
    }

    if (detections.gtm.length > 0) {
      console.log('GTM containers found:', detections.gtm);
    }

    if (detections.meta.length > 0) {
      console.log('Meta pixels found:', detections.meta);
    }

    if (detections.tiktok.length > 0) {
      console.log('TikTok pixels found:', detections.tiktok);
    }

    if (detections.gads.length > 0) {
      console.log('Google Ads IDs found:', detections.gads);
    }
  }
});
```

### Display Configuration Summary

```jsx
function HardcodedTagsSummary({ detections }) {
  return (
    <div className="hardcoded-summary">
      <h3>Hardcoded Tags Detected</h3>

      {detections.gtag.map((tag, i) => (
        <div key={i} className="tag-item">
          <span className="tag-type">{tag.type}</span>
          <span className="tag-id">{tag.tagId}</span>
          {tag.isServerSide && <span className="badge">Server-Side</span>}
          {tag.enhancedConversions && <span className="badge">Enhanced Conversions</span>}
        </div>
      ))}

      {detections.gtm.map((gtm, i) => (
        <div key={i} className="tag-item">
          <span className="tag-type">GTM</span>
          <span className="tag-id">{gtm.containerId}</span>
          {gtm.isFirstParty && <span className="badge">First-Party</span>}
        </div>
      ))}

      {detections.meta.map((pixel, i) => (
        <div key={i} className="tag-item">
          <span className="tag-type">Meta Pixel</span>
          <span className="tag-id">{pixel.pixelId}</span>
        </div>
      ))}

      {detections.tiktok.map((pixel, i) => (
        <div key={i} className="tag-item">
          <span className="tag-type">TikTok</span>
          <span className="tag-id">{pixel.pixelId}</span>
        </div>
      ))}

      {detections.gads.map((ad, i) => (
        <div key={i} className="tag-item">
          <span className="tag-type">Google Ads</span>
          <span className="tag-id">{ad.conversionId}</span>
          {ad.conversionLabel && <span className="label">{ad.conversionLabel}</span>}
        </div>
      ))}
    </div>
  );
}
```

### Aggregate Data Across Pages

```javascript
class HardcodedTagsStore {
  constructor() {
    this.gtag = new Map();  // tagId -> config
    this.gtm = new Map();   // containerId -> config
    this.meta = new Map();  // pixelId -> config
    this.tiktok = new Map();
    this.gads = new Map();
  }

  addDetections(detections, pageUrl) {
    // Merge gtag configs
    for (const tag of detections.gtag) {
      const existing = this.gtag.get(tag.tagId) || { pages: [] };
      this.gtag.set(tag.tagId, {
        ...existing,
        ...tag,
        pages: [...new Set([...existing.pages, pageUrl])]
      });
    }

    // Merge GTM containers
    for (const gtm of detections.gtm) {
      const existing = this.gtm.get(gtm.containerId) || { pages: [] };
      this.gtm.set(gtm.containerId, {
        ...existing,
        ...gtm,
        pages: [...new Set([...existing.pages, pageUrl])]
      });
    }

    // Similar for other platforms...
  }

  getSummary() {
    return {
      gtag: Array.from(this.gtag.values()),
      gtm: Array.from(this.gtm.values()),
      meta: Array.from(this.meta.values()),
      tiktok: Array.from(this.tiktok.values()),
      gads: Array.from(this.gads.values())
    };
  }
}
```

---

## Key Insights from Hardcoded Tags

### Server-Side Setup Detection

When `isServerSide: true` or `isFirstParty: true`:
- Site is using server-side GTM (sGTM)
- Events are routed through custom domain
- Look for `serverContainerUrl` for the endpoint

### Enhanced Conversions

When `enhancedConversions: true`:
- Site has enabled Google's Enhanced Conversions
- User data (email, phone) may be hashed and sent

### Multiple Configurations

If multiple gtag configs are found for the same ID:
- Could indicate duplicate tracking
- Could be intentional multi-property setup

### First-Party GTM

When `gtm.isFirstParty: true`:
- GTM container is loaded from custom domain
- Indicates sGTM setup

---

## Example: Full Detection

For a site like `tyroola.com.au` with sGTM setup:

```json
{
  "type": "hardcoded-tags",
  "detections": {
    "gtag": [
      {
        "tagId": "G-WXPR5V1KEG",
        "type": "GA4",
        "serverContainerUrl": "https://gt.tyroola.com.au",
        "isServerSide": true,
        "scriptEndpoint": "gt.tyroola.com.au",
        "isFirstParty": true
      }
    ],
    "gtm": [],
    "meta": [
      {
        "pixelId": "123456789"
      }
    ],
    "tiktok": [],
    "gads": [
      {
        "conversionId": "AW-123456789",
        "conversionLabel": "AbCdEfGhI"
      }
    ]
  },
  "pageLocation": "https://www.tyroola.com.au/",
  "pageTitle": "Tyroola - Cheap Tyres Online"
}
```

---

## Summary

| Detection | Source | Key Fields |
|-----------|--------|------------|
| Gtag Config | `gtag('config')` | tagId, type, serverContainerUrl, enhancedConversions |
| Gtag Script | `gtag/js?id=` | tagId, scriptEndpoint, isFirstParty |
| GTM | `GTM-XXXXX` | containerId, endpoint, isFirstParty |
| Meta | `fbq('init')` | pixelId |
| TikTok | `ttq.load()` | pixelId |
| Google Ads | `AW-XXXXX` | conversionId, conversionLabel |

The hardcoded tag detection complements network request monitoring by showing what's configured in the page source, even before any requests are made.
