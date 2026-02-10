// background.js
'use strict';

// Store for unified feed data
let unifiedFeed = [];
const MAX_FEED_SIZE = 500; // Limit to prevent memory issues

// Track which tabs are being monitored
let monitoredTabs = new Map(); // tabId -> { url, platform, lastUpdate }

// Initialize storage on installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Social Feed Aggregator installed');
  
  // Initialize storage
  chrome.storage.local.set({
    unifiedFeed: [],
    settings: {
      sortBy: 'chronological', // 'chronological' or 'engagement'
      showNotifications: true,
      autoRefresh: true
    }
  });
  
  // Scan existing tabs
  scanExistingTabs();
});

// Scan for existing X and BlueSky tabs on startup
async function scanExistingTabs() {
  const tabs = await chrome.tabs.query({});
  
  for (const tab of tabs) {
    if (isSocialMediaTab(tab.url)) {
      monitorTab(tab);
    }
  }
}

// Check if URL is X, BlueSky, or Mastodon
function isSocialMediaTab(url) {
  if (!url) return false;
  
  const isTwitter = url.includes('twitter.com') || url.includes('x.com');
  const isBlueSky = url.includes('bsky.app');
  const isMastodon = url.includes('mastodon') || 
                     url.includes('fosstodon') ||
                     url.includes('hachyderm') ||
                     url.match(/https?:\/\/[^\/]+\.(social|exchange)/); // Common Mastodon domains
  
  if (!isTwitter && !isBlueSky && !isMastodon) return false;
  
  // Exclude profile pages and individual status/post pages
  if (url.includes('/profile') || url.includes('/status') || url.includes('/post/') || url.includes('/trending/') || url.includes('/search')) {
    return false;
  }
  
  // For Mastodon, also exclude user profile pages (/@username)
  if (isMastodon && url.match(/\/@[\w]+$/)) {
    return false;
  }
  
  return true;
}

// Determine platform from URL
function getPlatform(url) {
  if (url.includes('twitter.com') || url.includes('x.com')) {
    return 'twitter';
  }
  else if (url.includes('bsky.app')) {
    return 'bluesky';
  }
  else if (url.includes('mastodon') || url.includes('fosstodon') || 
      url.includes('hachyderm') || url.match(/\.(social|exchange)/)) {
    return 'mastodon';
  }
  return 'unknown';
}


// Start monitoring a tab
function monitorTab(tab) {
  if (!tab.id || !tab.url) return;
  
  const platform = getPlatform(tab.url);
  
  monitoredTabs.set(tab.id, {
    url: tab.url,
    platform: platform,
    lastUpdate: Date.now()
  });
  
  console.log(`Monitoring tab ${tab.id} (${platform})`);
}

// Stop monitoring a tab
function unmonitorTab(tabId) {
  if (monitoredTabs.has(tabId)) {
    console.log(`Stopped monitoring tab ${tabId}`);
    monitoredTabs.delete(tabId);
    
    // Remove posts from this tab from the feed
    cleanupTabPosts(tabId);
  }
}

// Remove posts from closed tab
function cleanupTabPosts(tabId) {
  unifiedFeed = unifiedFeed.filter(post => post.sourceTabId !== tabId);
  saveFeedToStorage();
}

// Listen for new posts from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'NEW_POST') {
    handleNewPost(message.data, sender.tab?.id);
    sendResponse({ success: true });
  }
  else if (message.type === 'GET_FEED') {
    sendResponse({ feed: getSortedFeed(message.sortBy) });
  }
  else if (message.type === 'OPEN_POST') {
    openPostInNewTab(message.url);
    sendResponse({ success: true });
  }
  else if (message.type === 'REFRESH_FEED') {
    refreshAllTabs();
    sendResponse({ success: true });
  }
  else if (message.type === 'CLEAR_FEED') {
    clearFeed();
    sendResponse({ success: true });
  }
  
  return true; // Keep message channel open for async response
});

// Handle new post from content script
function handleNewPost(postData, tabId) {
  // Add source tab ID for tracking
  postData.sourceTabId = tabId;
  
  // Check if post already exists (by ID)
  const existingIndex = unifiedFeed.findIndex(p => p.id === postData.id);
  
  if (existingIndex >= 0) {
    // Update existing post (engagement might have changed)
    unifiedFeed[existingIndex] = postData;
  } else {
    // Add new post
    unifiedFeed.push(postData);
    
    // Notify popup to refresh if it's open
    notifyPopup('FEED_UPDATED', { newPost: postData });
  }
  
  // Trim feed if too large (remove oldest posts)
  if (unifiedFeed.length > MAX_FEED_SIZE) {
    unifiedFeed.sort((a, b) => b.scrapedAt - a.scrapedAt);
    unifiedFeed = unifiedFeed.slice(0, MAX_FEED_SIZE);
  }
  
  // Save to storage periodically
  saveFeedToStorage();
}

// Save feed to storage (debounced)
let saveTimeout = null;
function saveFeedToStorage() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    chrome.storage.local.set({ unifiedFeed: unifiedFeed });
  }, 2000); // Save every 2 seconds max
}

// Load feed from storage
async function loadFeedFromStorage() {
  const result = await chrome.storage.local.get(['unifiedFeed']);
  if (result.unifiedFeed) {
    unifiedFeed = result.unifiedFeed;
  }
}

// Get sorted feed
function getSortedFeed(sortBy = 'chronological') {
  let sorted = [...unifiedFeed];
  
  switch (sortBy) {
    case 'chronological':
      // Sort by actual post timestamp, not scrape time
      sorted.sort((a, b) => {
        const timeA = a.timestamp || a.scrapedAt;
        const timeB = b.timestamp || b.scrapedAt;
        return timeB - timeA; // Newest first
      });
      break;
    
    case 'chronological-old':
      // Oldest first option
      sorted.sort((a, b) => {
        const timeA = a.timestamp || a.scrapedAt;
        const timeB = b.timestamp || b.scrapedAt;
        return timeA - timeB;
      });
      break;
    
    case 'engagement':
      sorted.sort((a, b) => {
        const engagementA = (a.engagement?.likes || 0) + 
                           (a.engagement?.retweets || 0) + 
                           (a.engagement?.reposts || 0) +
                           (a.engagement?.boosts || 0) +
                           (a.engagement?.favorites || 0) +
                           (a.engagement?.replies || 0);
        const engagementB = (b.engagement?.likes || 0) + 
                           (b.engagement?.retweets || 0) + 
                           (b.engagement?.reposts || 0) +
                           (b.engagement?.boosts || 0) +
                           (b.engagement?.favorites || 0) +
                           (b.engagement?.replies || 0);
        return engagementB - engagementA;
      });
      break;
    
    case 'platform':
      sorted.sort((a, b) => {
        // First by platform, then by timestamp within each platform
        if (a.platform !== b.platform) {
          return a.platform.localeCompare(b.platform);
        }
        const timeA = a.timestamp || a.scrapedAt;
        const timeB = b.timestamp || b.scrapedAt;
        return timeB - timeA;
      });
      break;
  }
  
  return sorted;
}


// Open post in new tab
function openPostInNewTab(url) {
  chrome.tabs.create({ url: url, active: true });
}

// Refresh all monitored tabs
async function refreshAllTabs() {
  for (const [tabId, tabInfo] of monitoredTabs.entries()) {
    try {
      // Send message to content script to rescan
      await chrome.tabs.sendMessage(tabId, { type: 'RESCAN' });
    } catch (error) {
      // Tab might be closed or content script not injected
      console.log(`Failed to refresh tab ${tabId}:`, error);
    }
  }
}

// Clear entire feed
function clearFeed() {
  unifiedFeed = [];
  chrome.storage.local.set({ unifiedFeed: [] });
  notifyPopup('FEED_CLEARED');
}

// Notify popup of changes
function notifyPopup(type, data = {}) {
  chrome.runtime.sendMessage({ type, ...data }).catch(() => {
    // Popup might not be open, that's okay
  });
}

// Tab event listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isSocialMediaTab(tab.url)) {
    monitorTab(tab);
  } else if (changeInfo.url && !isSocialMediaTab(changeInfo.url)) {
    // Tab navigated away from social media
    unmonitorTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  unmonitorTab(tabId);
});

chrome.tabs.onCreated.addListener((tab) => {
  if (isSocialMediaTab(tab.url)) {
    monitorTab(tab);
  }
});

// Monitor tab activation to update last active time
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (monitoredTabs.has(tabId)) {
    const tabInfo = monitoredTabs.get(tabId);
    tabInfo.lastUpdate = Date.now();
  }
});

// Load feed from storage on startup
loadFeedFromStorage();

// Keep service worker alive by periodically accessing chrome APIs
// Service workers can terminate after 30 seconds of inactivity
setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {
    // This prevents the service worker from terminating
  });
}, 20000); // Every 20 seconds

console.log('Social Feed Aggregator background service worker initialized');


// Add this to the existing background.js

// Track the feed tab ID to avoid opening multiple tabs
let feedTabId = null;

// Handle extension icon click
chrome.action.onClicked.addListener(async () => {
  // Check if feed tab is already open
  if (feedTabId) {
    try {
      // Try to activate the existing tab
      await chrome.tabs.update(feedTabId, { active: true });
      // Bring the window to front
      const tab = await chrome.tabs.get(feedTabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    } catch (error) {
      // Tab was closed, reset the ID
      feedTabId = null;
    }
  }
  
  // Create new feed tab
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL('views/feed.html'),
    active: true
  });
  
  feedTabId = tab.id;
});

// Clean up when feed tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === feedTabId) {
    feedTabId = null;
  }
  
  // Existing cleanup code for monitored tabs
  unmonitorTab(tabId);
});
