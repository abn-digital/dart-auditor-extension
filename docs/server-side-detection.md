# Server-Side Tracking Detection

This document explains how the DART extension detects first-party and server-side tracking setups, and how the portal can use this information.

## Overview

The extension now includes a `serverSide` object in all events that indicates:
- First-party endpoint usage (custom domains proxying tracking)
- Server-side GTM indicators
- CAPI/Events API deduplication setup

---

## Event Structure

All events now include a `serverSide` object:

```javascript
{
  type: 'ga4-event',
  platform: 'GA4',
  event: 'purchase',
  // ... other fields ...

  serverSide: {
    isFirstParty: true,
    endpoint: 'sgtm.example.com',
    transportUrl: 'https://sgtm.example.com/g/collect',
    hasTransportUrl: true,
    isServerSideGTM: true
  }
}
```

---

## Platform-Specific Detection

### GA4 Events

```javascript
serverSide: {
  isFirstParty: boolean,      // True if endpoint is not google-analytics.com
  endpoint: string | null,    // Custom endpoint hostname (if first-party)
  transportUrl: string | null,// Value of transport_url parameter
  hasTransportUrl: boolean,   // True if transport_url is present
  isServerSideGTM: boolean    // True if transport_url points to custom domain
}
```

**Detection Logic:**
- `isFirstParty`: Request goes to a domain other than `google-analytics.com` or `analytics.google.com`
- `isServerSideGTM`: The `transport_url` parameter points to a non-Google domain

**Example First-Party GA4:**
```
https://sgtm.example.com/g/collect?v=2&tid=G-XXXXX&...
```

### GTM Container Load

```javascript
serverSide: {
  isFirstParty: boolean,      // True if loaded from custom domain
  endpoint: string | null,    // Custom endpoint hostname
  isServerSideGTM: boolean    // True if first-party (implies sGTM)
}
```

**Detection Logic:**
- `isFirstParty`: GTM container loaded from domain other than `googletagmanager.com`

**Example First-Party GTM:**
```
https://metrics.example.com/gtm.js?id=GTM-XXXXX
```

### Meta Pixel

```javascript
serverSide: {
  isFirstParty: false,        // Meta doesn't support first-party
  hasEventId: boolean,        // True if event_id/eid present
  eventId: string | null,     // The event ID value
  hasExternalId: boolean,     // True if external_id present
  capiConfigured: boolean     // True if eventId present (deduplication)
}
```

**Detection Logic:**
- `capiConfigured`: The `eid` or `eventID` parameter is present, indicating the browser event has a matching server-side CAPI event for deduplication

**Example with CAPI deduplication:**
```
https://www.facebook.com/tr?ev=Purchase&eid=abc123-unique-id&...
```

### TikTok Pixel

```javascript
serverSide: {
  isFirstParty: false,        // TikTok doesn't support first-party
  hasEventId: boolean,        // True if event_id present
  eventId: string | null,     // The event ID value
  eventsApiConfigured: boolean// True if eventId present
}
```

---

## Portal Implementation

### Displaying Server-Side Status

```jsx
function EventCard({ event }) {
  const { serverSide } = event;

  return (
    <div className="event-card">
      <div className="event-header">
        <span className="platform">{event.platform}</span>
        <span className="event-name">{event.event}</span>

        {/* Server-side badges */}
        {serverSide?.isFirstParty && (
          <span className="badge first-party">1st Party</span>
        )}
        {serverSide?.isServerSideGTM && (
          <span className="badge sgtm">sGTM</span>
        )}
        {serverSide?.capiConfigured && (
          <span className="badge capi">CAPI</span>
        )}
      </div>

      {serverSide?.endpoint && (
        <div className="endpoint">
          Endpoint: {serverSide.endpoint}
        </div>
      )}
    </div>
  );
}
```

### CSS for Badges

```css
.badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: bold;
  margin-left: 4px;
}

.badge.first-party {
  background: #8b5cf6;
  color: white;
}

.badge.sgtm {
  background: #06b6d4;
  color: white;
}

.badge.capi {
  background: #f59e0b;
  color: white;
}
```

### Tracking Configuration Summary

Aggregate server-side detection across events to show a summary:

```javascript
function analyzeTrackingConfig(events) {
  const config = {
    ga4: {
      detected: false,
      isFirstParty: false,
      endpoint: null,
      isServerSideGTM: false
    },
    gtm: {
      detected: false,
      isFirstParty: false,
      endpoint: null
    },
    meta: {
      detected: false,
      capiConfigured: false
    },
    tiktok: {
      detected: false,
      eventsApiConfigured: false
    }
  };

  for (const event of events) {
    if (event.platform === 'GA4') {
      config.ga4.detected = true;
      if (event.serverSide?.isFirstParty) {
        config.ga4.isFirstParty = true;
        config.ga4.endpoint = event.serverSide.endpoint;
      }
      if (event.serverSide?.isServerSideGTM) {
        config.ga4.isServerSideGTM = true;
      }
    }

    if (event.platform === 'GTM') {
      config.gtm.detected = true;
      if (event.serverSide?.isFirstParty) {
        config.gtm.isFirstParty = true;
        config.gtm.endpoint = event.serverSide.endpoint;
      }
    }

    if (event.platform === 'Meta Pixel') {
      config.meta.detected = true;
      if (event.serverSide?.capiConfigured) {
        config.meta.capiConfigured = true;
      }
    }

    if (event.platform === 'TikTok Pixel') {
      config.tiktok.detected = true;
      if (event.serverSide?.eventsApiConfigured) {
        config.tiktok.eventsApiConfigured = true;
      }
    }
  }

  return config;
}
```

### Configuration Panel UI

```jsx
function TrackingConfigPanel({ config }) {
  return (
    <div className="config-panel">
      <h3>Tracking Configuration</h3>

      {config.ga4.detected && (
        <div className="config-item">
          <span className="platform-icon ga4">GA4</span>
          <div className="config-details">
            {config.ga4.isFirstParty ? (
              <>
                <span className="badge first-party">First-Party</span>
                <span className="endpoint">{config.ga4.endpoint}</span>
              </>
            ) : (
              <span className="badge standard">Standard</span>
            )}
            {config.ga4.isServerSideGTM && (
              <span className="badge sgtm">Server-Side GTM</span>
            )}
          </div>
        </div>
      )}

      {config.gtm.detected && (
        <div className="config-item">
          <span className="platform-icon gtm">GTM</span>
          <div className="config-details">
            {config.gtm.isFirstParty ? (
              <>
                <span className="badge first-party">First-Party</span>
                <span className="endpoint">{config.gtm.endpoint}</span>
              </>
            ) : (
              <span className="badge standard">Standard</span>
            )}
          </div>
        </div>
      )}

      {config.meta.detected && (
        <div className="config-item">
          <span className="platform-icon meta">Meta</span>
          <div className="config-details">
            {config.meta.capiConfigured ? (
              <span className="badge capi">CAPI Configured</span>
            ) : (
              <span className="badge standard">Browser Only</span>
            )}
          </div>
        </div>
      )}

      {config.tiktok.detected && (
        <div className="config-item">
          <span className="platform-icon tiktok">TikTok</span>
          <div className="config-details">
            {config.tiktok.eventsApiConfigured ? (
              <span className="badge capi">Events API Configured</span>
            ) : (
              <span className="badge standard">Browser Only</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## What Can vs Cannot Be Detected

### ✅ CAN Detect (Browser-Side)

| Setup | How It's Detected |
|-------|-------------------|
| First-party GTM | `gtm.js` loaded from custom domain |
| First-party GA4 endpoint | `/g/collect` requests to custom domain |
| Server-side GTM endpoint | `transport_url` parameter pointing to custom domain |
| Meta CAPI deduplication | `eventID`/`eid` parameter present |
| TikTok Events API dedup | `event_id` in request body |

### ❌ CANNOT Detect (Server-to-Server)

| Setup | Why Not Detectable |
|-------|-------------------|
| Actual CAPI server calls | Server-to-server, no browser visibility |
| Server-side enrichment | Happens on server after browser event |
| Data forwarding from sGTM | Server-side routing decisions |
| Enhanced conversions data | Server-side matching |

---

## Summary

The `serverSide` object provides visibility into tracking configurations that can be detected from the browser. While it cannot see actual server-to-server communication, it can identify:

1. **First-party setups** - Custom domain proxying
2. **Server-side GTM** - Custom transport URLs
3. **CAPI/Events API** - Deduplication IDs indicate server-side is configured

This allows the portal to show users a "Tracking Health" or "Configuration" panel indicating what advanced tracking setups are in place.
