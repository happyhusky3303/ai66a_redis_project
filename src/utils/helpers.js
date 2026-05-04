/**
 * Helper utilities for common operations
 */

const { v4: uuid } = require('uuid');

const helpers = {
  /**
   * Generate UUID
   */
  generateId: () => uuid(),

  /**
   * Sleep for N milliseconds
   */
  sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  /**
   * Format bytes
   */
  formatBytes: (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  },

  /**
   * Format duration
   */
  formatDuration: (ms) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  },

  /**
   * Calculate percentage
   */
  calculatePercentage: (value, total) => {
    if (total === 0) return 0;
    return (value / total) * 100;
  },

  /**
   * Chunk array
   */
  chunk: (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  },

  /**
   * Retry function with exponential backoff
   */
  retry: async (fn, maxRetries = 3, delay = 1000) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          await helpers.sleep(delay * Math.pow(2, i));
        }
      }
    }
    throw lastError;
  }
};

module.exports = helpers;
