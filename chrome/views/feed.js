// feed.js
'use strict';

let currentFilter = 'all';
let currentSort = 'chronological';
let currentAuthor = 'all';
let allPosts = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadFeed();
  
  // Listen for real-time updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'FEED_UPDATED') {
      loadFeed();
    } else if (message.type === 'FEED_CLEARED') {
      allPosts = [];
      renderFeed();
    }
  });
  
  // Auto-refresh every 10 seconds
  setInterval(loadFeed, 10000);
});

// Setup event listeners
function setupEventListeners() {
  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderFeed();
    });
  });
  
  // Sort select
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderFeed();
  });
  
  // Author select
  document.getElementById('authorSelect').addEventListener('change', (e) => {
    currentAuthor = e.target.value;
    const clearBtn = document.getElementById('clearAuthorBtn');
    clearBtn.style.display = currentAuthor === 'all' ? 'none' : 'block';
    renderFeed();
  });
  
  // Clear author filter button
  document.getElementById('clearAuthorBtn').addEventListener('click', () => {
    const authorSelect = document.getElementById('authorSelect');
    authorSelect.value = 'all';
    currentAuthor = 'all';
    document.getElementById('clearAuthorBtn').style.display = 'none';
    renderFeed();
  });
  
  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    await chrome.runtime.sendMessage({ type: 'REFRESH_FEED' });
    await loadFeed();
    setTimeout(() => btn.disabled = false, 2000);
  });
  
  // Clear button
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (confirm('Clear all posts from the feed?')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_FEED' });
      allPosts = [];
      renderFeed();
    }
  });
}

// Load feed from background
async function loadFeed() {
  try {
    const response = await chrome.runtime.sendMessage({ 
      type: 'GET_FEED',
      sortBy: currentSort
    });
    
    if (response && response.feed) {
      allPosts = response.feed;
      renderFeed();
      updateStats();
    }
  } catch (error) {
    console.error('Failed to load feed:', error);
  }
}

// Update author dropdown with unique authors
function updateAuthorDropdown() {
  const authorSelect = document.getElementById('authorSelect');
  const currentValue = authorSelect.value;
  
  // Get unique authors by handle only (not handle@platform)
  // Exclude posts that are reposts (where reposter is present)
  const authors = new Map();
  allPosts.forEach(post => {
    // Skip reposts - they shouldn't count toward author list
    if (post.reposter) {
      return;
    }
    
    const key = post.author.handle; // Use only handle as key
    if (!authors.has(key)) {
      authors.set(key, {
        handle: post.author.handle,
        name: post.author.name,
        platforms: new Set([post.platform]),
        count: 0
      });
    } else {
      // Add platform to the set
      authors.get(key).platforms.add(post.platform);
    }
    authors.get(key).count++;
  });
  
  // Sort authors by post count (descending)
  const sortedAuthors = Array.from(authors.values())
    .sort((a, b) => b.count - a.count);
  
  // Rebuild dropdown
  authorSelect.innerHTML = '<option value="all">All Authors</option>';
  
  sortedAuthors.forEach(author => {
    const option = document.createElement('option');
    option.value = author.handle; // Store just the handle
    
    // Show platform emojis for all platforms this author appears on
    const platformEmojis = Array.from(author.platforms).map(p => 
      p === 'twitter' ? '𝕏' : p === 'bluesky' ? '🦋' : '🐘'
    ).join('');
    
    option.textContent = `${platformEmojis} ${author.name} (@${author.handle}) · ${author.count}`;
    authorSelect.appendChild(option);
  });
  
  // Restore previous selection if it still exists
  if (currentValue !== 'all' && Array.from(authorSelect.options).some(opt => opt.value === currentValue)) {
    authorSelect.value = currentValue;
  } else if (currentValue !== 'all') {
    // Previous author no longer exists, reset
    authorSelect.value = 'all';
    currentAuthor = 'all';
    document.getElementById('clearAuthorBtn').style.display = 'none';
  }
}


// Render feed
function renderFeed() {
  // Update author dropdown first
  updateAuthorDropdown();
  
  const container = document.getElementById('feedContainer');
  const emptyState = document.getElementById('emptyState');
  
  // Filter posts by platform
  let filteredPosts = allPosts;
  if (currentFilter !== 'all') {
    filteredPosts = filteredPosts.filter(post => post.platform === currentFilter);
  }
  
  // Filter posts by author (handle only, across all platforms)
  if (currentAuthor !== 'all') {
    filteredPosts = filteredPosts.filter(post => post.author.handle === currentAuthor);
  }
  
  // Show/hide empty state
  if (filteredPosts.length === 0) {
    container.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }
  
  container.style.display = 'flex';
  emptyState.style.display = 'none';
  
  // Render posts
  container.innerHTML = filteredPosts.map(post => createPostHTML(post)).join('');
  
  // Add click handlers
  container.querySelectorAll('.post-card').forEach((card, index) => {
    card.addEventListener('click', () => {
      const post = filteredPosts[index];
      chrome.runtime.sendMessage({ 
        type: 'OPEN_POST',
        url: post.url
      });
    });
  });
}

// Create post HTML
function createPostHTML(post) {
  const initials = post.author.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const timestamp = formatTimestamp(post.timestamp || post.scrapedAt);
  
  // Use avatar if available, otherwise fall back to initials
  const avatarHTML = post.author.avatar 
    ? `<img src="${escapeHtml(post.author.avatar)}" alt="${escapeHtml(post.author.name)}" class="post-avatar-img">`
    : `<div class="post-avatar-initials">${initials}</div>`;
  
  // Determine repost verb based on platform
  const repostVerb = post.platform === 'mastodon' ? 'Boosted' : 
                     post.platform === 'twitter' ? 'Retweeted' : 'Reposted';
  
  return `
    <div class="post-card" data-post-id="${post.id}">
      ${post.reposter ? `
        <div class="repost-indicator">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
          ${repostVerb} by ${escapeHtml(post.reposter)}
        </div>
      ` : ''}
      <div class="post-header">
        <div class="post-avatar">
          ${avatarHTML}
        </div>
        <div class="post-meta">
          <div class="post-author">
            <span class="author-name">${escapeHtml(post.author.name)}</span>
            <span class="author-handle">@${escapeHtml(post.author.handle)}</span>
            <span class="platform-badge ${post.platform}">
              ${post.platform === 'twitter' ? '𝕏' : post.platform === 'bluesky' ? '🦋' : '🐘'} 
              ${post.platform === 'twitter' ? 'X' : post.platform === 'bluesky' ? 'BlueSky' : 'Mastodon'}
            </span>
          </div>
          <div class="post-timestamp">${timestamp}</div>
        </div>
      </div>
      
      <div class="post-content">${escapeHtml(post.content)}</div>
      
      ${post.images && post.images.length > 0 ? `
        <div class="post-images">
          ${post.images.map(img => `<img src="${img}" alt="Post image" loading="lazy">`).join('')}
        </div>
      ` : ''}
      
      <div class="post-engagement">
        <div class="engagement-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>${formatNumber(post.engagement.replies)}</span>
        </div>
        <div class="engagement-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
          <span>${formatNumber(post.engagement.retweets || post.engagement.reposts || post.engagement.boosts || 0)}</span>
        </div>
        <div class="engagement-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <span>${formatNumber(post.engagement.likes || post.engagement.favorites || 0)}</span>
        </div>
      </div>
    </div>
  `;
}

// Update stats
function updateStats() {
  document.getElementById('postCount').textContent = `${allPosts.length} ${allPosts.length === 1 ? 'post' : 'posts'}`;
  
  // Get unique tab count
  const uniqueTabs = new Set(allPosts.map(p => p.sourceTabId)).size;
  document.getElementById('tabCount').textContent = `${uniqueTabs} ${uniqueTabs === 1 ? 'tab' : 'tabs'}`;
}

// Helper functions
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
