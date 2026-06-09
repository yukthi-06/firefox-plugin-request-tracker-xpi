// Session Resource Logger - Background Script
// Handles tracking of pages, resource loads, logging window state, and storage persistence.

let logs = [];
let loggerWindowId = null;
let isOpening = false;
let trackingActive = false;
const tabUrls = {};

// Periodic storage persistence variables
let saveTimeout = null;
let pendingChanges = false;

// Load existing logs and tracking state on startup
browser.storage.local.get(["sessionLogs", "trackingActive"]).then((result) => {
  if (result.sessionLogs && Array.isArray(result.sessionLogs)) {
    logs = result.sessionLogs;
    console.log("Loaded", logs.length, "logs from storage.");
  }
  if (result.trackingActive !== undefined) {
    trackingActive = result.trackingActive;
    console.log("Tracking active state loaded:", trackingActive);
  }
}).catch((err) => {
  console.error("Failed to load logs/state from local storage:", err);
});

// Save logs helper
function saveLogs() {
  if (!pendingChanges) return;
  browser.storage.local.set({ sessionLogs: logs }).then(() => {
    pendingChanges = false;
    saveTimeout = null;
  }).catch((err) => {
    console.error("Storage save failed:", err);
    saveTimeout = null;
  });
}

// Schedule debounced/throttled save to local storage
function scheduleSave() {
  pendingChanges = true;
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveLogs();
  }, 2000); // Throttled to save at most once every 2 seconds
}

// Helper to open the dedicated logger window
function createLoggerWindow() {
  if (isOpening || loggerWindowId !== null) {
    if (loggerWindowId !== null) {
      // If already open, bring to focus
      browser.windows.update(loggerWindowId, { focused: true }).catch(() => {
        // Fallback: window might have closed without triggering onRemoved
        loggerWindowId = null;
        createLoggerWindow();
      });
    }
    return;
  }

  isOpening = true;
  browser.windows.create({
    url: browser.runtime.getURL("logger.html"),
    type: "popup",
    width: 1400,
    height: 900
  }).then((win) => {
    loggerWindowId = win.id;
    isOpening = false;
  }).catch((err) => {
    console.error("Error creating logger window:", err);
    isOpening = false;
  });
}

// Listen for action toolbar icon click to start tracking and open the logger window
browser.action.onClicked.addListener(() => {
  if (!trackingActive) {
    trackingActive = true;
    browser.storage.local.set({ trackingActive: true });
    console.log("Tracking activated by user invoking the extension window.");
  }
  createLoggerWindow();
});

// Reset tracking status on a fresh browser startup
browser.runtime.onStartup.addListener(() => {
  trackingActive = false;
  browser.storage.local.set({ trackingActive: false });
});

// Track when logger window is closed
browser.windows.onRemoved.addListener((windowId) => {
  if (windowId === loggerWindowId) {
    loggerWindowId = null;
    trackingActive = false;
    browser.storage.local.set({ trackingActive: false });
    console.log("Logger window closed. Tracking deactivated.");
  }
});

// Track active URLs for tabs to serve as fallback parent page URLs
browser.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) {
    tabUrls[details.tabId] = details.url;
  }
});

browser.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    tabUrls[details.tabId] = details.url;
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  delete tabUrls[tabId];
});

// Add a log entry and handle sending to logger window
function addLogEntry(entry) {
  logs.push(entry);
  scheduleSave();

  // Stream in real-time if logger is open
  if (loggerWindowId !== null) {
    browser.runtime.sendMessage({ action: "newLog", data: entry }).catch((err) => {
      // Ignored: window might be loading or in process of closing
    });
  }
}

// 1. Page Visit Tracking
browser.webNavigation.onCompleted.addListener((details) => {
  if (!trackingActive) return;
  if (details.frameId === 0) {
    browser.tabs.get(details.tabId).then((tab) => {
      const entry = {
        type: "page",
        timestamp: new Date(details.timeStamp).toISOString(),
        url: details.url,
        title: tab ? tab.title : "",
        tabId: details.tabId,
        windowId: details.windowId
      };
      addLogEntry(entry);
    }).catch(() => {
      // Fallback if tab details are inaccessible
      const entry = {
        type: "page",
        timestamp: new Date(details.timeStamp).toISOString(),
        url: details.url,
        title: "",
        tabId: details.tabId,
        windowId: details.windowId
      };
      addLogEntry(entry);
    });
  }
});

// 2. Resource Tracking (Successful / Completed requests)
browser.webRequest.onCompleted.addListener(
  (details) => {
    if (!trackingActive) return;
    // Exclude extension-specific internal requests to prevent infinite loops/self-logging
    if (details.url.startsWith("moz-extension://") || details.url.startsWith("chrome-extension://")) {
      return;
    }

    let domain = "";
    try {
      domain = new URL(details.url).hostname;
    } catch (e) {
      domain = "unknown";
    }

    let contentLength = -1;
    let mimeType = "";

    if (details.responseHeaders) {
      for (const header of details.responseHeaders) {
        const name = header.name.toLowerCase();
        if (name === "content-length") {
          const val = parseInt(header.value, 10);
          if (!isNaN(val)) contentLength = val;
        } else if (name === "content-type") {
          mimeType = header.value.split(";")[0].trim();
        }
      }
    }

    const pageUrl = details.documentUrl || details.originUrl || tabUrls[details.tabId] || "";

    const entry = {
      type: "resource",
      timestamp: new Date(details.timeStamp).toISOString(),
      pageUrl: pageUrl,
      resourceUrl: details.url,
      resourceType: details.type,
      statusCode: details.statusCode,
      method: details.method,
      mimeType: mimeType || "unknown",
      fileSize: contentLength,
      domain: domain,
      requestId: details.requestId,
      tabId: details.tabId
    };

    addLogEntry(entry);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// 3. Resource Tracking (Failed requests)
browser.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (!trackingActive) return;
    if (details.url.startsWith("moz-extension://") || details.url.startsWith("chrome-extension://")) {
      return;
    }

    let domain = "";
    try {
      domain = new URL(details.url).hostname;
    } catch (e) {
      domain = "unknown";
    }

    const pageUrl = details.documentUrl || details.originUrl || tabUrls[details.tabId] || "";

    const entry = {
      type: "resource",
      timestamp: new Date(details.timeStamp).toISOString(),
      pageUrl: pageUrl,
      resourceUrl: details.url,
      resourceType: details.type,
      statusCode: -1, // -1 representing failure/network error
      method: details.method,
      mimeType: "Failed / Network Error",
      fileSize: -1,
      domain: domain,
      requestId: details.requestId,
      tabId: details.tabId
    };

    addLogEntry(entry);
  },
  { urls: ["<all_urls>"] }
);

// 4. Port/Message Handlers
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getLogs") {
    sendResponse({ logs: logs, trackingActive: trackingActive });
  } else if (message.action === "toggleTracking") {
    trackingActive = !trackingActive;
    browser.storage.local.set({ trackingActive: trackingActive });
    sendResponse({ trackingActive: trackingActive });
    return true; // Keep channel open
  } else if (message.action === "clearLogs") {
    logs = [];
    browser.storage.local.set({ sessionLogs: [] }).then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep message channel open for async response
  }
});
