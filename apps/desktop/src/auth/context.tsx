import type { ReactNode } from "react";

import { AuthContext, type AuthContextType } from "./auth-context";

// Syntheo Desktop n'a ni compte ni session : ce fournisseur expose un état
// « non connecté » constant, sans aucune requête. Temporaire : les derniers
// consommateurs de useAuth sont retirés, puis le module auth/ est supprimé.
const SIGNED_OUT: AuthContextType = {
  supabase: null,
  session: null,
  isRefreshingSession: false,
  isFingerprintSettled: true,
  signIn: async () => {},
  signOut: async () => {},
  refreshSession: async () => null,
  getSessionForRequest: async () => null,
  handleAuthCallback: async () => {},
  setSessionFromTokens: async () => {},
  getHeaders: () => null,
  getAvatarUrl: async () => null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={SIGNED_OUT}>{children}</AuthContext.Provider>
  );
}
