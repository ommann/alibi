import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { validationContract } from '../../../../shared/rpc-contract';

export type ValidationRpcClient = ContractRouterClient<typeof validationContract>;

export const VALIDATION_RPC = new InjectionToken<ValidationRpcClient>('Validation RPC', {
  providedIn: 'root',
  factory: () => createORPCClient(new RPCLink({
    url: new URL('/rpc', inject(DOCUMENT).baseURI).href,
  })),
});
