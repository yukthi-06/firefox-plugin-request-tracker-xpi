// Session Resource Logger - Logger Script
// Manages the UI, filters, virtualized table rendering, and exports.

const ROW_HEIGHT = 40;
const scrollContainer = document.querySelector('.resizable-table-wrapper');
const tableBody = document.getElementById('table-body');
const recordCountEl = document.getElementById('record-count');

let allLogs = [];
let filteredLogs = [];

// Stats Counters
const stats = {
  pages: 0,
  resources: 0,
  size: 0,
  images: 0,
  scripts: 0,
  css: 0,
  audio: 0,
  failed: 0
};

// Filter States
let searchTerm = '';
let filterEventType = 'all';
let filterResourceType = 'all';
let filterStatus = 'all';
let autoScroll = true;

let trackingActive = true;

// UI Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Bind UI Controls
  document.getElementById('search-input').addEventListener('input', debounce(handleSearch, 150));
  document.getElementById('filter-event-type').addEventListener('change', handleFilterChange);
  document.getElementById('filter-resource-type').addEventListener('change', handleFilterChange);
  document.getElementById('filter-status').addEventListener('change', handleFilterChange);
  document.getElementById('auto-scroll-check').addEventListener('change', handleAutoScrollChange);
  
  document.getElementById('toggle-capture-btn').addEventListener('click', handleToggleCapture);
  document.getElementById('clear-btn').addEventListener('click', handleClearLogs);
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
  document.getElementById('export-txt-btn').addEventListener('click', exportTXT);

  // Scroll Container listener for virtual table
  scrollContainer.addEventListener('scroll', renderTable);
  window.addEventListener('resize', renderTable);

  // Initialize Column Resizing
  initResizableColumns();

  // Load Existing Logs from Background Script
  browser.runtime.sendMessage({ action: "getLogs" }).then((response) => {
    if (response) {
      if (Array.isArray(response.logs)) {
        allLogs = response.logs;
        // Sort newest first
        allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        recalculateStats();
        applyFilters();
        
        if (autoScroll) {
          scrollContainer.scrollTop = 0;
        }
      }
      if (response.trackingActive !== undefined) {
        trackingActive = response.trackingActive;
        updateTrackingStateUI();
      }
    }
  }).catch((err) => {
    console.error("Error fetching initial logs from background:", err);
  });
});

function handleToggleCapture() {
  browser.runtime.sendMessage({ action: "toggleTracking" }).then((response) => {
    if (response && response.trackingActive !== undefined) {
      trackingActive = response.trackingActive;
      updateTrackingStateUI();
    }
  }).catch((err) => {
    console.error("Error toggling tracking:", err);
  });
}

function updateTrackingStateUI() {
  const btn = document.getElementById('toggle-capture-btn');
  const indicator = document.querySelector('.pulse-indicator');
  
  if (trackingActive) {
    btn.textContent = 'Stop Capture';
    btn.className = 'btn btn-secondary';
    indicator.classList.remove('inactive');
  } else {
    btn.textContent = 'Start Capture';
    btn.className = 'btn btn-primary';
    indicator.classList.add('inactive');
  }
}

// Real-time Event Receiver
browser.runtime.onMessage.addListener((message) => {
  if (message.action === "newLog") {
    const log = message.data;
    
    // Add to top (newest first)
    allLogs.unshift(log);
    
    // Update Stats live
    updateStatsForEntry(log);
    
    // Check if log passes current filters
    if (matchFilters(log)) {
      filteredLogs.unshift(log);
      
      // Update count & render
      updateRecordCountDisplay();
      renderTable();

      // If auto-scroll is on, keep at the top
      if (autoScroll) {
        scrollContainer.scrollTop = 0;
      }
    }
  }
});

// Format Time (HH:MM:SS.mmm)
function formatTime(isoString) {
  try {
    const date = new Date(isoString);
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  } catch (e) {
    return "";
  }
}

// Format bytes to human readable format
function formatBytes(bytes) {
  if (bytes === undefined || bytes === null || bytes < 0) return "-";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Normalize resource types for badge styling
function normalizeResourceType(type) {
  if (!type) return 'other';
  const t = type.toLowerCase();
  if (t === 'stylesheet') return 'stylesheet';
  if (t === 'script') return 'script';
  if (t === 'image' || t === 'imageset') return 'image';
  if (t === 'font') return 'font';
  if (t === 'xmlhttprequest' || t === 'websocket') return 'xhr';
  return 'other';
}

// Create Row HTML string
function createRowHtml(log) {
  const isPage = log.type === 'page';
  const timeStr = formatTime(log.timestamp);
  
  let statusClass = '';
  let statusText = log.statusCode;
  
  if (isPage) {
    statusText = '-';
  } else {
    if (log.statusCode === -1) {
      statusClass = 'status-server-error';
      statusText = 'Failed';
    } else if (log.statusCode >= 200 && log.statusCode < 300) {
      statusClass = 'status-success';
    } else if (log.statusCode >= 300 && log.statusCode < 400) {
      statusClass = 'status-redirect';
    } else if (log.statusCode >= 400 && log.statusCode < 500) {
      statusClass = 'status-client-error';
    } else if (log.statusCode >= 500) {
      statusClass = 'status-server-error';
    }
  }

  const sizeText = (isPage || log.fileSize === -1) ? '-' : formatBytes(log.fileSize);
  const badgeClass = isPage ? 'badge-page' : `badge-${normalizeResourceType(log.resourceType)}`;
  const badgeText = isPage ? 'page' : log.resourceType;
  
  // HTML entities escape helper
  const esc = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const pageUrlVal = log.pageUrl || log.url || '';
  const resourceUrlVal = log.type === 'page' ? '' : (log.resourceUrl || '');

  return `
    <tr style="height: ${ROW_HEIGHT}px;">
      <td class="timestamp-cell" title="${esc(log.timestamp)}">${esc(timeStr)}</td>
      <td><span class="badge ${badgeClass}">${esc(badgeText)}</span></td>
      <td title="${esc(pageUrlVal)}">
        ${pageUrlVal ? `<a href="${esc(pageUrlVal)}" target="_blank" class="url-link">${esc(pageUrlVal)}</a>` : '-'}
      </td>
      <td title="${esc(resourceUrlVal)}">
        ${resourceUrlVal ? `<a href="${esc(resourceUrlVal)}" target="_blank" class="url-link">${esc(resourceUrlVal)}</a>` : '-'}
      </td>
      <td title="${esc(log.resourceType || '-')}">${esc(log.resourceType || '-')}</td>
      <td class="${statusClass}">${esc(statusText)}</td>
      <td class="size-cell">${esc(sizeText)}</td>
      <td class="mime-cell" title="${esc(log.mimeType)}">${esc(log.mimeType)}</td>
      <td class="domain-cell" title="${esc(log.domain)}">${esc(log.domain)}</td>
    </tr>
  `;
}

// Virtual Table Renderer
function renderTable() {
  const totalItems = filteredLogs.length;
  
  if (totalItems === 0) {
    document.getElementById('empty-state').style.display = 'flex';
    tableBody.innerHTML = '';
    return;
  } else {
    document.getElementById('empty-state').style.display = 'none';
  }
  
  const containerHeight = scrollContainer.clientHeight || 500;
  const scrollTop = scrollContainer.scrollTop;
  
  let startIndex = Math.floor(scrollTop / ROW_HEIGHT);
  let endIndex = Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT);
  
  // Buffers
  startIndex = Math.max(0, startIndex - 8);
  endIndex = Math.min(totalItems, endIndex + 8);
  
  const topSpacerHeight = startIndex * ROW_HEIGHT;
  const bottomSpacerHeight = (totalItems - endIndex) * ROW_HEIGHT;
  
  let html = `<tr style="height: ${topSpacerHeight}px; border: none;"><td colspan="9" style="padding: 0; border: none; height: ${topSpacerHeight}px;"></td></tr>`;
  
  for (let i = startIndex; i < endIndex; i++) {
    html += createRowHtml(filteredLogs[i]);
  }
  
  html += `<tr style="height: ${bottomSpacerHeight}px; border: none;"><td colspan="9" style="padding: 0; border: none; height: ${bottomSpacerHeight}px;"></td></tr>`;
  
  tableBody.innerHTML = html;
}

// Filter Matching Logic
function matchFilters(log) {
  // 1. Event Type Filter
  if (filterEventType === 'page' && log.type !== 'page') return false;
  if (filterEventType === 'resource' && log.type !== 'resource') return false;

  // 2. Resource Type Filter
  if (filterResourceType !== 'all') {
    if (log.type === 'page') return false;
    
    const rt = (log.resourceType || '').toLowerCase();
    const mime = (log.mimeType || '').toLowerCase();
    
    if (filterResourceType === 'image' && rt !== 'image' && rt !== 'imageset') return false;
    if (filterResourceType === 'script' && rt !== 'script') return false;
    if (filterResourceType === 'stylesheet' && rt !== 'stylesheet') return false;
    if (filterResourceType === 'font' && rt !== 'font') return false;
    if (filterResourceType === 'audio' && !(rt === 'media' && mime.includes('audio'))) return false;
    if (filterResourceType === 'video' && !(rt === 'media' && mime.includes('video'))) return false;
    if (filterResourceType === 'xmlhttprequest' && rt !== 'xmlhttprequest') return false;
    if (filterResourceType === 'websocket' && rt !== 'websocket') return false;
    if (filterResourceType === 'fetch' && rt !== 'ping' && rt !== 'beacon' && rt !== 'csp_report') return false;
    
    if (filterResourceType === 'other') {
      const known = ['image', 'imageset', 'script', 'stylesheet', 'font', 'xmlhttprequest', 'websocket', 'ping', 'beacon', 'csp_report', 'media'];
      if (known.includes(rt)) return false;
    }
  }

  // 3. Status Code Filter
  if (filterStatus !== 'all') {
    if (log.type === 'page') return false;
    
    const sc = log.statusCode;
    if (filterStatus === 'failed' && sc !== -1) return false;
    if (filterStatus === '200' && sc !== 200) return false;
    if (filterStatus === 'success' && (sc < 200 || sc >= 300)) return false;
    if (filterStatus === 'redirect' && (sc < 300 || sc >= 400)) return false;
    if (filterStatus === 'client-error' && (sc < 400 || sc >= 500)) return false;
    if (filterStatus === 'server-error' && sc < 500) return false;
  }

  // 4. Search text box (checks URL, Resource URL, Domain)
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    const pageUrl = (log.pageUrl || log.url || '').toLowerCase();
    const resUrl = (log.resourceUrl || '').toLowerCase();
    const domain = (log.domain || '').toLowerCase();
    
    if (!pageUrl.includes(q) && !resUrl.includes(q) && !domain.includes(q)) return false;
  }

  return true;
}

// Re-filter and re-render Table
function applyFilters() {
  filteredLogs = allLogs.filter(matchFilters);
  updateRecordCountDisplay();
  renderTable();
}

function updateRecordCountDisplay() {
  recordCountEl.textContent = `${filteredLogs.length} items showing (${allLogs.length} total)`;
}

// Handlers for Input Changes
function handleSearch(e) {
  searchTerm = e.target.value.trim();
  applyFilters();
}

function handleFilterChange() {
  filterEventType = document.getElementById('filter-event-type').value;
  filterResourceType = document.getElementById('filter-resource-type').value;
  filterStatus = document.getElementById('filter-status').value;
  applyFilters();
}

function handleAutoScrollChange(e) {
  autoScroll = e.target.checked;
}

// Recalculate Statistics
function recalculateStats() {
  stats.pages = 0;
  stats.resources = 0;
  stats.size = 0;
  stats.images = 0;
  stats.scripts = 0;
  stats.css = 0;
  stats.audio = 0;
  stats.failed = 0;

  for (const log of allLogs) {
    updateStatsForEntry(log, false);
  }
  updateStatsUI();
}

// Update state counters for a single entry
function updateStatsForEntry(log, updateUI = true) {
  if (log.type === 'page') {
    stats.pages++;
  } else {
    stats.resources++;
    if (log.fileSize > 0) {
      stats.size += log.fileSize;
    }
    
    const rt = (log.resourceType || '').toLowerCase();
    const mime = (log.mimeType || '').toLowerCase();
    
    if (rt === 'image' || rt === 'imageset') {
      stats.images++;
    } else if (rt === 'script') {
      stats.scripts++;
    } else if (rt === 'stylesheet') {
      stats.css++;
    } else if (rt === 'media' && mime.includes('audio')) {
      stats.audio++;
    }
    
    if (log.statusCode === -1 || (log.statusCode >= 400 && log.statusCode < 600)) {
      stats.failed++;
    }
  }

  if (updateUI) {
    updateStatsUI();
  }
}

// Sync counts to the UI components
function updateStatsUI() {
  document.getElementById('stat-pages').textContent = stats.pages;
  document.getElementById('stat-resources').textContent = stats.resources;
  document.getElementById('stat-size').textContent = formatBytes(stats.size);
  document.getElementById('stat-images').textContent = stats.images;
  document.getElementById('stat-scripts').textContent = stats.scripts;
  document.getElementById('stat-css').textContent = stats.css;
  document.getElementById('stat-audio').textContent = stats.audio;
  document.getElementById('stat-failed').textContent = stats.failed;
}

// Clear logs action
function handleClearLogs() {
  if (confirm("Are you sure you want to clear this tracking session?")) {
    browser.runtime.sendMessage({ action: "clearLogs" }).then(() => {
      allLogs = [];
      filteredLogs = [];
      recalculateStats();
      applyFilters();
    });
  }
}

// Export functions
function getTimestampFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function exportCSV() {
  if (allLogs.length === 0) {
    alert("No data available to export.");
    return;
  }

  const csvRows = [
    ['timestamp', 'eventType', 'pageUrl', 'resourceUrl', 'resourceType', 'statusCode', 'fileSize', 'mimeType', 'domain', 'tabId']
  ];
  
  for (const log of allLogs) {
    const pageUrlVal = log.pageUrl || log.url || '';
    const resUrlVal = log.type === 'page' ? '' : (log.resourceUrl || '');
    csvRows.push([
      log.timestamp,
      log.type,
      pageUrlVal,
      resUrlVal,
      log.type === 'page' ? '' : (log.resourceType || ''),
      log.type === 'page' ? '' : log.statusCode,
      log.type === 'page' ? '' : log.fileSize,
      log.type === 'page' ? '' : log.mimeType,
      log.domain || '',
      log.tabId
    ]);
  }
  
  const csvContent = csvRows.map(row => 
    row.map(val => `"${String(val !== undefined && val !== null ? val : '').replace(/"/g, '""')}"`).join(",")
  ).join("\n");
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const filename = `session_log_${getTimestampFilename()}.csv`;
  browser.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
}

function exportTXT() {
  if (allLogs.length === 0) {
    alert("No URLs available to export.");
    return;
  }

  const urlSet = new Set();
  for (const log of allLogs) {
    if (log.type === 'page') {
      if (log.url) urlSet.add(log.url);
    } else {
      if (log.resourceUrl) urlSet.add(log.resourceUrl);
    }
  }
  
  const txtContent = Array.from(urlSet).join("\n");
  const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const filename = `session_urls_${getTimestampFilename()}.txt`;
  browser.downloads.download({
    url: url,
    filename: filename,
    saveAs: true
  });
}

// Resizable Columns Logic
function initResizableColumns() {
  const ths = document.querySelectorAll('.event-table th');
  ths.forEach(th => {
    th.addEventListener('mousedown', (e) => {
      const rect = th.getBoundingClientRect();
      const edgeSize = 10;
      // If client clicked within edgeSize px of the right boundary
      if (rect.right - e.clientX <= edgeSize) {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = th.offsetWidth;
        
        const onMouseMove = (moveEvent) => {
          const newWidth = Math.max(60, startWidth + (moveEvent.clientX - startX));
          th.style.width = newWidth + 'px';
          renderTable(); // Recalculate virtualization based on potential size alterations
        };
        
        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }
    });

    th.addEventListener('mousemove', (e) => {
      const rect = th.getBoundingClientRect();
      const edgeSize = 10;
      if (rect.right - e.clientX <= edgeSize) {
        th.style.cursor = 'col-resize';
      } else {
        th.style.cursor = '';
      }
    });
  });
}

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
