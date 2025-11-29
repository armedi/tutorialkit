import { atom } from 'nanostores';

interface AuthStore {
  status: 'no-auth';
}

export const authStore = atom<AuthStore>({ status: 'no-auth' });
