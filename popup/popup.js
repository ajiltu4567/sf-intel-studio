/**
 * SF-Intel Studio - Popup Script
 */

// API client instance
const API_BASE = 'http://127.0.0.1:3000';

// Elements
let serverStatus;
let statsSection;
let statClasses, statObjects, statDependencies, statQueries;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    // Get elements
    serverStatus = document.getElementById('serverStatus');
    statsSection = document.getElementById('statsSection');
    statClasses = document.getElementById('statClasses');
    statObjects = document.getElementById('statObjects');
    statDependencies = document.getElementById('statDependencies');
    statQueries = document.getElementById('statQueries');

    // Set up event listeners
    document.getElementById('openDashboard').addEventListener('click', () => {
        chrome.tabs.create({ url: 'http://127.0.0.1:3000' });
    });

    document.getElementById('refreshCache').addEventListener('click', async () => {
        const btn = document.getElementById('refreshCache');
        btn.disabled = true;
        btn.querySelector('.action-button__text').textContent = 'Refreshing...';

        // Send message to background to clear cache
        chrome.runtime.sendMessage({ action: 'clearCache' }, () => {
            // Reload stats
            loadStats();
            btn.disabled = false;
            btn.querySelector('.action-button__text').textContent = 'Refresh Cache';
        });
    });

    document.getElementById('openSettings').addEventListener('click', () => {
        // For now, just open options page (we'll create this later)
        alert('Settings coming soon!');
    });

    // Load data
    await checkServerStatus();
    await loadStats();
});

/**
 * Check if server is running
 */
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_BASE}/api/stats`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });

        if (response.ok) {
            updateServerStatus(true);
        } else {
            updateServerStatus(false);
        }
    } catch (error) {
        updateServerStatus(false);
    }
}

/**
 * Update server status indicator
 * @param {boolean} isRunning
 */
function updateServerStatus(isRunning) {
    const dot = serverStatus.querySelector('.status-indicator__dot');
    const text = serverStatus.querySelector('.status-indicator__text');

    if (isRunning) {
        dot.classList.add('status-indicator__dot--online');
        text.textContent = 'Server Online';
        serverStatus.classList.add('status-indicator--online');
    } else {
        dot.classList.add('status-indicator__dot--offline');
        text.textContent = 'Server Offline';
        serverStatus.classList.add('status-indicator--offline');
    }
}

/**
 * Load org statistics
 */
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/api/stats`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            throw new Error('Failed to fetch stats');
        }

        const stats = await response.json();
        displayStats(stats);
        statsSection.style.display = 'block';
    } catch (error) {
        console.error('Failed to load stats:', error);
        // Hide stats section if we can't load
        statsSection.style.display = 'none';
    }
}

/**
 * Display statistics
 * @param {Object} stats
 */
function displayStats(stats) {
    // Parse stats based on API response format
    let classCount = 0;
    let objectCount = 0;
    let dependencyCount = 0;
    let queryCount = 0;

    // Check different possible response formats
    if (stats.summary) {
        // Format 1: { summary: { total_classes: 10, ... } }
        classCount = stats.summary.total_classes || 0;
        objectCount = stats.summary.total_objects || 0;
        dependencyCount = stats.summary.total_dependencies || 0;
        queryCount = stats.summary.total_queries || 0;
    } else if (stats.metadata_entities) {
        // Format 2: { metadata_entities: { ApexClass: 10, ... } }
        classCount = stats.metadata_entities.ApexClass || 0;
        objectCount = stats.metadata_entities.CustomObject || 0;
    }

    // If we have dependency_edges
    if (stats.dependency_edges) {
        if (typeof stats.dependency_edges === 'number') {
            dependencyCount = stats.dependency_edges;
        } else if (stats.dependency_edges.total) {
            dependencyCount = stats.dependency_edges.total;
        }
    }

    // Update UI
    statClasses.textContent = formatNumber(classCount);
    statObjects.textContent = formatNumber(objectCount);
    statDependencies.textContent = formatNumber(dependencyCount);
    statQueries.textContent = formatNumber(queryCount);
}

/**
 * Format number with commas
 * @param {number} num
 * @returns {string}
 */
function formatNumber(num) {
    if (num === 0) return '0';
    return num.toLocaleString();
}
