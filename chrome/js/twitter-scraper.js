// twitter-scraper.js
(function() {
  'use strict';

  // Track processed tweets to avoid duplicates
  const processedTweets = new Set();
  
  // Debounce function to limit message sending frequency
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }

// Extract count from aria-label (e.g., "1 Reply. Reply" -> 1)
function extractCountFromAriaLabel(ariaLabel) {
  if (!ariaLabel) return 0;
  
  const match = ariaLabel.match(/^(\d+[\d,]*)/);
  if (match) {
    // Remove commas and parse (e.g., "1,234" -> 1234)
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  
  return 0;
}


// Parse relative time strings like "2h", "5m", "3d" into timestamps
function parseRelativeTime(timeString) {
  if (!timeString) return Date.now();
  
  const now = Date.now();
  const lowerTime = timeString.toLowerCase().trim();
  
  // Match patterns like "2h", "5m ago", "3 days"
  const match = lowerTime.match(/(\d+)\s*(s|sec|second|m|min|minute|h|hour|d|day|w|week|mo|month|y|year)/);
  
  if (!match) return now;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  let milliseconds = 0;
  
  switch (unit[0]) {
    case 's': // seconds
      milliseconds = value * 1000;
      break;
    case 'm': // minutes
      if (unit === 'mo' || unit === 'month') {
        milliseconds = value * 30 * 24 * 60 * 60 * 1000; // approximate
      } else {
        milliseconds = value * 60 * 1000;
      }
      break;
    case 'h': // hours
      milliseconds = value * 60 * 60 * 1000;
      break;
    case 'd': // days
      milliseconds = value * 24 * 60 * 60 * 1000;
      break;
    case 'w': // weeks
      milliseconds = value * 7 * 24 * 60 * 60 * 1000;
      break;
    case 'y': // years
      milliseconds = value * 365 * 24 * 60 * 60 * 1000;
      break;
  }
  
  return now - milliseconds;
}


  // Extract tweet data from article element
  function extractTweetData(article) {
    try {
      // Find the tweet link to get the unique ID and URL
      const tweetLink = article.querySelector('a[href*="/status/"]');
      if (!tweetLink) return null;
      
      const tweetUrl = tweetLink.href;
      const tweetId = tweetUrl.match(/\/status\/(\d+)/)?.[1];

      const timeElement = article.querySelector('time');
      
      if (!tweetId || processedTweets.has(tweetId)) {
        return null;
      }

      // Check if this is a promoted/ad tweet
      const allSpans = article.querySelectorAll('span');
      for (const span of allSpans) {
        if (span.textContent.trim() === 'Ad') {
          return null; // Skip ads
        }
    }

// Check if this is a retweet
    let retweeter = null;
    const retweetIndicator = article.querySelector('span[data-testid="socialContext"]');
    if (retweetIndicator) {
      const retweetText = retweetIndicator.textContent;
      // Extract name from "Username retweeted" or "Username Retweeted"
      const match = retweetText.match(/^(.+?)\s+[Rr]eposted/);
      if (match) {
        retweeter = match[1].trim();
      }
    }

      // Extract author information
      const userNamesDiv = article.querySelector('div[data-testid="User-Name"]');
      let authorName = '';
      let authorHandle = '';
      let authorAvatar = '';
      let timestamp = null;
      let timestampText = '';
      
      if (timeElement) {
        // Get ISO datetime if available (most reliable)
        const datetime = timeElement.getAttribute('datetime');
        if (datetime) {
          timestamp = new Date(datetime).getTime();
        }
        timestampText = timeElement.textContent || '';
      }


if (userNamesDiv) {
  const text = userNamesDiv.textContent;
  // Split by both newlines and '·' delimiter
  const parts = text.split(/[\n·]/).map(s => s.trim()).filter(s => s.length > 0);
  
  authorName = parts[0] || '';
  authorHandle = parts[1] || '';
  timestamp = parts[3] || parts[2] || '';
}
      if (userNamesDiv) {
        const userText = userNamesDiv.textContent.split(/[\n·@]/).map(s => s.trim()).filter(s => s.length > 0);
        authorName = userText[0] || '';
        authorHandle = userText[1] || '';

        // Fallback: parse relative time from user info
        if (!timestamp && userNamesDiv) {
          timestampText = userText[3] || userText[2] || '';
          timestamp = parseRelativeTime(timestampText);
        }

      }

      // Extract author avatar
      const avatarImg = article.querySelector('div[data-testid="Tweet-User-Avatar"] img') ||
                        article.querySelector('a[href*="profile_images"] img') ||
                        article.querySelector('img[alt][src*="profile"]');
      if (avatarImg) {
        authorAvatar = avatarImg.src;
      }

      // Extract tweet text
      const tweetTextDiv = article.querySelector('div[data-testid="tweetText"]');
      const tweetText = tweetTextDiv ? tweetTextDiv.textContent : '';

      // Extract engagement metrics
      const replyButton = article.querySelector('button[data-testid="reply"]');
      const replyCount = replyButton ? extractCountFromAriaLabel(replyButton.getAttribute('aria-label')) : 0;
      
      const retweetButton = article.querySelector('button[data-testid="retweet"]');
      const retweetCount = retweetButton ? extractCountFromAriaLabel(retweetButton.getAttribute('aria-label')) : 0;
      
      const likeButton = article.querySelector('button[data-testid="like"]');
      const likeCount = likeButton ? extractCountFromAriaLabel(likeButton.getAttribute('aria-label')) : 0;

      // Extract images if present
      const images = [];
      const imgElements = article.querySelectorAll('div[data-testid="tweetPhoto"] img');
      imgElements.forEach(img => {
        if (img.src && !img.src.includes('profile_images')) {
          images.push(img.src);
        }
      });

      // Mark as processed
      processedTweets.add(tweetId);

      return {
            id: tweetId,
            platform: 'twitter',
            url: tweetUrl,
            author: {
              name: authorName,
              handle: authorHandle,
              avatar: authorAvatar
            },
            content: tweetText,
            timestamp: timestamp,
            timestampText: timestampText,
            scrapedAt: Date.now(),
            engagement: {
              replies: replyCount,
              retweets: retweetCount,
              likes: likeCount
            },
            images: images,
            reposter: retweeter
          };
    } catch (error) {
      console.error('Error extracting tweet data:', error);
      return null;
    }
  }

  // Send tweet data to background script
  function sendTweetData(tweetData) {
    if (!tweetData) return;
    
    chrome.runtime.sendMessage({
      type: 'NEW_POST',
      data: tweetData,
      tabId: chrome.runtime.id
    }).catch(err => {
      console.error('Failed to send tweet data:', err);
    });
  }

  // Scan for tweets in the current viewport
  function scanForTweets() {
    // Multiple selectors for reliability across X's UI changes
    const tweetSelectors = [
      'article[data-testid="tweet"]',
      'div[data-testid="tweet"]',
      'article[role="article"]'
    ];

    let tweets = [];
    for (const selector of tweetSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        tweets = Array.from(elements);
        break;
      }
    }

    tweets.forEach(tweet => {
      const tweetData = extractTweetData(tweet);
      if (tweetData) {
        sendTweetData(tweetData);
      }
    });
  }

  // Debounced scan function
  const debouncedScan = debounce(scanForTweets, 500);

  // Initial scan when script loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanForTweets);
  } else {
    scanForTweets();
  }

  // Monitor DOM changes for new tweets (infinite scroll, real-time updates)
  const observer = new MutationObserver((mutations) => {
    // Check if any mutations added post-like elements
    const hasNewPosts = mutations.some(mutation => {
      return Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.matches('article') || 
                 node.querySelector('a[href*="/post/"]') ||
                 node.getAttribute?.('data-testid')?.startsWith('feedItem') ||
                 node.getAttribute?.('data-testid')?.includes('postThread') ||
                 node.querySelector('[data-testid^="feedItem"]');
        }
        return false;
      });
    });
  
    if (hasNewPosts) {
      debouncedScan();
    }
  });

  // Start observing the main timeline
  const targetNode = document.querySelector('main') || document.body;
  observer.observe(targetNode, {
    childList: true,
    subtree: true
  });

  // Listen for visibility changes (tab switching)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Tab became visible, rescan for new tweets
      setTimeout(scanForTweets, 1000);
    }
  });

  // Periodic rescan every 30 seconds to catch any missed tweets
  setInterval(scanForTweets, 30000);

  console.log('X/Twitter scraper content script initialized');
})();
