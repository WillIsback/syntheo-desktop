import type {
  DrizzleProxyClient,
  LiveQueryClient,
  TransactionClient,
} from "@syntheo/db-runtime";
import {
  execute,
  executeProxy,
  executeTransaction,
  subscribe,
} from "@syntheo/plugin-db";

export const tauriLiveQueryClient: LiveQueryClient & DrizzleProxyClient = {
  execute,
  executeProxy,
  subscribe,
};

export const tauriTransactionClient: TransactionClient = {
  executeTransaction,
};
