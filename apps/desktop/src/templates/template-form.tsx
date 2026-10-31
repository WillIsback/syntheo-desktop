import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useId, useRef, useState } from "react";

import { DotsThree, Star, X } from "@syntheo/ui/components/icons";
import { Button } from "@syntheo/ui/components/ui/button";
import {
  AppFloatingPanel,
  appFloatingMenuPanelClassName,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@syntheo/ui/components/ui/dropdown-menu";
import { cn } from "@syntheo/utils";

import { inlineFieldClassName, LineTextarea } from "./line-textarea";
import {
  type UserTemplate,
  useSaveTemplate,
  useToggleTemplateFavorite,
} from "./queries";
import { SectionsList } from "./sections-editor";
import { TemplateGeneratorBar } from "./template-generator-bar";
import { TemplateIconPicker } from "./template-icon-picker";
import { TemplatePreview } from "./template-preview";

import { useSetSettingValue } from "~/settings/queries";
import { useConfigValue } from "~/shared/config";

type EditorMode = "edit" | "preview";

function parseUses(value: string) {
  return value
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);
}

/**
 * « Utilisé pour » : les types de réunion visés par le modèle. Stocké dans
 * `targets_json` (anciens tags), sans migration.
 */
export function TemplateUsesInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { t } = useLingui();
  const labelId = useId();
  const helpId = useId();
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const submit = (keepOpen: boolean) => {
    const next = parseUses(inputValue);
    if (next.length > 0) {
      onChange([...value, ...next]);
    }
    setInputValue("");
    if (!keepOpen) {
      setIsAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={helpId}
        className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[13px]"
      >
        <span id={labelId} className="mr-0.5">
          <Trans>Used for</Trans>
        </span>
        {value.map((use, index) => (
          <span
            key={`${use}-${index}`}
            className="bg-muted text-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-0.5"
          >
            {use}
            <button
              type="button"
              aria-label={t`Remove ${use}`}
              onClick={() =>
                onChange(value.filter((_, current) => current !== index))
              }
              className="text-faint hover:text-foreground focus-visible:ring-ring/50 rounded-sm outline-hidden focus-visible:ring-2"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {isAdding ? (
          <input
            type="text"
            autoFocus
            value={inputValue}
            aria-label={t`Add a use`}
            placeholder={t`e.g. Weekly, HR team`}
            className="border-input placeholder:text-faint focus-visible:ring-ring/50 text-foreground min-w-[120px] rounded-md border px-2 py-px outline-hidden focus-visible:ring-2"
            onChange={(event) => setInputValue(event.target.value)}
            onBlur={() => submit(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                if (inputValue.trim()) {
                  submit(true);
                } else {
                  setIsAdding(false);
                  queueMicrotask(() => addButtonRef.current?.focus());
                }
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setInputValue("");
                setIsAdding(false);
                queueMicrotask(() => addButtonRef.current?.focus());
                return;
              }
              if (event.key === "Backspace" && !inputValue && value.length) {
                event.preventDefault();
                onChange(value.slice(0, -1));
              }
            }}
          />
        ) : (
          <button
            ref={addButtonRef}
            type="button"
            onClick={() => setIsAdding(true)}
            className="border-input text-muted-foreground hover:bg-muted focus-visible:ring-ring/50 rounded-md border border-dashed px-2 py-px outline-hidden focus-visible:ring-2"
          >
            <Trans>+ Add</Trans>
          </button>
        )}
      </div>
      <p id={helpId} className="text-faint text-xs">
        <Trans>
          The kinds of meeting this template is meant for (team, role,
          frequency…).
        </Trans>
      </p>
    </div>
  );
}

export function TemplateForm({
  template,
  handleDeleteTemplate,
  handleDuplicateTemplate,
}: {
  template: UserTemplate;
  handleDeleteTemplate: (id: string) => void;
  handleDuplicateTemplate: (id: string) => void;
}) {
  const { t } = useLingui();
  const { id } = template;
  const saveTemplate = useSaveTemplate();
  const toggleTemplateFavorite = useToggleTemplateFavorite();
  const [mode, setMode] = useState<EditorMode>("edit");
  const [actionsOpen, setActionsOpen] = useState(false);

  const selectedTemplateId = useConfigValue("selected_template_id");
  const isDefault = selectedTemplateId === id;
  const setDefaultTemplateId = useSetSettingValue("selected_template_id");

  const form = useForm({
    defaultValues: {
      title: template.title ?? "",
      description: template.description ?? "",
      icon: template.icon,
      targets: template.targets ?? [],
      sections: template.sections ?? [],
    },
    listeners: {
      onChange: ({ formApi }) => {
        queueMicrotask(() => {
          const {
            form: { errors },
          } = formApi.getAllErrors();
          if (errors.length === 0) {
            void formApi.handleSubmit();
          }
        });
      },
    },
    onSubmit: ({ value }) => {
      return saveTemplate({
        ...template,
        ...value,
      });
    },
  });

  const newTemplateTitle = t`New template`;

  return (
    <div className="scroll-fade-y h-full overflow-y-auto">
      <div className="flex max-w-[700px] flex-col gap-5 px-6 pt-6 pb-16 lg:px-11 lg:pt-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            role="group"
            aria-label={t`Display mode`}
            className="border-input inline-flex overflow-hidden rounded-lg border"
          >
            {(
              [
                ["edit", t`Edit`],
                ["preview", t`Preview`],
              ] as const
            ).map(([value, label], index) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn([
                  "focus-visible:ring-ring/50 px-3 py-1.5 text-[13px] outline-hidden focus-visible:ring-2 focus-visible:ring-inset",
                  index > 0 && "border-input border-l",
                  mode === value
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "bg-card hover:bg-muted",
                ])}
              >
                {label}
              </button>
            ))}
          </div>
          {isDefault ? (
            <span className="bg-accent text-accent-foreground rounded-md px-2 py-0.5 text-xs font-medium">
              <Trans>Default template</Trans>
            </span>
          ) : null}
          <span className="flex-1" />
          <form.Field name="icon">
            {(field) => (
              <TemplateIconPicker
                size="sm"
                label={t`Template icon`}
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={template.pinned}
            onClick={() => void toggleTemplateFavorite(id)}
            className={cn([
              "h-8 rounded-lg px-2.5 text-[13px]",
              template.pinned ? "text-primary" : "text-muted-foreground",
            ])}
          >
            <Star
              aria-hidden="true"
              className={cn([
                "size-3.5",
                template.pinned && "[&_path]:fill-current",
              ])}
            />
            {template.pinned ? (
              <Trans>In favorites</Trans>
            ) : (
              <Trans>Add to favorites</Trans>
            )}
          </Button>
          <DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn([
                  "text-muted-foreground hover:text-foreground size-8 rounded-lg",
                  actionsOpen && "bg-muted text-foreground",
                ])}
                aria-label={t`More actions`}
              >
                <DotsThree className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent variant="app" align="end">
              <AppFloatingPanel className={appFloatingMenuPanelClassName}>
                <DropdownMenuItem
                  onClick={() => setDefaultTemplateId(isDefault ? "" : id)}
                  className="cursor-pointer"
                >
                  {isDefault ? (
                    <Trans>Stop using by default</Trans>
                  ) : (
                    <Trans>Use by default</Trans>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDuplicateTemplate(id)}
                  className="cursor-pointer"
                >
                  <Trans>Duplicate</Trans>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleDeleteTemplate(id)}
                  className="text-destructive focus:text-destructive cursor-pointer"
                >
                  <Trans>Delete</Trans>
                </DropdownMenuItem>
              </AppFloatingPanel>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {mode === "preview" ? (
          <form.Subscribe
            selector={(state) =>
              [state.values.title, state.values.sections] as const
            }
          >
            {([title, sections]) => (
              <TemplatePreview title={title} sections={sections} />
            )}
          </form.Subscribe>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <form.Field name="title">
                {(field) => (
                  <input
                    type="text"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-label={t`Template name`}
                    placeholder={t`Template name`}
                    className={cn([
                      "w-full border-0 bg-transparent p-0 font-serif text-[34px] leading-[1.1] font-medium",
                      inlineFieldClassName,
                    ])}
                  />
                )}
              </form.Field>
              <form.Field name="description">
                {(field) => (
                  <LineTextarea
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-label={t`Description`}
                    placeholder={t`What is this template for?`}
                    className="text-muted-foreground text-[15px]"
                  />
                )}
              </form.Field>
            </div>

            <form.Field name="targets">
              {(field) => (
                <TemplateUsesInput
                  value={field.state.value}
                  onChange={field.handleChange}
                />
              )}
            </form.Field>

            <form.Subscribe
              selector={(state) =>
                [state.values.title, state.values.description] as const
              }
            >
              {([title, description]) => (
                <TemplateGeneratorBar
                  context={[
                    title === newTemplateTitle ? "" : title,
                    description,
                  ]
                    .map((part) => part.trim())
                    .filter(Boolean)
                    .join(". ")}
                  onGenerated={(generated) => {
                    const values = form.state.values;
                    const untitled =
                      !values.title.trim() || values.title === newTemplateTitle;
                    if (untitled) {
                      form.setFieldValue("title", generated.title);
                      form.setFieldValue("icon", generated.icon);
                    }
                    if (!values.description.trim()) {
                      form.setFieldValue("description", generated.description);
                    }
                    form.setFieldValue("sections", generated.sections);
                  }}
                />
              )}
            </form.Subscribe>

            <form.Field name="sections">
              {(field) => (
                <SectionsList
                  disabled={false}
                  items={field.state.value}
                  onChange={(items) => field.handleChange(items)}
                />
              )}
            </form.Field>
          </>
        )}
      </div>
    </div>
  );
}
