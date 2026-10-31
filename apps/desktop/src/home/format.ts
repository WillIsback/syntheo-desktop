// Mise en forme des données de l'accueil (prénom, dates, durées).

// Le contact propriétaire porte un nom complet : on garde le premier mot.
export function firstNameOf(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

// « mar. 29 oct. » en français.
export function formatIndexDate(value: string, locale: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// « 14:00 » en français.
export function formatMeetingTime(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Durée d'écoute : « 42 min », « 1 h 05 ». Rien sous la minute.
export function formatDuration(totalMs: number): string {
  const minutes = Math.floor(Math.max(0, totalMs) / 60_000);
  if (minutes < 1) return "";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h ${String(rest).padStart(2, "0")}`;
}
