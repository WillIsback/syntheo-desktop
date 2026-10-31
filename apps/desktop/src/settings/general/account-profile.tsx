import { Trans, useLingui } from "@lingui/react/macro";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@syntheo/ui/components/ui/button";
import { Input } from "@syntheo/ui/components/ui/input";
import { Textarea } from "@syntheo/ui/components/ui/textarea";

import { ContactOrganizationSelector } from "~/contacts/details";
import { ProfilePhoto } from "~/contacts/profile-photo";
import {
  type HumanRecord,
  savePersonalContact,
  usePersonalContact,
  useOrganizations,
} from "~/contacts/queries";
import { useOwnerUserId } from "~/shared/owner-user";

export function AccountProfile() {
  const humanId = useOwnerUserId();
  if (!humanId)
    return (
      <p role="status">
        <Trans>Loading...</Trans>
      </p>
    );
  return <ProfileLoader key={humanId} humanId={humanId} />;
}

function ProfileLoader({ humanId }: { humanId: string }) {
  const { data, isLoading, error } = usePersonalContact(humanId);
  if (error)
    return (
      <p role="alert">
        <Trans>
          Couldn't load your profile. Reopen this page to try again.
        </Trans>
      </p>
    );
  if (isLoading || data === undefined)
    return (
      <p role="status">
        <Trans>Loading...</Trans>
      </p>
    );
  return <ProfileForm humanId={humanId} human={data} />;
}

type ProfileValues = Pick<
  HumanRecord,
  "name" | "jobTitle" | "memo" | "organizationId"
>;

function ProfileForm({
  humanId,
  human,
}: {
  humanId: string;
  human: HumanRecord | null;
}) {
  const { t } = useLingui();
  const organizations = useOrganizations();
  // L'adresse e-mail, le téléphone et LinkedIn ne se saisissent plus ici,
  // mais l'enregistrement réécrit toute la fiche : on renvoie les valeurs
  // déjà connues pour ne rien effacer. L'e-mail sert encore à reconnaître
  // le propriétaire parmi les participants d'un événement.
  const kept = {
    email: human?.email ?? "",
    phone: human?.phone ?? "",
    linkedinUsername: human?.linkedinUsername ?? "",
  };
  const save = useMutation({
    mutationFn: (values: ProfileValues) =>
      savePersonalContact(humanId, { ...values, ...kept }),
  });
  const form = useForm({
    defaultValues: {
      name: human?.name ?? "",
      jobTitle: human?.jobTitle ?? "",
      memo: human?.memo ?? "",
      organizationId: human?.organizationId ?? "",
    },
    listeners: {
      onChange: ({ formApi }) => save.mutate(formApi.state.values),
    },
    onSubmit: ({ value }) => save.mutate(value),
  });
  const fields = [
    { name: "name", label: t`Name`, type: "text" },
    { name: "jobTitle", label: t`Job Title` },
  ] as const;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <h3 className="text-faint text-[11px] font-semibold tracking-[0.08em] uppercase">
        <Trans>Identity</Trans>
      </h3>
      <fieldset className="flex min-w-0 flex-col gap-4">
        <ProfilePhoto
          userId={humanId}
          name={human?.name || human?.email || humanId}
          localPhoto={human?.avatarDataUrl ?? null}
          onSave={(avatarDataUrl) =>
            savePersonalContact(humanId, {
              ...form.state.values,
              ...kept,
              avatarDataUrl,
            })
          }
        />
        {fields.map(({ name, label }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <label className="flex flex-col gap-2 text-sm">
                {label}
                <Input
                  type="text"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              </label>
            )}
          </form.Field>
        ))}
        <form.Field name="organizationId">
          {(field) => (
            <div className="flex flex-col gap-2 text-sm">
              <span>
                <Trans>Company</Trans>
              </span>
              <div>
                <ContactOrganizationSelector
                  organization={
                    organizations.find(
                      (organization) => organization.id === field.state.value,
                    ) ?? null
                  }
                  organizations={organizations}
                  onChange={(id) => field.handleChange(id ?? "")}
                />
              </div>
            </div>
          )}
        </form.Field>
        <form.Field name="memo">
          {(field) => (
            <label className="flex flex-col gap-2 text-sm">
              <Trans>Notes</Trans>
              <Textarea
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                rows={3}
              />
            </label>
          )}
        </form.Field>
      </fieldset>
      {save.isError && (
        <div className="flex items-center gap-3">
          <p role="alert" className="text-destructive text-sm">
            <Trans>Couldn't save your profile. Try again.</Trans>
          </p>
          <Button type="submit" variant="outline">
            <Trans>Retry</Trans>
          </Button>
        </div>
      )}
      {(save.isPending || save.isSuccess) && (
        <span role="status" className="text-muted-foreground text-sm">
          {save.isPending ? t`Saving...` : t`Saved`}
        </span>
      )}
    </form>
  );
}
