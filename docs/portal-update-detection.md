# Portal Extension Update Detection

This document describes how the DART Tracking Portal should detect and handle extension updates.

## Overview

The portal is responsible for:
1. Receiving the extension version on WebSocket connect
2. Checking GitHub releases for the latest version
3. Notifying users when an update is available
4. Providing a download link for the new version

---

## 1. Extension Version Handshake

When the extension connects via WebSocket, it sends its version:

```json
{
  "type": "extension-version",
  "version": "2.0.0"
}
```

### Portal WebSocket Handler

```javascript
wss.on('connection', (ws) => {
  let extensionVersion = null;

  ws.on('message', (data) => {
    const message = JSON.parse(data);

    if (message.type === 'extension-version') {
      extensionVersion = message.version;

      // Check for updates and notify client
      checkExtensionUpdate(extensionVersion).then(updateInfo => {
        if (updateInfo.updateAvailable) {
          // Send to frontend via Socket.io
          io.emit('extension-update-available', updateInfo);
        }
      });
    }

    // ... handle other message types
  });
});
```

---

## 2. GitHub Release Check

### Fetch Latest Release

```javascript
async function getLatestRelease() {
  const response = await fetch(
    'https://api.github.com/repos/abn-digital/dart-auditor-extension/releases/latest'
  );

  if (!response.ok) {
    throw new Error('Failed to fetch release info');
  }

  return response.json();
}
```

### Response Structure

```json
{
  "tag_name": "v2.1.2",
  "name": "DART Event Auditor v2.1.2",
  "html_url": "https://github.com/abn-digital/dart-auditor-extension/releases/tag/v2.1.2",
  "assets": [
    {
      "name": "DART-Event-Auditor-v2.1.2.zip",
      "browser_download_url": "https://github.com/abn-digital/dart-auditor-extension/releases/download/v2.1.2/DART-Event-Auditor-v2.1.2.zip"
    }
  ],
  "body": "## DART Event Auditor v2.1.2\n\n### What's New\n..."
}
```

---

## 3. Version Comparison

```javascript
function isNewerVersion(latest, current) {
  const latestParts = latest.replace(/^v/, '').split('.').map(Number);
  const currentParts = current.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if ((latestParts[i] || 0) > (currentParts[i] || 0)) return true;
    if ((latestParts[i] || 0) < (currentParts[i] || 0)) return false;
  }
  return false;
}
```

---

## 4. Complete Update Check Function

```javascript
async function checkExtensionUpdate(currentVersion) {
  try {
    const release = await getLatestRelease();
    const latestVersion = release.tag_name;

    if (!isNewerVersion(latestVersion, currentVersion)) {
      return { updateAvailable: false };
    }

    // Find the ZIP asset
    const zipAsset = release.assets.find(a => a.name.endsWith('.zip'));

    return {
      updateAvailable: true,
      currentVersion: currentVersion,
      latestVersion: latestVersion,
      downloadUrl: zipAsset?.browser_download_url || release.html_url,
      releaseNotes: release.body,
      releaseUrl: release.html_url
    };
  } catch (error) {
    console.error('Update check failed:', error);
    return { updateAvailable: false, error: error.message };
  }
}
```

---

## 5. Frontend Implementation

### Socket.io Listener

```javascript
socket.on('extension-update-available', (updateInfo) => {
  showUpdateNotification(updateInfo);
});
```

### UI Component (React Example)

```jsx
function ExtensionUpdateBanner({ updateInfo, onDismiss }) {
  if (!updateInfo?.updateAvailable) return null;

  return (
    <div className="update-banner">
      <div className="update-content">
        <span className="update-icon">⬆️</span>
        <div className="update-text">
          <strong>Extension update available</strong>
          <span>v{updateInfo.currentVersion} → {updateInfo.latestVersion}</span>
        </div>
      </div>

      <div className="update-actions">
        <a
          href={updateInfo.downloadUrl}
          className="download-btn"
          download
        >
          Download Update
        </a>
        <button onClick={onDismiss} className="dismiss-btn">
          Later
        </button>
      </div>
    </div>
  );
}
```

### CSS Styles

```css
.update-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  border-radius: 8px;
  margin-bottom: 16px;
}

.update-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.update-icon {
  font-size: 24px;
}

.update-text {
  display: flex;
  flex-direction: column;
}

.update-text strong {
  font-size: 14px;
}

.update-text span {
  font-size: 12px;
  opacity: 0.9;
}

.update-actions {
  display: flex;
  gap: 8px;
}

.download-btn {
  padding: 8px 16px;
  background: white;
  color: #059669;
  border: none;
  border-radius: 6px;
  font-weight: bold;
  text-decoration: none;
  cursor: pointer;
}

.download-btn:hover {
  background: #f0fdf4;
}

.dismiss-btn {
  padding: 8px 12px;
  background: transparent;
  color: white;
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 6px;
  cursor: pointer;
}

.dismiss-btn:hover {
  background: rgba(255,255,255,0.1);
}
```

---

## 6. Update Instructions Modal

When user clicks download, show a modal with instructions:

```jsx
function UpdateInstructionsModal({ downloadUrl, onClose }) {
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>How to Update</h2>

        <ol className="instructions">
          <li>
            <strong>Download</strong> the ZIP file
            <a href={downloadUrl} className="download-link" download>
              Download ZIP
            </a>
          </li>
          <li>
            <strong>Extract</strong> the ZIP contents
          </li>
          <li>
            <strong>Replace</strong> the files in your extension folder
            <p className="hint">
              Find your folder: chrome://extensions → DART Event Auditor → Details → Source
            </p>
          </li>
          <li>
            <strong>Reload</strong> the extension
            <p className="hint">
              Go to chrome://extensions and click the refresh icon
            </p>
          </li>
        </ol>

        <button onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
```

---

## 7. Caching Recommendations

To avoid hitting GitHub API rate limits:

```javascript
let cachedRelease = null;
let lastCheck = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getLatestReleaseCached() {
  const now = Date.now();

  if (cachedRelease && (now - lastCheck) < CACHE_DURATION) {
    return cachedRelease;
  }

  cachedRelease = await getLatestRelease();
  lastCheck = now;
  return cachedRelease;
}
```

---

## 8. Server-Side Implementation (Node.js)

Complete server integration:

```javascript
const express = require('express');
const { WebSocketServer } = require('ws');
const { Server } = require('socket.io');

const app = express();
const server = require('http').createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const wss = new WebSocketServer({ port: 3001 });

// GitHub release cache
let releaseCache = { data: null, timestamp: 0 };

async function getLatestRelease() {
  const now = Date.now();
  if (releaseCache.data && (now - releaseCache.timestamp) < 300000) {
    return releaseCache.data;
  }

  const res = await fetch(
    'https://api.github.com/repos/abn-digital/dart-auditor-extension/releases/latest'
  );
  releaseCache = { data: await res.json(), timestamp: now };
  return releaseCache.data;
}

// Extension WebSocket connection
wss.on('connection', (ws) => {
  console.log('Extension connected');

  ws.on('message', async (data) => {
    const message = JSON.parse(data);

    if (message.type === 'extension-version') {
      const release = await getLatestRelease();
      const latest = release.tag_name.replace(/^v/, '');
      const current = message.version;

      if (isNewerVersion(latest, current)) {
        const zipAsset = release.assets.find(a => a.name.endsWith('.zip'));

        io.emit('extension-update-available', {
          updateAvailable: true,
          currentVersion: current,
          latestVersion: release.tag_name,
          downloadUrl: zipAsset?.browser_download_url,
          releaseUrl: release.html_url
        });
      }
    }

    // ... handle other messages
  });
});

function isNewerVersion(latest, current) {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

server.listen(3000);
```

---

## Summary

| Component | Responsibility |
|-----------|----------------|
| Extension | Sends version on WebSocket connect |
| Portal Server | Checks GitHub releases, compares versions |
| Portal Frontend | Shows update banner, provides download link |
| GitHub | Hosts release ZIPs as assets |

### Download URL Format

```
https://github.com/abn-digital/dart-auditor-extension/releases/download/v{VERSION}/DART-Event-Auditor-v{VERSION}.zip
```
