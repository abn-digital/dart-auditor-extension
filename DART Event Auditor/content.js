// DART Event Auditor - Content Script
// Detects hardcoded tracking tags in page HTML
// "Hardcoded" = NOT deployed via GTM (if GTM exists, tags could be injected by GTM)

(function() {
    'use strict';

    console.log('[DART Extension] Content script loaded');

    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', detectHardcodedTags);
    } else {
        // Small delay to ensure all scripts are parsed
        setTimeout(detectHardcodedTags, 500);
    }

    function detectHardcodedTags() {
        console.log('[DART Extension] Scanning for hardcoded tags...');

        const detections = {
            gtag: [],
            gtm: [],
            meta: [],
            tiktok: [],
            gads: []
        };

        // Get all script content (inline and external references)
        const scripts = document.querySelectorAll('script');
        let allScriptContent = '';

        scripts.forEach(script => {
            if (script.innerHTML) {
                allScriptContent += script.innerHTML + '\n';
            }
        });

        // Also check the full HTML for any missed patterns
        const fullHTML = document.documentElement.innerHTML;

        // ============================================
        // GTM Container Detection (FIRST - needed to determine if other tags are hardcoded)
        // ============================================

        // Detect GTM container IDs
        const gtmRegex = /GTM-[A-Z0-9]+/gi;
        const gtmMatches = [...new Set(fullHTML.match(gtmRegex) || [])];

        gtmMatches.forEach(containerId => {
            const config = { containerId: containerId };

            // Check if loaded from first-party
            const gtmScriptRegex = new RegExp(`([a-z0-9.-]+)\\/gtm\\.js\\?[^"']*id=${containerId}`, 'i');
            const scriptMatch = fullHTML.match(gtmScriptRegex);
            if (scriptMatch) {
                config.endpoint = scriptMatch[1];
                config.isFirstParty = !scriptMatch[1].includes('googletagmanager.com');
            }

            detections.gtm.push(config);
        });

        // Check if GTM exists on the page
        const hasGTM = detections.gtm.length > 0;

        if (hasGTM) {
            console.log('[DART Extension] GTM detected - other tags may be GTM-deployed, not hardcoded');
        }

        // ============================================
        // Gtag Detection (only if NO GTM on page)
        // ============================================

        if (!hasGTM) {
            let match;

            // Detect gtag('config', ...) calls
            const gtagConfigRegex = /gtag\s*\(\s*['"]config['"]\s*,\s*['"]([A-Z0-9-]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/gi;

            while ((match = gtagConfigRegex.exec(allScriptContent)) !== null) {
                const tagId = match[1];
                const configStr = match[2] || '';

                const config = {
                    tagId: tagId,
                    type: getTagType(tagId),
                    raw: match[0]
                };

                // Extract server_container_url if present
                const serverUrlMatch = configStr.match(/['"]?server_container_url['"]?\s*:\s*['"]([^'"]+)['"]/i);
                if (serverUrlMatch) {
                    config.serverContainerUrl = serverUrlMatch[1];
                    config.isServerSide = true;
                }

                // Extract allow_enhanced_conversions
                const enhancedMatch = configStr.match(/['"]?allow_enhanced_conversions['"]?\s*:\s*(true|false)/i);
                if (enhancedMatch) {
                    config.enhancedConversions = enhancedMatch[1] === 'true';
                }

                // Extract send_page_view
                const sendPVMatch = configStr.match(/['"]?send_page_view['"]?\s*:\s*(true|false)/i);
                if (sendPVMatch) {
                    config.sendPageView = sendPVMatch[1] === 'true';
                }

                detections.gtag.push(config);
            }

            // Detect gtag.js script loading
            const gtagScriptRegex = /(?:googletagmanager\.com|[a-z0-9.-]+)\/gtag\/js\?id=([A-Z0-9-]+)/gi;
            while ((match = gtagScriptRegex.exec(fullHTML)) !== null) {
                const tagId = match[1];
                const isFirstParty = !match[0].includes('googletagmanager.com');
                const endpoint = match[0].split('/gtag/js')[0].replace(/.*\/\//, '');

                // Check if we already have this from config detection
                const existing = detections.gtag.find(g => g.tagId === tagId);
                if (existing) {
                    existing.scriptEndpoint = endpoint;
                    existing.isFirstParty = isFirstParty;
                } else {
                    detections.gtag.push({
                        tagId: tagId,
                        type: getTagType(tagId),
                        scriptEndpoint: endpoint,
                        isFirstParty: isFirstParty
                    });
                }
            }
        }

        // ============================================
        // Meta Pixel Detection (only if NO GTM on page)
        // ============================================

        if (!hasGTM) {
            let match;

            // Detect fbq('init', ...) calls
            const fbqInitRegex = /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/gi;
            while ((match = fbqInitRegex.exec(allScriptContent)) !== null) {
                detections.meta.push({
                    pixelId: match[1],
                    raw: match[0]
                });
            }

            // Also detect _fbq and Facebook Pixel patterns
            const fbPixelRegex = /(?:fbq|_fbq)\s*\.\s*push\s*\(\s*\[\s*['"]init['"]\s*,\s*['"](\d+)['"]/gi;
            while ((match = fbPixelRegex.exec(allScriptContent)) !== null) {
                if (!detections.meta.find(m => m.pixelId === match[1])) {
                    detections.meta.push({
                        pixelId: match[1],
                        raw: match[0]
                    });
                }
            }
        }

        // ============================================
        // TikTok Pixel Detection (only if NO GTM on page)
        // ============================================

        if (!hasGTM) {
            let match;

            // Detect ttq.load(...) calls
            const ttqLoadRegex = /ttq\.load\s*\(\s*['"]([A-Z0-9]+)['"]/gi;
            while ((match = ttqLoadRegex.exec(allScriptContent)) !== null) {
                detections.tiktok.push({
                    pixelId: match[1],
                    raw: match[0]
                });
            }

            // Also detect ttq.instance
            const ttqInstanceRegex = /ttq\.instance\s*\(\s*['"]([A-Z0-9]+)['"]/gi;
            while ((match = ttqInstanceRegex.exec(allScriptContent)) !== null) {
                if (!detections.tiktok.find(t => t.pixelId === match[1])) {
                    detections.tiktok.push({
                        pixelId: match[1],
                        raw: match[0]
                    });
                }
            }
        }

        // ============================================
        // Google Ads Detection (only if NO GTM on page)
        // ============================================

        if (!hasGTM) {
            // Detect AW- conversion IDs
            const awRegex = /AW-\d+/gi;
            const awMatches = [...new Set(allScriptContent.match(awRegex) || [])];

            awMatches.forEach(conversionId => {
                const config = { conversionId: conversionId };

                // Check for conversion labels
                const labelRegex = new RegExp(`['"]?${conversionId}['"]?\\s*[,/]\\s*['"]?([A-Za-z0-9_-]+)['"]?`, 'i');
                const labelMatch = allScriptContent.match(labelRegex);
                if (labelMatch && labelMatch[1] !== conversionId) {
                    config.conversionLabel = labelMatch[1];
                }

                detections.gads.push(config);
            });
        }

        // ============================================
        // Send to Background Script
        // ============================================

        const hasDetections =
            detections.gtag.length > 0 ||
            detections.gtm.length > 0 ||
            detections.meta.length > 0 ||
            detections.tiktok.length > 0 ||
            detections.gads.length > 0;

        if (hasDetections) {
            console.log('[DART Extension] Hardcoded tags detected:', detections);
            if (hasGTM) {
                console.log('[DART Extension] Note: Only GTM containers reported. Other tags skipped (could be GTM-deployed).');
            }

            chrome.runtime.sendMessage({
                type: 'hardcoded-tags',
                detections: detections,
                hasGTM: hasGTM,
                pageUrl: window.location.href,
                pageTitle: document.title,
                timestamp: Date.now()
            });
        } else {
            console.log('[DART Extension] No hardcoded tags found');
        }
    }

    // Helper function to determine tag type from ID
    function getTagType(tagId) {
        if (tagId.startsWith('G-')) return 'GA4';
        if (tagId.startsWith('AW-')) return 'Google Ads';
        if (tagId.startsWith('DC-')) return 'Floodlight';
        if (tagId.startsWith('GT-')) return 'Google Tag';
        if (tagId.startsWith('GTM-')) return 'GTM';
        return 'Unknown';
    }

})();
