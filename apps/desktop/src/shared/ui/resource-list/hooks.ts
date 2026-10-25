import { useQuery } from "@tanstack/react-query";

export function useWebResources<T>(endpoint: string) {
  return useQuery({
    queryKey: ["settings", endpoint, "suggestions"],
    // Pas de catalogue distant (site Anarlog) : aucune suggestion web.
    queryFn: async (): Promise<T[]> => [],
  });
}
