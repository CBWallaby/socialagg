// bluesky-scraper.js
(function() {
  'use strict';

  // Track processed posts to avoid duplicates
  const processedPosts = new Set();
  
  // Debounce function to limit message sending frequency
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
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


  // Extract post data from feed item element
  function extractPostData(feedItem) {
    try {
      // Find the post link to get the unique URI and URL
      const postLink = feedItem.querySelector('a[href*="/post/"]');
      if (!postLink) return null;
      
      const postUrl = postLink.href;
      // BlueSky post URLs: bsky.app/profile/{handle}/post/{postId}
      const postMatch = postUrl.match(/\/profile\/([^\/]+)\/post\/([^\/\?]+)/);
      if (!postMatch) return null;
      
      const authorHandle = postMatch[1];
      const postId = postMatch[2];
      const uniqueId = `${authorHandle}-${postId}`;
      
      if (processedPosts.has(uniqueId)) {
        return null;
      }

// Check for reposts (reposted by someone)
    let reposter = null;
    const repostLink = feedItem.querySelector('a[aria-label^="Reposted by"]');
    if (repostLink) {
      const ariaLabel = repostLink.getAttribute('aria-label');
      // Extract name from "Reposted by Username"
      const match = ariaLabel.match(/^Reposted by\s+(.+)$/);
      if (match) {
        reposter = match[1].trim();
        // Clean up HTML entities if present (e.g., "&gt;" becomes ">")
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = reposter;
        reposter = tempDiv.textContent;
      }
    }

// Extract timestamp with better accuracy
let timestamp = null;
let timestampText = '';

// BlueSky stores the full timestamp in the post link's data-tooltip attribute
if (postLink) {
  const tooltip = postLink.getAttribute('data-tooltip');
  if (tooltip) {
    // Parse the full date string (e.g., "February 7, 2026 at 9:32 PM")
    const parsedDate = new Date(tooltip);
    if (!isNaN(parsedDate.getTime())) {
      timestamp = parsedDate.getTime();
    }
  }
  
  // Get the relative time text that's displayed (e.g., "1d")
  timestampText = postLink.textContent.trim().replace(/^·\s*/, ''); // Remove leading dot
}

// Fallback: try to find a time element
if (!timestamp) {
  const timeElement = feedItem.querySelector('time');
  if (timeElement) {
    const datetime = timeElement.getAttribute('datetime');
    if (datetime) {
      timestamp = new Date(datetime).getTime();
    } else {
      timestampText = timeElement.textContent.trim();
      timestamp = parseRelativeTime(timestampText);
    }
  }
}

// Final fallback: parse the relative time text if we have it
if (!timestamp && timestampText) {
  timestamp = parseRelativeTime(timestampText);
}

// Last resort: use scrape time
if (!timestamp) {
  timestamp = Date.now();
}


      // Extract author information
      let authorName = '';
      let authorAvatar = '';
      
      // Look for author name - usually in a link or span near the top
      const authorNameElement = feedItem.querySelector('a[aria-label="View profile"]');
      
      if (authorNameElement) {
        authorName = authorNameElement.textContent.trim();
      }

      // Extract author avatar
      const avatarImg = feedItem.querySelector('img[alt*="avatar"]') ||
                        feedItem.querySelector('img[src*="avatar"]') ||
                        feedItem.querySelector('a[href*="/profile/"] img');
      if (avatarImg) {
        authorAvatar = avatarImg.src;
      }

      // Extract post text content
      // BlueSky wraps post content in specific divs
      const postTextElement = feedItem.querySelector('[data-testid="postText"]') ||
                              feedItem.querySelector('div[style*="white-space"]');
      
      let postText = '';
      if (postTextElement) {
        postText = postTextElement.textContent.trim();
      }

      // Extract engagement metrics
      // BlueSky typically shows these as buttons or spans with counts
      let replyCount = 0;
      let repostCount = 0;
      let likeCount = 0;

      // Find engagement buttons/counters
      const engagementElements = feedItem.querySelectorAll('button, [role="button"]');
      engagementElements.forEach(elem => {
        const ariaLabel = elem.getAttribute('aria-label') || '';
        const textContent = elem.textContent.trim();
        
        // Match patterns like "5 replies", "Reply (5)", etc.
        if (ariaLabel.toLowerCase().includes('repl') || 
            elem.querySelector('[data-testid*="reply"]')) {
          const match = textContent.match(/\d+/);
          replyCount = match ? parseInt(match[0]) : 0;
        }
        else if (ariaLabel.toLowerCase().includes('repost') || 
                 elem.querySelector('[data-testid*="repost"]')) {
          const match = textContent.match(/\d+/);
          repostCount = match ? parseInt(match[0]) : 0;
        }
        else if (ariaLabel.toLowerCase().includes('like') || 
                 elem.querySelector('[data-testid*="like"]')) {
          const match = textContent.match(/\d+/);
          likeCount = match ? parseInt(match[0]) : 0;
        }
      });

      // Extract images if present
      const images = [];
      const imgElements = feedItem.querySelectorAll('img[src*="cdn.bsky"]');
      imgElements.forEach(img => {
        // Skip avatar images
        if (!img.src.includes('avatar') && !img.alt?.toLowerCase().includes('avatar')) {
          images.push(img.src);
        }
      });

      // Extract embedded content (quoted posts, links, etc.)
      let hasQuote = false;
      const quoteElement = feedItem.querySelector('[data-testid="quotedPost"]') ||
                           feedItem.querySelector('div[style*="border"]');
      if (quoteElement) {
        hasQuote = true;
      }

      // Mark as processed
      processedPosts.add(uniqueId);

      return {
        id: uniqueId,
        platform: 'bluesky',
        url: postUrl,
        author: {
          name: authorName,
          handle: authorHandle,
          avatar: authorAvatar
        },
        content: postText,
        timestamp: timestamp,           // Actual post timestamp
        timestampText: timestampText,   // Original text like "2h ago"
        engagement: {
          replies: replyCount,
          reposts: repostCount,
          likes: likeCount
        },
        images: images,
        hasQuote: hasQuote,
        reposter: reposter,
        scrapedAt: Date.now()
      };
    } catch (error) {
      console.error('Error extracting BlueSky post data:', error);
      return null;
    }
  }

  // Send post data to background script
  function sendPostData(postData) {
    if (!postData) return;
    
    chrome.runtime.sendMessage({
      type: 'NEW_POST',
      data: postData,
      tabId: chrome.runtime.id
    }).catch(err => {
      console.error('Failed to send post data:', err);
    });
  }

  // Scan for posts in the current viewport
  function scanForPosts() {
    // BlueSky uses various container structures, try multiple selectors
    const postSelectors = [
      '[data-testid^="feedItem"]',
      '[data-testid="feedItem"]',
      '[data-testid="postThreadItem"]',
      'div[style*="padding"] > div[style*="border-bottom"]',
      'article',
      // Fallback: look for containers with post links
      'div:has(a[href*="/post/"])'
    ];

    let posts = [];
    for (const selector of postSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          posts = Array.from(elements);
          break;
        }
      } catch (e) {
        // Some selectors (like :has) may not work in all contexts
        continue;
      }
    }

    // Fallback: find all divs containing post links
    if (posts.length === 0) {
      const allLinks = document.querySelectorAll('a[href*="/post/"]');
      const containers = new Set();
      allLinks.forEach(link => {
        // Find the nearest container (typically 3-5 levels up)
        let parent = link.parentElement;
        for (let i = 0; i < 5; i++) {
          if (parent && parent.querySelector('time') && 
              parent.querySelector('button, [role="button"]')) {
            containers.add(parent);
            break;
          }
          parent = parent?.parentElement;
        }
      });
      posts = Array.from(containers);
    }

    posts.forEach(post => {
      const postData = extractPostData(post);
      if (postData) {
        sendPostData(postData);
      }
    });
  }

  // Debounced scan function
  const debouncedScan = debounce(scanForPosts, 500);

  // Initial scan when script loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanForPosts);
  } else {
    // Wait a bit for BlueSky's React app to render
    setTimeout(scanForPosts, 1500);
  }

  // Monitor DOM changes for new posts (infinite scroll, navigation)
  const observer = new MutationObserver((mutations) => {
    // Check if any mutations added post-like elements
    const hasNewPosts = mutations.some(mutation => {
      return Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.matches('article') || 
                 node.querySelector('a[href*="/post/"]') ||
                 node.getAttribute?.('data-testid')?.includes('feedItem') ||
                 node.getAttribute?.('data-testid')?.includes('postThread');
        }
        return false;
      });
    });

    if (hasNewPosts) {
      debouncedScan();
    }
  });

  // Start observing the main feed container
  const targetNode = document.querySelector('main') || 
                     document.querySelector('[role="main"]') || 
                     document.body;
  
  observer.observe(targetNode, {
    childList: true,
    subtree: true
  });

  // Listen for visibility changes (tab switching)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // Tab became visible, rescan for new posts
      setTimeout(scanForPosts, 1000);
    }
  });

  // Handle navigation within BlueSky's SPA
  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // URL changed, clear processed posts and rescan
      processedPosts.clear();
      setTimeout(scanForPosts, 1500);
    }
  }).observe(document, { subtree: true, childList: true });

  // Periodic rescan every 30 seconds to catch any missed posts
  setInterval(scanForPosts, 30000);

  console.log('BlueSky scraper content script initialized');
})();
