// DART Event Auditor - Background Service Worker
// Captures GA4, Meta Pixel, Google Ads, and TikTok Pixel events

const WS_URL = 'ws://127.0.0.1:3001';

let ws = null;
let isConnected = false;
let targetDomain = null;
let connectionCount = 1;
let isPrimaryConnection = true;

// ============================================
// Domain Matching Helper
// ============================================
function matchesDomain(eventUrl, targetDomain) {
  if (!targetDomain) return false;
  try {
    const eventHost = new URL(eventUrl).hostname.replace(/^www\./, '').toLowerCase();
    const target = targetDomain.replace(/^www\./, '').toLowerCase();
    return eventHost === target || eventHost.endsWith('.' + target);
  } catch {
    return false;
  }
}

// ============================================
// First-Party / Server-Side Detection Helpers
// ============================================
const GOOGLE_DOMAINS = [
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'google.com'
];

const META_DOMAINS = [
  'facebook.com',
  'facebook.net',
  'fb.com'
];

const TIKTOK_DOMAINS = [
  'tiktok.com',
  'analytics.tiktok.com'
];

function isFirstPartyDomain(url, standardDomains) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return !standardDomains.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

function getEndpointHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// ============================================
// Platform Detection (includes first-party)
// ============================================
function detectPlatform(url) {
  const urlLower = url.toLowerCase();

  // GA4 - Standard endpoints
  if (urlLower.includes('google-analytics.com/g/collect') ||
      urlLower.includes('analytics.google.com/g/collect')) {
    return 'ga4';
  }

  // GA4 - First-party endpoint (any domain with /g/collect pattern)
  if (urlLower.includes('/g/collect')) {
    return 'ga4-firstparty';
  }

  // Meta Pixel - Standard endpoints
  if (urlLower.includes('facebook.com/tr') || urlLower.includes('facebook.net/tr')) {
    return 'meta';
  }

  // Google Ads - conversion endpoints only
  if (
      urlLower.includes('googleadservices.com/pagead/conversion') ||
      urlLower.includes('googleads.g.doubleclick.net/pagead/conversion') ||
      urlLower.includes('doubleclick.net/pagead/conversion') ||
      urlLower.includes('google.com/pagead/conversion') ||
      urlLower.includes('google.com/pagead/1p-conversion') ||
      urlLower.includes('googlesyndication.com/pagead/conversion')
  ) {
    return 'gads';
  }

  // TikTok Pixel - Standard
  if (urlLower.includes('analytics.tiktok.com/api/v2/pixel')) {
    return 'tiktok';
  }

  // GTM Container - Standard
  if (urlLower.includes('googletagmanager.com/gtm.js')) {
    return 'gtm';
  }

  // GTM Container - First-party (any domain with /gtm.js pattern)
  if (urlLower.includes('/gtm.js') && urlLower.includes('id=gtm-')) {
    return 'gtm-firstparty';
  }

  return null;
}

// ============================================
// GA4 Parser
// ============================================
function parseGA4Event(url, requestBody, isFirstParty = false) {
  const params = {};

  try {
    const urlObj = new URL(url);
    for (const [k, v] of urlObj.searchParams) {
      params[k] = v;
    }
  } catch (e) {}

  // Parse POST body (newline-separated key=value pairs)
  if (requestBody) {
    try {
      const lines = requestBody.split('\n');
      for (const line of lines) {
        if (line.includes('=')) {
          for (const [k, v] of new URLSearchParams(line)) {
            params[k] = v;
          }
        }
      }
    } catch (e) {}
  }

  // Detect server-side indicators
  const endpoint = getEndpointHost(url);
  const hasTransportUrl = !!params.transport_url;
  const transportUrl = params.transport_url || null;

  // Build serverSide detection object
  const serverSide = {
    isFirstParty: isFirstParty,
    endpoint: isFirstParty ? endpoint : null,
    transportUrl: transportUrl,
    hasTransportUrl: hasTransportUrl,
    // If transport_url points to a custom domain, it's server-side GTM
    isServerSideGTM: hasTransportUrl && isFirstPartyDomain(transportUrl, GOOGLE_DOMAINS)
  };

  return {
    type: 'ga4-event',
    platform: 'GA4',
    event: params.en || 'page_view',
    measurementId: params.tid || null,
    pageLocation: params.dl || null,
    value: params['epn.value'] || params.value || null,
    currency: params.cu || null,
    serverSide: serverSide,
    raw: params
  };
}

// ============================================
// Meta Pixel Parser
// ============================================
function parseMetaEvent(url, requestBody) {
  const params = {};

  try {
    const urlObj = new URL(url);
    for (const [k, v] of urlObj.searchParams) {
      params[k] = v;
    }
  } catch (e) {
    console.log('[DART Auditor] Meta URL parse error:', e);
  }

  // Parse POST body if present
  if (requestBody) {
    try {
      for (const [k, v] of new URLSearchParams(requestBody)) {
        params[k] = v;
      }
    } catch (e) {}
  }

  const eventName = params.ev || null;
  console.log('[DART Auditor] Meta parsed - ev:', eventName, 'id:', params.id, 'dl:', params.dl);

  // Skip EnrichAM events
  if (eventName === 'EnrichAM') {
    console.log('[DART Auditor] Skipping EnrichAM event');
    return null;
  }

  // Detect CAPI indicators
  // eventID/eid is used for deduplication between browser and server events
  const eventId = params.eid || params.eventID || params.event_id || null;
  const hasEventId = !!eventId;

  // External ID indicates user matching for CAPI
  const externalId = params.external_id || params.extern_id || null;
  const hasExternalId = !!externalId;

  // Build serverSide detection object
  const serverSide = {
    isFirstParty: false, // Meta doesn't support first-party endpoints
    hasEventId: hasEventId,
    eventId: eventId,
    hasExternalId: hasExternalId,
    // If eventID is present, CAPI is likely configured for deduplication
    capiConfigured: hasEventId
  };

  return {
    type: 'meta-event',
    platform: 'Meta Pixel',
    event: eventName || 'PageView',
    pixelId: params.id || null,
    pageLocation: params.dl || null,
    value: params.value || null,
    currency: params.currency || params.cd_currency || null,
    serverSide: serverSide,
    raw: params
  };
}

// ============================================
// Google Ads Parser
// ============================================
function parseGoogleAdsEvent(url) {
  const params = {};
  let conversionId = null;
  let conversionType = 'Conversion';

  try {
    const urlObj = new URL(url);
    const urlLower = url.toLowerCase();

    // Extract conversion ID from path - multiple patterns
    const pathMatch = url.match(/\/conversion\/(\d+)/) ||
                      url.match(/\/viewthroughconversion\/(\d+)/) ||
                      url.match(/\/1p-conversion\/(\d+)/) ||
                      url.match(/\/1p-user-list\/(\d+)/);
    if (pathMatch) {
      conversionId = pathMatch[1];
    }

    // Also check query params for conversion ID
    for (const [k, v] of urlObj.searchParams) {
      params[k] = v;
    }

    // Fallback: get conversion ID from params
    if (!conversionId) {
      conversionId = params.id || params.awid || null;
    }

    // Determine conversion type based on URL patterns
    if (urlLower.includes('1p-conversion')) {
      conversionType = '1P Conversion';
    }

    // Extract value - check multiple param names
    const value = params.value || params.v || params.pv || null;

    // Extract currency - check multiple param names
    const currency = params.currency || params.c || 'USD';

    // Extract transaction ID - check multiple param names
    const transactionId = params.oid || params.order_id || params.transaction_id || params.tid || null;

    // Extract label - check multiple param names
    const label = params.label || params.l || null;

  } catch (e) {
    console.log('[DART Auditor] GAds URL parse error:', e);
  }

  // Re-extract values after try block (needed for scope)
  const value = params.value || params.v || params.pv || null;
  const currency = params.currency_code || params.currency || params.c || null;
  const transactionId = params.oid || params.order_id || params.transaction_id || params.tid || null;
  const label = params.label || params.l || null;

  // bttype indicates the business event type (purchase, lead, etc.)
  const businessType = params.bttype || null;

  // Format event name as "Conversion: {label}" - label is what makes conversions unique
  const eventName = label ? `Conversion: ${label}` : 'Conversion';

  // Page title from tiba parameter
  const pageTitle = params.tiba ? decodeURIComponent(params.tiba.replace(/\+/g, ' ')) : null;

  console.log('[DART Auditor] GAds parsed - type:', eventName, 'conversionId:', conversionId, 'label:', label, 'value:', value, 'currency:', currency);

  // Build serverSide detection object
  const serverSide = {
    isFirstParty: false,
    // Google Ads conversions are typically not first-party proxied
    endpoint: null
  };

  return {
    type: 'gads-event',
    platform: 'Google Ads',
    event: eventName,
    conversionId: conversionId,
    conversionLabel: label,
    conversionType: conversionType,
    businessType: businessType,
    pageLocation: params.url || params.ref || params.dl || null,
    pageTitle: pageTitle,
    value: value ? parseFloat(value) : null,
    currency: currency,
    transactionId: transactionId,
    serverSide: serverSide,
    rawUrl: url,
    raw: params
  };
}

// ============================================
// TikTok Pixel Parser
// ============================================
function parseTikTokEvent(url, requestBody) {
  const urlParams = {};
  let bodyData = {};

  try {
    const urlObj = new URL(url);
    for (const [k, v] of urlObj.searchParams) {
      urlParams[k] = v;
    }
  } catch (e) {}

  // Parse JSON POST body
  if (requestBody) {
    try {
      bodyData = JSON.parse(requestBody);
    } catch (e) {}
  }

  // Extract pixel ID from body or URL
  let pixelId = urlParams.sdkid || null;
  if (bodyData.context?.pixel?.code) {
    pixelId = bodyData.context.pixel.code;
  }

  // TikTok Events API detection (similar to Meta CAPI)
  // event_id is used for deduplication with server-side events
  const eventId = bodyData.event_id || bodyData.properties?.event_id || null;
  const hasEventId = !!eventId;

  // Build serverSide detection object
  const serverSide = {
    isFirstParty: false,
    hasEventId: hasEventId,
    eventId: eventId,
    // If event_id is present, TikTok Events API is likely configured
    eventsApiConfigured: hasEventId
  };

  return {
    type: 'tiktok-event',
    platform: 'TikTok Pixel',
    event: bodyData.event || 'PageView',
    pixelId: pixelId,
    pageLocation: bodyData.context?.page?.url || null,
    value: bodyData.properties?.value || null,
    currency: bodyData.properties?.currency || null,
    serverSide: serverSide,
    raw: { ...urlParams, body: bodyData }
  };
}

// ============================================
// GTM Parser
// ============================================
function parseGTMEvent(url, isFirstParty = false) {
  try {
    const urlObj = new URL(url);
    const containerId = urlObj.searchParams.get('id') || null;
    const endpoint = getEndpointHost(url);

    // Build serverSide detection object
    const serverSide = {
      isFirstParty: isFirstParty,
      endpoint: isFirstParty ? endpoint : null,
      // First-party GTM typically indicates server-side GTM setup
      isServerSideGTM: isFirstParty
    };

    return {
      type: 'gtm-event',
      platform: 'GTM',
      event: 'container_load',
      containerId: containerId,
      pageLocation: null,
      serverSide: serverSide,
      raw: { id: containerId, endpoint: endpoint }
    };
  } catch (e) {
    return null;
  }
}

// ============================================
// WebSocket Connection
// ============================================
function connectToPortal() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      isConnected = true;
      console.log('[DART Auditor] Connected to portal');
      chrome.storage.local.set({ connected: true });
      broadcastStatus();

      // Send extension version to portal
      const manifest = chrome.runtime.getManifest();
      ws.send(JSON.stringify({
        type: 'extension-version',
        version: manifest.version
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[DART Auditor] Received:', data);

        // Handle set-target-domain message
        if (data.type === 'set-target-domain') {
          targetDomain = data.domain;
          console.log('[DART Auditor] Target domain set:', targetDomain);
          chrome.storage.local.set({ targetDomain });
          broadcastStatus();
        }

        // Handle clear-target-domain message
        if (data.type === 'clear-target-domain') {
          targetDomain = null;
          console.log('[DART Auditor] Target domain cleared');
          chrome.storage.local.set({ targetDomain: null });
          broadcastStatus();
        }

        // Legacy support for action-based messages
        if (data.action === 'start') {
          targetDomain = data.domain;
          chrome.storage.local.set({ targetDomain });
          broadcastStatus();
        }

        if (data.action === 'stop') {
          targetDomain = null;
          chrome.storage.local.set({ targetDomain: null });
          broadcastStatus();
        }

        // Handle connection count from server
        if (data.type === 'connection-count') {
          connectionCount = data.count || 1;
          isPrimaryConnection = data.isPrimary !== false;
          console.log('[DART Auditor] Connection count:', connectionCount, 'Primary:', isPrimaryConnection);
          chrome.storage.local.set({ connectionCount, isPrimaryConnection });
          broadcastStatus();
        }
      } catch (e) {
        console.log('[DART Auditor] Parse error:', e);
      }
    };

    ws.onclose = () => {
      isConnected = false;
      console.log('[DART Auditor] Disconnected from portal');
      chrome.storage.local.set({ connected: false });
      broadcastStatus();
      // Reconnect after 3 seconds
      setTimeout(connectToPortal, 3000);
    };

    ws.onerror = (error) => {
      console.log('[DART Auditor] WebSocket error:', error);
      isConnected = false;
    };

  } catch (e) {
    console.log('[DART Auditor] Connection failed:', e);
    setTimeout(connectToPortal, 3000);
  }
}

// Broadcast status to popup
function broadcastStatus() {
  chrome.runtime.sendMessage({
    type: 'status',
    connected: isConnected,
    targetDomain: targetDomain,
    connectionCount: connectionCount,
    isPrimaryConnection: isPrimaryConnection
  }).catch(() => {}); // Ignore if popup not open
}

// ============================================
// Send Event to Portal
// ============================================
function sendEventToPortal(eventData, initiator) {
  // Block events if this is not the primary connection
  if (!isPrimaryConnection) {
    console.log('[DART Auditor] Blocked - secondary connection');
    return;
  }

  // Check domain filter
  const pageUrl = eventData.pageLocation || initiator || '';

  console.log('[DART Auditor] Processing event:', eventData.platform, eventData.event, 'pageUrl:', pageUrl, 'targetDomain:', targetDomain);

  if (targetDomain && !matchesDomain(pageUrl, targetDomain)) {
    console.log('[DART Auditor] Filtered out - domain mismatch');
    return; // Skip - doesn't match target domain
  }

  // If no target domain set, optionally skip all events
  if (!targetDomain) {
    console.log('[DART Auditor] Filtered out - no target domain set');
    return; // Don't send events if no target domain is set
  }

  // Build the event payload
  const payload = {
    ...eventData,
    initiator: initiator,
    timestamp: new Date().toISOString(),
    source: 'extension'
  };

  console.log('[DART Auditor] Sending:', payload.platform, payload.event);

  // Send via WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }

  // Notify popup
  chrome.runtime.sendMessage({
    type: 'event',
    event: payload
  }).catch(() => {});

  // Poll dataLayer after sending event (catches associated dataLayer pushes)
  pollDataLayerAllTabs();
}

// ============================================
// Web Request Listener
// ============================================
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Log all tracking-related requests for debugging
    const url = details.url.toLowerCase();
    if (url.includes('facebook') || url.includes('google') || url.includes('tiktok') ||
        url.includes('doubleclick') || url.includes('analytics')) {
      console.log('[DART Auditor] Request detected:', details.url.substring(0, 100));
    }

    const platform = detectPlatform(details.url);
    if (!platform) return;

    console.log('[DART Auditor] Platform matched:', platform, details.url.substring(0, 80));

    const initiator = details.initiator || details.documentUrl || '';

    // Parse request body if available
    let requestBody = null;
    if (details.requestBody) {
      if (details.requestBody.raw) {
        const decoder = new TextDecoder('utf-8');
        requestBody = details.requestBody.raw.map(part =>
          decoder.decode(part.bytes)
        ).join('');
      } else if (details.requestBody.formData) {
        requestBody = new URLSearchParams(details.requestBody.formData).toString();
      }
    }

    // Parse based on platform
    let eventData = null;

    switch (platform) {
      case 'ga4':
        eventData = parseGA4Event(details.url, requestBody, false);
        break;
      case 'ga4-firstparty':
        eventData = parseGA4Event(details.url, requestBody, true);
        console.log('[DART Auditor] First-party GA4 detected:', getEndpointHost(details.url));
        break;
      case 'meta':
        eventData = parseMetaEvent(details.url, requestBody);
        break;
      case 'gads':
        eventData = parseGoogleAdsEvent(details.url);
        break;
      case 'tiktok':
        eventData = parseTikTokEvent(details.url, requestBody);
        break;
      case 'gtm':
        eventData = parseGTMEvent(details.url, false);
        break;
      case 'gtm-firstparty':
        eventData = parseGTMEvent(details.url, true);
        console.log('[DART Auditor] First-party GTM detected:', getEndpointHost(details.url));
        break;
    }

    if (eventData) {
      sendEventToPortal(eventData, initiator);
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

// ============================================
// Message Handlers
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get-status') {
    sendResponse({
      connected: isConnected,
      targetDomain: targetDomain,
      connectionCount: connectionCount,
      isPrimaryConnection: isPrimaryConnection
    });
  }

  if (message.type === 'connect') {
    connectToPortal();
  }

  // Handle gtag-captured Google Ads events from content script
  if (message.type === 'gtag-gads-event') {
    const eventData = message.event;
    console.log('[DART Auditor] Received gtag GAds event:', eventData);

    // Add timestamp if not present
    if (!eventData.timestamp) {
      eventData.timestamp = new Date().toISOString();
    }

    // Send to portal (initiator is the page URL from the event)
    sendEventToPortal(eventData, eventData.pageLocation || '');
  }

  // Handle user action events
  if (message.type === 'user-action') {
    const action = message.action;
    const data = message.data || {};

    console.log('[DART Auditor] User action:', action, data);

    // Build descriptive event name with details
    let eventName = action;
    let details = {};

    switch (action) {
      case 'click':
        eventName = `click: ${data.text || data.id || (data.classes && data.classes[0]) || data.tagName || 'element'}`;
        details = {
          tagName: data.tagName,
          id: data.id,
          classes: data.classes,
          text: data.text,
          href: data.href,
          name: data.name,
          type: data.type,
          value: data.value,
          role: data.role,
          ariaLabel: data.ariaLabel,
          title: data.title,
          dataAttributes: data.dataAttributes,
          xpath: data.xpath
        };
        break;

      case 'form_submit':
        eventName = `form_submit: ${data.formId || data.formName || data.element || 'form'}`;
        details = {
          element: data.element,
          action: data.action,
          method: data.method,
          formId: data.formId,
          formName: data.formName
        };
        break;

      case 'input_change':
        eventName = `input_change: ${data.inputName || data.inputId || data.inputType}`;
        details = {
          element: data.element,
          inputType: data.inputType,
          inputName: data.inputName,
          inputId: data.inputId
        };
        break;

      case 'navigation':
        eventName = `navigation: ${data.type}`;
        details = {
          navigationType: data.type,
          url: data.url
        };
        break;

      case 'scroll_depth':
        eventName = `scroll_depth: ${data.percent}%`;
        details = {
          percent: data.percent
        };
        break;

      case 'page_view':
        eventName = `page_view: ${data.title || 'page'}`;
        details = {
          title: data.title,
          referrer: data.referrer
        };
        break;

      case 'visibility_change':
        eventName = `visibility: ${data.state}`;
        details = {
          state: data.state
        };
        break;

      default:
        details = data;
    }

    const eventData = {
      type: 'user-action',
      platform: 'User Action',
      event: eventName,
      action: action,
      element: data.element || null,
      text: data.text || null,
      href: data.href || null,
      details: details,
      pageLocation: message.pageLocation,
      timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : new Date().toISOString(),
      source: 'user-action'
    };

    // Send to WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(eventData));
    }

    // Also poll dataLayer after user actions
    pollDataLayerAllTabs();
  }

  // Handle dataLayer events from content script
  if (message.type === 'datalayer-event') {
    const data = message.event;
    // Get page URL from multiple sources
    const pageUrl = message.pageLocation || sender?.tab?.url || sender?.url || '';

    console.log('[DART Auditor] === DATALAYER EVENT RECEIVED ===');
    console.log('[DART Auditor] Event name:', data.event);
    console.log('[DART Auditor] Page URL:', pageUrl);
    console.log('[DART Auditor] Target domain:', targetDomain);
    console.log('[DART Auditor] Sender tab:', sender?.tab?.url);

    const eventData = {
      type: 'datalayer-event',
      platform: 'DataLayer',
      event: data.event || 'push',
      ecommerce: data.ecommerce || null,
      pageLocation: pageUrl,
      raw: data.data || data,
      timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : new Date().toISOString(),
      source: 'datalayer'
    };

    // Send directly to WebSocket (bypass domain filter for dataLayer)
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[DART Auditor] Sending dataLayer event to WebSocket');
      ws.send(JSON.stringify(eventData));
    } else {
      console.log('[DART Auditor] WebSocket not connected!');
    }
  }

  return true;
});

// ============================================
// DataLayer Polling (triggered when network events are detected)
// ============================================
const dataLayerCache = new Map(); // tabId -> last known dataLayer length

async function pollDataLayerForTab(tabId, tabUrl) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        if (!window.dataLayer || !Array.isArray(window.dataLayer)) return null;
        return window.dataLayer.map(item => {
          try {
            return JSON.parse(JSON.stringify(item));
          } catch {
            return { event: item?.event || 'unknown', error: 'circular' };
          }
        });
      },
      world: 'MAIN'
    });

    if (results && results[0] && results[0].result) {
      const dataLayer = results[0].result;
      const lastLength = dataLayerCache.get(tabId) || 0;

      // Send only new items
      if (dataLayer.length > lastLength) {
        const newItems = dataLayer.slice(lastLength);

        for (const item of newItems) {
          // Skip if not an object
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

          // Skip GTM internal events
          if (item.event && item.event.startsWith('gtm.')) continue;

          // Only capture items with event OR ecommerce data
          if (!item.event && !item.ecommerce) continue;

          console.log('[DART Auditor] DataLayer push:', item.event || 'ecommerce', JSON.stringify(item).substring(0, 100));

          // Determine event name
          let eventName = item.event;
          if (!item.event && item.ecommerce) {
            eventName = 'ecommerce_' + (Object.keys(item.ecommerce)[0] || 'data');
          }

          const eventData = {
            type: 'datalayer-event',
            platform: 'DataLayer',
            event: eventName,
            ecommerce: item.ecommerce || null,
            pageLocation: tabUrl,
            raw: item,
            timestamp: new Date().toISOString(),
            source: 'datalayer'
          };

          // Send to WebSocket
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(eventData));
          }
        }

        dataLayerCache.set(tabId, dataLayer.length);
      }
    }
  } catch (e) {
    // Ignore errors
  }
}

// Poll dataLayer for all matching tabs
async function pollDataLayerAllTabs() {
  if (!targetDomain) return;

  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url || !tab.id) continue;

      try {
        const tabHost = new URL(tab.url).hostname.replace(/^www\./, '').toLowerCase();
        const target = targetDomain.replace(/^www\./, '').toLowerCase();
        if (tabHost === target || tabHost.endsWith('.' + target)) {
          await pollDataLayerForTab(tab.id, tab.url);
        }
      } catch {}
    }
  } catch {}
}

// Clean up closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  dataLayerCache.delete(tabId);
  injectedUserActionTabs.delete(tabId);
});

// Poll on tab load complete (catches initial dataLayer)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && targetDomain) {
    try {
      const tabHost = new URL(tab.url).hostname.replace(/^www\./, '').toLowerCase();
      const target = targetDomain.replace(/^www\./, '').toLowerCase();
      if (tabHost === target || tabHost.endsWith('.' + target)) {
        // Reset cache for this tab on new page load
        dataLayerCache.delete(tabId);
        // Poll after short delay to let page initialize
        setTimeout(() => pollDataLayerForTab(tabId, tab.url), 500);
        setTimeout(() => pollDataLayerForTab(tabId, tab.url), 1500);
        setTimeout(() => pollDataLayerForTab(tabId, tab.url), 3000);
      }
    } catch {}
  }
});

// Periodic fallback poll every 2 seconds (catches missed pushes)
setInterval(() => {
  if (targetDomain) {
    pollDataLayerAllTabs();
  }
}, 2000);

// ============================================
// User Action Tracking (clicks, forms, navigation, etc.)
// ============================================
const injectedUserActionTabs = new Set();

async function injectUserActionTracking(tabId, tabUrl) {
  if (injectedUserActionTabs.has(tabId)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        if (window.__dartUserActionTracking) return;
        window.__dartUserActionTracking = true;

        // Helper to get element selector
        function getSelector(el) {
          if (!el) return '';
          if (el.id) return '#' + el.id;
          if (el.className && typeof el.className === 'string') {
            return el.tagName.toLowerCase() + '.' + el.className.split(' ').filter(c => c).join('.');
          }
          return el.tagName.toLowerCase();
        }

        // Helper to get element text (truncated)
        function getText(el) {
          const text = el?.innerText || el?.textContent || '';
          return text.trim().substring(0, 100);
        }

        // Send action to extension
        function sendAction(action, data) {
          window.postMessage({
            type: 'DART_USER_ACTION',
            action: action,
            data: data,
            url: window.location.href,
            timestamp: Date.now()
          }, '*');
        }

        // Track clicks with full element details
        document.addEventListener('click', (e) => {
          const target = e.target.closest('a, button, [onclick], [role="button"], input[type="submit"]') || e.target;

          // Get all classes as array
          const classes = target.className && typeof target.className === 'string'
            ? target.className.split(' ').filter(c => c.trim())
            : [];

          // Get data attributes
          const dataAttrs = {};
          if (target.dataset) {
            for (const [key, value] of Object.entries(target.dataset)) {
              dataAttrs['data-' + key] = value;
            }
          }

          sendAction('click', {
            tagName: target.tagName,
            id: target.id || null,
            classes: classes,
            text: getText(target),
            href: target.href || null,
            name: target.name || null,
            type: target.type || null,
            value: target.tagName === 'INPUT' ? (target.type === 'submit' ? target.value : null) : null,
            role: target.getAttribute('role') || null,
            ariaLabel: target.getAttribute('aria-label') || null,
            title: target.title || null,
            dataAttributes: Object.keys(dataAttrs).length > 0 ? dataAttrs : null,
            xpath: getXPath(target)
          });
        }, true);

        // Helper to get XPath
        function getXPath(el) {
          if (!el) return '';
          if (el.id) return '//*[@id="' + el.id + '"]';
          if (el === document.body) return '/html/body';

          let ix = 0;
          const siblings = el.parentNode ? el.parentNode.childNodes : [];
          for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling === el) {
              const parentPath = getXPath(el.parentNode);
              const tagName = el.tagName.toLowerCase();
              return parentPath + '/' + tagName + '[' + (ix + 1) + ']';
            }
            if (sibling.nodeType === 1 && sibling.tagName === el.tagName) {
              ix++;
            }
          }
          return '';
        }

        // Track form submissions
        document.addEventListener('submit', (e) => {
          const form = e.target;
          sendAction('form_submit', {
            element: getSelector(form),
            action: form.action || null,
            method: form.method || 'GET',
            formId: form.id || null,
            formName: form.name || null
          });
        }, true);

        // Track input changes (blur)
        document.addEventListener('change', (e) => {
          const input = e.target;
          if (['INPUT', 'SELECT', 'TEXTAREA'].includes(input.tagName)) {
            sendAction('input_change', {
              element: getSelector(input),
              inputType: input.type || input.tagName.toLowerCase(),
              inputName: input.name || null,
              inputId: input.id || null
              // Don't send value for privacy
            });
          }
        }, true);

        // Track navigation (history changes)
        const originalPushState = history.pushState;
        history.pushState = function() {
          originalPushState.apply(this, arguments);
          sendAction('navigation', {
            type: 'pushState',
            url: window.location.href
          });
        };

        const originalReplaceState = history.replaceState;
        history.replaceState = function() {
          originalReplaceState.apply(this, arguments);
          sendAction('navigation', {
            type: 'replaceState',
            url: window.location.href
          });
        };

        window.addEventListener('popstate', () => {
          sendAction('navigation', {
            type: 'popstate',
            url: window.location.href
          });
        });

        // Track page visibility
        document.addEventListener('visibilitychange', () => {
          sendAction('visibility_change', {
            state: document.visibilityState
          });
        });

        // Track scroll depth (throttled)
        let maxScroll = 0;
        let scrollTimeout;
        window.addEventListener('scroll', () => {
          clearTimeout(scrollTimeout);
          scrollTimeout = setTimeout(() => {
            const scrollPercent = Math.round(
              (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
            );
            if (scrollPercent > maxScroll && scrollPercent % 25 === 0) {
              maxScroll = scrollPercent;
              sendAction('scroll_depth', {
                percent: scrollPercent
              });
            }
          }, 500);
        }, { passive: true });

        // Initial page view
        sendAction('page_view', {
          title: document.title,
          referrer: document.referrer
        });

        console.log('[DART] User action tracking active');
      },
      world: 'MAIN',
      injectImmediately: true
    });

    // Listener in isolated world to forward to background
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        window.addEventListener('message', (event) => {
          if (event.source !== window) return;
          if (event.data?.type === 'DART_USER_ACTION') {
            chrome.runtime.sendMessage({
              type: 'user-action',
              action: event.data.action,
              data: event.data.data,
              pageLocation: event.data.url,
              timestamp: event.data.timestamp
            });
          }
        });
      },
      world: 'ISOLATED'
    });

    injectedUserActionTabs.add(tabId);
    console.log('[DART Auditor] Injected user action tracking into tab', tabId);
  } catch (e) {
    // Ignore errors
  }
}

// Inject on tab update when target domain matches
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && targetDomain) {
    try {
      const tabHost = new URL(tab.url).hostname.replace(/^www\./, '').toLowerCase();
      const target = targetDomain.replace(/^www\./, '').toLowerCase();
      if (tabHost === target || tabHost.endsWith('.' + target)) {
        injectedUserActionTabs.delete(tabId); // Re-inject on navigation
        injectUserActionTracking(tabId, tab.url);
      }
    } catch {}
  }
});

// ============================================
// Initialize
// ============================================
connectToPortal();
