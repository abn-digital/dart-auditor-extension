// DART Event Auditor - Popup Script

const statusEl = document.getElementById('status');
const targetEl = document.getElementById('target');
const eventsEl = document.getElementById('events');
const reconnectBtn = document.getElementById('reconnect');
const multiAlertEl = document.getElementById('multi-alert');

let recentEvents = [];

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
