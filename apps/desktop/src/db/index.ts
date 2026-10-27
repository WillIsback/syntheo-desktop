import { createDb } from "@syntheo/db";
import {
  createUseDrizzleLiveQuery,
  createUseLiveQuery,
} from "@syntheo/db-react";
import {
  tauriLiveQueryClient,
  tauriTransactionClient,
} from "@syntheo/db-tauri";

export const liveQueryClient = tauriLiveQueryClient;
export const db = createDb(liveQueryClient);
export const useLiveQuery = createUseLiveQuery(liveQueryClient);
export const useDrizzleLiveQuery = createUseDrizzleLiveQuery(liveQueryClient);
export const executeTransaction = tauriTransactionClient.executeTransaction;
