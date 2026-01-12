// DART Event Auditor - Popup Script

const GITHUB_REPO = 'abn-digital/dart-auditor-extension';
const CURRENT_VERSION = chrome.runtime.getManifest().version;

const statusEl = document.getElementById('status');
const targetEl = document.getElementById('target');
const eventsEl = document.getElementById('events');
const reconnectBtn = document.getElementById('reconnect');
const multiAlertEl = document.getElementById('multi-alert');
const updateAlertEl = document.getElementById('update-alert');
const updateVersionEl = document.getElementById('update-version');
const dismissUpdateBtn = document.getElementById('dismiss-update');

let recentEvents = [];

// Version comparison (returns true if remote > current)
function isNewerVersion(remote, current) {
    const remoteParts = remote.replace(/^v/, '').split('.').map(Number);
    const currentParts = current.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        if ((remoteParts[i] || 0) > (currentParts[i] || 0)) return true;
        if ((remoteParts[i] || 0) < (currentParts[i] || 0)) return false;
    }
    return false;
}

// Check for updates from GitHub releases
async function checkForUpdates() {
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
        if (!response.ok) return;

        const release = await response.json();
        const latestVersion = release.tag_name;

        // Check if we've dismissed this version
        const { dismissedVersion } = await chrome.storage.local.get('dismissedVersion');
        if (dismissedVersion === latestVersion) return;

        if (isNewerVersion(latestVersion, CURRENT_VERSION)) {
            updateVersionEl.textContent = latestVersion;
            updateAlertEl.classList.add('show');
            updateAlertEl.href = release.html_url;
        }
    } catch (e) {
        console.log('Update check failed:', e);
    }
}

// Dismiss update notification
if (dismissUpdateBtn) {
    dismissUpdateBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const version = updateVersionEl.textContent;
        await chrome.storage.local.set({ dismissedVersion: version });
        updateAlertEl.classList.remove('show');
    });
}

// Check for updates on popup open
checkForUpdates();

// Map platform to CSS class
function getPlatformClass(platform) {
    const map = {
        'GA4': 'ga4',
        'Meta Pixel': 'meta',
        'Google Ads': 'gads',
        'TikTok Pixel': 'tiktok'
    };
    return map[platform] || 'ga4';
}

// Update status display
function updateStatus(connected, targetDomain, isPrimaryConnection) {
    if (!isPrimaryConnection) {
        statusEl.className = 'status disconnected';
        statusEl.textContent = 'Blocked - Secondary connection';
        multiAlertEl.classList.add('show');
    } else if (connected) {
        statusEl.className = 'status connected';
        statusEl.textContent = 'Connected to portal';
        multiAlertEl.classList.remove('show');
    } else {
        statusEl.className = 'status disconnected';
        statusEl.textContent = 'Disconnected';
        multiAlertEl.classList.remove('show');
    }

    targetEl.textContent = targetDomain || 'None - Start audit in portal';
}

// Add event to display
function addEvent(event) {
    recentEvents.unshift(event);
    if (recentEvents.length > 20) recentEvents.pop();
    renderEvents();
}

// Render events list
function renderEvents() {
    if (recentEvents.length === 0) return;

    eventsEl.innerHTML = recentEvents.map(e => {
        const platformClass = getPlatformClass(e.platform);
        const platformLabel = e.platform || 'Unknown';
        const eventName = e.event || 'unknown';
        const valueDisplay = e.value ? `$${e.value}` : '';

        return `
            <div class="event">
                <span class="event-platform ${platformClass}">${platformLabel}</span>
                <span class="event-name">${eventName}</span>
                ${valueDisplay ? `<span class="event-value">${valueDisplay}</span>` : ''}
            </div>
        `;
    }).join('');
}

// Get initial status
chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
    if (response) {
        updateStatus(response.connected, response.targetDomain, response.isPrimaryConnection);
    }
});

// Listen for updates
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'status') {
        updateStatus(message.connected, message.targetDomain, message.isPrimaryConnection);
    }
    if (message.type === 'event') {
        addEvent(message.event);
    }
});

// Reconnect button
reconnectBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'connect' });
    statusEl.textContent = 'Connecting...';
});
