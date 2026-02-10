// mastodon-scraper.js
(function() {
  'use strict';

  // Track processed toots to avoid duplicates
  const processedToots = new Set();
  
  // Debounce function to limit message sending frequency
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

  // Extract toot data from article/status element
  function extractTootData(article) {
    try {
      // Check for boosts (boosted by someone)
      let booster = null;
      const boostIndicator = article.querySelector('.status__prepend span') ||
                             article.querySelector('[class*="reblog"]');
      if (boostIndicator) {
        const boostText = boostIndicator.textContent;
        // Extract name from "Username boosted" or similar patterns
        const match = boostText.match(/^(.+?)\s+boosted/i);
        if (match) {
          booster = match[1].trim();
        }
      }

      // Mastodon uses article.status class for each toot
      // Find the permalink to get the unique ID and URL
      const permalinkLink = article.querySelector('a.status__relative-time') ||
                            article.querySelector('a[href*="/statuses/"]') ||
                            article.querySelector('a > time');
      
      if (!permalinkLink || !permalinkLink.href) return null;
      
      const tootUrl = permalinkLink.href;
      // Extract toot ID from URL (e.g., https://mastodon.social/@user/123456789)
      const tootMatch = tootUrl.match(/\/(@.+|\d+)\/(\d+)/);
      if (!tootMatch) return null;
      
      const tootId = tootMatch[2];
      
      if (processedToots.has(tootId)) {
        return null;
      }

      // Extract author information
      let authorName = '';
      let authorHandle = '';
      let authorAvatar = '';
      
      // Author name - usually in display-name class
      const displayNameElement = article.querySelector('.display-name__html') ||
                                  article.querySelector('.display-name strong') ||
                                  article.querySelector('a[class*="display-name"]');
      if (displayNameElement) {
        authorName = displayNameElement.textContent.trim();
      }
      
      // Author handle - usually in @username format
      const accountElement = article.querySelector('.display-name__account') ||
                             article.querySelector('a[class*="account"]') ||
                             article.querySelector('span[class*="username"]');
      if (accountElement) {
        authorHandle = accountElement.textContent.trim().replace('@', '');
      }
      
      // Extract avatar
      const avatarImg = article.querySelector('.account__avatar img') ||
                        article.querySelector('img[class*="avatar"]');
      if (avatarImg) {
        authorAvatar = avatarImg.src;
      }

      // Extract toot content
      // Mastodon uses .status__content for the main text
      const contentElement = article.querySelector('.status__content') ||
                             article.querySelector('div[class*="content"]');
      
      let tootContent = '';
      if (contentElement) {
        // Get text content, preserving line breaks
        const contentClone = contentElement.cloneNode(true);
        // Remove any "Show more" buttons or CW overlays
        contentClone.querySelectorAll('.status__content__spoiler-link, .status__content__read-more-button').forEach(el => el.remove());
        tootContent = contentClone.textContent.trim();
      }

      // Extract timestamp
      let timestamp = null;
      let timestampText = '';
      
      const timeElement = article.querySelector('time');
      if (timeElement) {
        const datetime = timeElement.getAttribute('datetime');
        if (datetime) {
          timestamp = new Date(datetime).getTime();
        }
        timestampText = timeElement.textContent.trim();
      }
      
      if (!timestamp) {
        timestamp = Date.now();
      }

      // Extract engagement metrics
      // Mastodon shows these in the action bar
      let replyCount = 0;
      let boostCount = 0;
      let favoriteCount = 0;

      // Replies
      const replyButton = article.querySelector('.status__action-bar__button[title*="Reply"]') ||
                          article.querySelector('button[aria-label*="Reply"]') ||
                          article.querySelector('[data-reaction-type="reply"]');
      if (replyButton) {
        const replyText = replyButton.textContent.trim();
        const replyMatch = replyText.match(/\d+/);
        replyCount = replyMatch ? parseInt(replyMatch[0]) : 0;
      }

      // Favorites (Likes)
      const favoriteButton = article.querySelector('.status__action-bar__button[title*="Favourite"]') ||
                             article.querySelector('button[aria-label*="Favourite"]') ||
                             article.querySelector('[data-reaction-type="favourite"]');
      if (favoriteButton) {
        const favoriteText = favoriteButton.textContent.trim();
        const favoriteMatch = favoriteText.match(/\d+/);
        favoriteCount = favoriteMatch ? parseInt(favoriteMatch[0]) : 0;
      }

      // Extract media attachments
      const images = [];
      const mediaElements = article.querySelectorAll('.media-gallery__item img, .video-player img, .audio-player img');
      mediaElements.forEach(img => {
        if (img.src && !img.src.includes('avatar')) {
          // Get the full-size image URL if available
          const fullSizeUrl = img.getAttribute('data-original') || img.src;
          images.push(fullSizeUrl);
        }
      });

      // Check for content warnings
      let hasContentWarning = false;
      const cwElement = article.querySelector('.status__content__spoiler-link');
      if (cwElement) {
        hasContentWarning = true;
      }

      // Boosts (Retweets)
      const boostButton = article.querySelector('.status__action-bar__button[title*="Boost"]') ||
                          article.querySelector('button[aria-label*="Boost"]') ||
                          article.querySelector('[data-reaction-type="reblog"]');
      if (boostButton) {
        const boostText = boostButton.textContent.trim();
        const boostMatch = boostText.match(/\d+/);
        boostCount = boostMatch ? parseInt(boostMatch[0]) : 0;
      }

      // Get instance from URL
      const instanceMatch = tootUrl.match(/https?:\/\/([^\/]+)/);
      const instance = instanceMatch ? instanceMatch[1] : 'unknown';

      // Mark as processed
      processedToots.add(tootId);

      return {
        id: tootId,
        platform: 'mastodon',
        instance: instance,
        url: tootUrl,
        author: {
          name: authorName,
          handle: authorHandle,
          avatar: authorAvatar
        },
        content: tootContent,
        timestamp: timestamp,
        timestampText: timestampText,
        engagement: {
          replies: replyCount,
          boosts: boostCount,
          favorites: favoriteCount
        },
        images: images,
        hasContentWarning: hasContentWarning,
        reposter: booster,
        scrapedAt: Date.now()
      };
    } catch (error) {
      console.error('Error extracting Mastodon toot data:', error);
      return null;
    }
  }

  // Send toot data to background script
  function sendTootData(tootData) {
    if (!tootData) return;
    
    chrome.runtime.sendMessage({
      type: 'NEW_POST',
      data: tootData,
      tabId: chrome.runtime.id
    }).catch(err => {
      console.error('Failed to send toot data:', err);
    });
  }

  // Scan for toots in the current viewport
  function scanForToots() {
    // Mastodon uses article.status for each toot
    const tootSelectors = [
      'article.status',
      'article[data-id]',
      'article > div.status',
      
    ];

    let toots = [];
    for (const selector of tootSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        toots = Array.from(elements);
        break;
      }
    }

    toots.forEach(toot => {
      const tootData = extractTootData(toot);
      if (tootData) {
        sendTootData(tootData);
      }
    });
  }

  // Debounced scan function
  const debouncedScan = debounce(scanForToots, 500);

  // Initial scan when script loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanForToots);
  } else {
    // Wait a bit for React/Vue to render
    setTimeout(scanForToots, 1000);
  }

  // Monitor DOM changes for new toots (infinite scroll, real-time updates)
  const observer = new MutationObserver((mutations) => {
    const hasNewToots = mutations.some(mutation => {
      return Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.matches('article.status') || 
                 node.querySelector('article.status') ||
                 node.matches('div.status') ||
                 node.querySelector('div.status');
        }
        return false;
      });
    });

    if (hasNewToots) {
      debouncedScan();
    }
  });

  // Start observing the main timeline
  const targetNode = document.querySelector('main') || 
                     document.querySelector('.scrollable') ||
                     document.querySelector('[role="main"]') ||
                     document.body;
  
  observer.observe(targetNode, {
    childList: true,
    subtree: true
  });

  // Listen for visibility changes (tab switching)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Tab became visible, rescan for new toots
      setTimeout(scanForToots, 1000);
    }
  });

  // Handle navigation within Mastodon's SPA
  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // URL changed, clear processed toots and rescan
      processedToots.clear();
      setTimeout(scanForToots, 1000);
    }
  }).observe(document, { subtree: true, childList: true });

  // Periodic rescan every 30 seconds to catch any missed toots
  setInterval(scanForToots, 30000);

  console.log('Mastodon scraper content script initialized');
})();
