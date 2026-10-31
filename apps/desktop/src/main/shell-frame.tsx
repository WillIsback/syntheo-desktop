import { memo } from "react";

import { ClassicMainBody } from "./body";
import { hasViewNavigation } from "./view-navigation";
import { WindowsTitleBar } from "./windows-title-bar";

import { DevtoolsStatusBar } from "~/devtools-bar";
import { usesWindowsStyleTitleBar } from "~/shared/hooks/useWindowControlsGutter";
import {
  MainShellBodyFrame,
  MainShellScaffold,
  type MainSurfaceChrome,
} from "~/shared/main";
import { ToastNotifications } from "~/sidebar/toast";
import { type Tab, useTabs } from "~/store/zustand/tabs";

export function resolveMainSurfaceChrome(
  tab: Pick<Tab, "type"> | null,
): MainSurfaceChrome | undefined {
  if (tab?.type === "onboarding") {
    return undefined;
  }
  if (hasViewNavigation(tab)) {
    // La colonne de navigation interne borde la surface à gauche.
    return "left";
  }
  if (tab?.type === "changelog") {
    return "top";
  }
  return "top-borderless";
}

export function ClassicMainShellFrame() {
  const currentTab = useTabs((state) => state.currentTab);
  const isOnboarding = currentTab?.type === "onboarding";

  const shell = (
    <MainShellScaffold
      edgeToEdge={isOnboarding}
      mainSurfaceChrome={resolveMainSurfaceChrome(currentTab)}
    >
      <ClassicMainBodyHost />
      <ToastNotifications />
    </MainShellScaffold>
  );

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      {usesWindowsStyleTitleBar() ? <WindowsTitleBar /> : null}
      <div className="min-h-0 flex-1">{shell}</div>
      <DevtoolsStatusBar />
    </div>
  );
}

const ClassicMainBodyHost = memo(function ClassicMainBodyHost() {
  return (
    <MainShellBodyFrame>
      <ClassicMainBody />
    </MainShellBodyFrame>
  );
});
