import { useQuery } from "@tanstack/react-query";

export function useWebResources<T>(endpoint: string) {
  return useQuery({
    queryKey: ["settings", endpoint, "suggestions"],
    // Pas de catalogue distant (site Syntheo) : aucune suggestion web.
    queryFn: (): Promise<T[]> => Promise.resolve([]),
  });
}
