import type { Step } from '../step';

// Persist managed groups without choosing an ESLint execution strategy yet.
export default {
  name: 'eslint',
  instances: true,
  detect: () => false,
  run: async () => { throw new Error('ESLint execution is not connected.'); },
} satisfies Step;
