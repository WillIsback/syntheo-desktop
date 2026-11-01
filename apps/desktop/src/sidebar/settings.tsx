import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useState } from "react";

import {
  CaretDown,
  CaretRight,
  Lock,
  MagnifyingGlass,
  X,
} from "@syntheo/ui/components/icons";
import { cn } from "@syntheo/utils";

import { CustomSidebarHeader } from "./custom-sidebar-header";
import {
  type SettingsNavGroup,
  useSettingsNavGroups,
} from "./settings-nav-groups";
import { ServersHealthFooter, ServerStatusDot } from "./settings-server-status";

import { useBillingAccess } from "~/billing/billing-context";
import { type SettingsTab, useTabs } from "~/store/zustand/tabs";

export function SettingsNav() {
  const { t } = useLingui();
  const { isPro } = useBillingAccess();
  const groups = useSettingsNavGroups();
  const [search, setSearch] = useState("");
  const currentTab = useTabs((state) => state.currentTab);
  const updateSettingsTabState = useTabs(
    (state) => state.updateSettingsTabState,
  );
  const openNew = useTabs((state) => state.openNew);

  const requestedTab =
    currentTab?.type === "settings" ? (currentTab.state.tab ?? "app") : "app";
  const activeTab: string =
    requestedTab === "audio" ? "meetings" : requestedTab;

  const setActiveTab = useCallback(
    (tab: SettingsTab) => {
      if (currentTab?.type === "settings") {
        updateSettingsTabState(currentTab, { tab });
      }
    },
    [currentTab, updateSettingsTabState],
  );

  const query = search.trim().toLowerCase();
  const visibleGroups = query
    ? groups
        .map((group) =>
          group.label.toLowerCase().includes(query)
            ? group
            : {
                ...group,
                items: group.items.filter((item) =>
                  item.label.toLowerCase().includes(query),
                ),
              },
        )
        .filter((group) => group.items.length > 0)
    : groups;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <CustomSidebarHeader />
      <div className="pb-3.5">
        <div
          className={cn([
            "border-border bg-card flex h-8 w-full shrink-0 items-center gap-2 rounded-lg border px-2.5",
            "focus-within:ring-ring focus-within:ring-1",
          ])}
        >
          <MagnifyingGlass className="text-faint size-[15px] shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch("");
              }
            }}
            placeholder={t`Search settings...`}
            aria-label={t`Search settings...`}
            className="placeholder:text-faint min-w-0 flex-1 bg-transparent text-sm focus:outline-hidden"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground size-4 shrink-0 transition-colors"
              aria-label={t`Clear search`}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <nav
        aria-label={t`Settings`}
        className="scrollbar-hide flex flex-1 flex-col overflow-y-auto"
      >
        <div className="flex flex-col gap-3.5 pb-4">
          {visibleGroups.length === 0 ? (
            <div className="text-muted-foreground px-3 py-8 text-center">
              <MagnifyingGlass
                size={32}
                className="text-faint mx-auto mb-2"
                aria-hidden
              />
              <p className="text-sm">
                <Trans>No results found.</Trans>
              </p>
            </div>
          ) : null}
          {visibleGroups.map((group) => (
            <NavGroup
              key={group.label}
              group={group}
              forceOpen={
                !!query || group.items.some((item) => item.id === activeTab)
              }
              activeTab={activeTab}
              isPro={isPro}
              onSelect={(item) => {
                if ("destination" in item) {
                  openNew(item.destination);
                  return;
                }
                setActiveTab(item.id);
              }}
            />
          ))}
        </div>
        <ServersHealthFooter />
      </nav>
    </div>
  );
}

type NavItem = SettingsNavGroup["items"][number];

function NavGroup({
  group,
  forceOpen,
  activeTab,
  isPro,
  onSelect,
}: {
  group: SettingsNavGroup;
  forceOpen: boolean;
  activeTab: string;
  isPro: boolean;
  onSelect: (item: NavItem) => void;
}) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const open = !group.collapsed || expanded || forceOpen;
  const labelClass =
    "text-faint px-2 pb-1 text-[11px] font-semibold tracking-[0.08em] uppercase";

  return (
    <div className="flex flex-col gap-px">
      {group.collapsed ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setExpanded((value) => !value)}
          className={cn([labelClass, "flex items-center gap-1 text-left"])}
        >
          {group.label}
          {open ? (
            <CaretDown aria-hidden className="size-3" />
          ) : (
            <CaretRight aria-hidden className="size-3" />
          )}
        </button>
      ) : (
        <h5 className={labelClass}>{group.label}</h5>
      )}
      {open
        ? group.items.map((item) => {
            const current = activeTab === item.id;
            const locked = Boolean(item.requiresPro && !isPro);
            return (
              <button
                key={item.id}
                type="button"
                aria-current={current ? "page" : undefined}
                onClick={() => onSelect(item)}
                className={cn([
                  "flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-sm transition-colors",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden",
                  current
                    ? "bg-accent text-accent-foreground font-semibold"
                    : "text-foreground hover:bg-muted",
                ])}
              >
                <item.icon
                  size={16}
                  className={cn([
                    "shrink-0",
                    current
                      ? "text-accent-foreground"
                      : "text-muted-foreground",
                  ])}
                  data-testid={`settings-nav-icon-${item.id}`}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {locked ? (
                  <Lock
                    aria-label={t`Requires Syntheo Pro`}
                    className="size-3.5 shrink-0"
                  />
                ) : null}
                {item.server ? <ServerStatusDot kind={item.server} /> : null}
              </button>
            );
          })
        : null}
    </div>
  );
}
