/**
 * SF-Intel Studio - Utility Functions
 * Shared utilities for the extension
 */

const SFIntelUtils = {
  /**
   * Detect current Salesforce page type
   * @returns {string} Page type: 'apex-class', 'setup', 'lightning', 'developer-console', 'unknown'
   */
  detectPageType() {
    const url = window.location.href;
    const pathname = window.location.pathname;

    // Apex Class detail page
    if (url.includes('/apex/setup/ui/listApexPage.apexp') || url.includes('ApexClasses')) {
      return 'apex-class-list';
    }
    
    if (url.includes('/apex/') || pathname.includes('/ApexClass/')) {
      return 'apex-class-detail';
    }

    // Developer Console
    if (url.includes('/_ui/common/apex/debug/ApexCSIPage')) {
      return 'developer-console';
    }

    // Setup pages
    if (url.includes('/lightning/setup/') || url.includes('/ui/setup/')) {
      return 'setup';
    }

    // Lightning Experience
    if (url.includes('/lightning/')) {
      return 'lightning';
    }

    return 'unknown';
  },

  /**
   * Extract Apex class name from current page
   * @returns {string|null} Class name or null
   */
  extractClassName() {
    const url = window.location.href;
    
    // Try URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const classId = urlParams.get('id');
    
    // Try to get class name from page title or DOM
    const titleElement = document.querySelector('h1, .slds-page-header__title, .pageDescription');
    if (titleElement) {
      const titleText = titleElement.textContent.trim();
      // Remove common prefixes
      return titleText.replace(/^(Apex Class:|Class:)\s*/i, '');
    }

    // Try to extract from breadcrumbs
    const breadcrumb = document.querySelector('.slds-breadcrumb__item:last-child');
    if (breadcrumb) {
      return breadcrumb.textContent.trim();
    }

    return null;
  },

  /**
   * Create notification element
   * @param {string} message - Message to display
   * @param {string} type - 'success', 'error', 'warning', 'info'
   * @returns {HTMLElement}
   */
  createNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `sf-intel-notification sf-intel-notification--${type}`;
    notification.innerHTML = `
      <div class="sf-intel-notification__content">
        <span class="sf-intel-notification__icon">${this.getNotificationIcon(type)}</span>
        <span class="sf-intel-notification__message">${message}</span>
      </div>
      <button class="sf-intel-notification__close">×</button>
    `;
    
    notification.querySelector('.sf-intel-notification__close').addEventListener('click', () => {
      notification.remove();
    });

    return notification;
  },

  /**
   * Get icon for notification type
   * @param {string} type
   * @returns {string} Icon HTML
   */
  getNotificationIcon(type) {
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };
    return icons[type] || icons.info;
  },

  /**
   * Show notification
   * @param {string} message
   * @param {string} type
   * @param {number} duration - Duration in ms (0 = permanent)
   */
  showNotification(message, type = 'info', duration = 5000) {
    const notification = this.createNotification(message, type);
    
    let container = document.querySelector('.sf-intel-notifications');
    if (!container) {
      container = document.createElement('div');
      container.className = 'sf-intel-notifications';
      document.body.appendChild(container);
    }
    
    container.appendChild(notification);

    if (duration > 0) {
      setTimeout(() => notification.remove(), duration);
    }

    return notification;
  },

  /**
   * Format risk level
   * @param {number} score - Risk score 0-100
   * @returns {object} {level: string, color: string, icon: string}
   */
  formatRiskLevel(score) {
    if (score >= 75) {
      return { level: 'CRITICAL', color: '#e74c3c', icon: '🔴' };
    } else if (score >= 50) {
      return { level: 'HIGH', color: '#e67e22', icon: '🟠' };
    } else if (score >= 25) {
      return { level: 'MEDIUM', color: '#f39c12', icon: '🟡' };
    } else {
      return { level: 'LOW', color: '#27ae60', icon: '🟢' };
    }
  },

  /**
   * Debounce function
   * @param {Function} func
   * @param {number} wait
   * @returns {Function}
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * Log to console with SF-Intel prefix
   * @param {string} level - 'log', 'warn', 'error'
   * @param {string} message
   * @param {any} data
   */
  log(level, message, data = null) {
    const prefix = '[SF-Intel Studio]';
    if (data) {
      console[level](prefix, message, data);
    } else {
      console[level](prefix, message);
    }
  }
};

// Make available globally
window.SFIntelUtils = SFIntelUtils;
