import { createContext, useContext, useState } from "react";

type SttSettingsContextType = {
  accordionValue: string;
  setAccordionValue: (value: string) => void;
};

const SttSettingsContext = createContext<SttSettingsContextType | null>(null);

export function SttSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [accordionValue, setAccordionValue] = useState<string>("");

  return (
    <SttSettingsContext.Provider
      value={{
        accordionValue,
        setAccordionValue,
      }}
    >
      {children}
    </SttSettingsContext.Provider>
  );
}

export function useSttSettings() {
  const context = useContext(SttSettingsContext);
  if (!context) {
    throw new Error("useSttSettings must be used within SttSettingsProvider");
  }
  return context;
}
