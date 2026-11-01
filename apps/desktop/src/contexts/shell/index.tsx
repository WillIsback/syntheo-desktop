import { createContext, useContext } from "react";

import { useSettings } from "./settings";

import { useChatMode } from "~/chat/state/use-chat-mode";

interface ShellContextType {
  chat: ReturnType<typeof useChatMode>;
  settings: ReturnType<typeof useSettings>;
}

const ShellContext = createContext<ShellContextType | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const chat = useChatMode();
  const settings = useSettings();

  return (
    <ShellContext.Provider value={{ chat, settings }}>
      {children}
    </ShellContext.Provider>
  );
}

export function useShell() {
  const context = useContext(ShellContext);
  if (!context) {
    throw new Error("'useShell' must be used within 'ShellProvider'");
  }
  return context;
}
