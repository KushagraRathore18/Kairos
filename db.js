/* ==========================================================================
   KAIROS PREMIUM ONBOARDING APP - INDEXEDDB LAYER
   ========================================================================== */

const DB_NAME = 'KairosDB';
const DB_VERSION = 1;
const STORE_NAME = 'onboarding_sessions';

let dbInstance = null;

/**
 * Initializes the IndexedDB database.
 * Creates the required object store if it doesn't already exist.
 * @returns {Promise<IDBDatabase>}
 */
export function initDatabase() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB open request error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create object store for onboarding sessions if missing
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Saves a completed onboarding session dataset into IndexedDB.
 * @param {Object} sessionData The full structured session object.
 * @returns {Promise<string>} Resolves with the saved session ID on success.
 */
export function saveSession(sessionData) {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('Database not initialized. Make sure initDatabase() runs first.'));
      return;
    }

    const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Deep clone the session data to prevent reference changes
    const dataToSave = JSON.parse(JSON.stringify(sessionData));
    const request = store.put(dataToSave);

    request.onsuccess = () => {
      resolve(sessionData.id);
    };

    request.onerror = (event) => {
      console.error('Failed to save session to IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Retrieves all stored onboarding sessions from IndexedDB, sorted by timestamp (newest first).
 * @returns {Promise<Array<Object>>}
 */
export function getSessions() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('Database not initialized.'));
      return;
    }

    const transaction = dbInstance.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const sessions = request.result || [];
      // Sort sessions by timestamp in descending order (newest first)
      sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      resolve(sessions);
    };

    request.onerror = (event) => {
      console.error('Failed to retrieve sessions from IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Completely clears all session records from the object store.
 * @returns {Promise<void>}
 */
export function clearDatabase() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) {
      reject(new Error('Database not initialized.'));
      return;
    }

    const transaction = dbInstance.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = (event) => {
      console.error('Failed to clear database object store:', event.target.error);
      reject(event.target.error);
    };
  });
}
