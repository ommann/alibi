import { implement } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { setTimeout as delay } from 'node:timers/promises';
import { validationContract } from '../shared/rpc-contract';
import { project } from './validation-projects';

const implementation = implement(validationContract);

export const router = implementation.router({
  watch: implementation.watch.handler(async function* ({ input, signal }) {
    const runner = await project(input.cwd);
    let previous = '';
    while (!signal?.aborted) {
      const snapshot = runner.snapshot();
      const serialized = JSON.stringify(snapshot);
      if (serialized !== previous) {
        previous = serialized;
        yield snapshot;
      }
      try {
        await delay(150, undefined, { signal });
      } catch (error) {
        if (signal?.aborted) return;
        throw error;
      }
    }
  }),
});

export const rpcHandler = new RPCHandler(router);
