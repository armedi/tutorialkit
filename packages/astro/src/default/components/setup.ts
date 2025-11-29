/**
 * Setup code for TutorialKit Docker runtime.
 * No authentication needed for local Docker backend.
 */
import { authStore } from '../stores/auth-store.js';

// Docker runtime doesn't require authentication
export const useAuth = false;

// Auth store is always in 'no-auth' state for Docker runtime
if (!import.meta.env.SSR) {
  authStore.set({ status: 'no-auth' });
}
