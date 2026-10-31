export type ChatToolbarSurface = "light" | "dark";

export function isChatDarkAppearance(): boolean {
  return false;
}

export function chatPanelClassNames(): string {
  return "bg-card text-card-foreground";
}

export function chatFloatingPanelClassNames(): string {
  return "bg-card text-card-foreground";
}

export function chatPanelBorderClassNames(): string {
  return "border-border";
}

export function chatFloatingPanelShellClassNames(): string {
  return "bg-card text-card-foreground rounded-[24px] border border-border/70 border-t-app-floating-border shadow-capsule";
}

export function chatElevatedSurfaceClassNames(): string {
  return "bg-card text-card-foreground border-border";
}

export function chatInputEditorClassNames(): string {
  return "chat-input-editor text-card-foreground";
}

export function chatSendButtonDisabledClassNames(): string {
  return "cursor-default border-border text-muted-foreground/60";
}

export function chatSendButtonShortcutDisabledClassNames(): string {
  return "text-muted-foreground/60";
}

export function chatToolbarSurface(): ChatToolbarSurface {
  return "light";
}

export function chatFloatingControlClassNames(): string {
  return "border-border bg-accent text-accent-foreground hover:bg-accent/90";
}
