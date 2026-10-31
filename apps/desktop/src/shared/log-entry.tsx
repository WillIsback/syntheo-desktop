import { cn } from "@syntheo/utils";

const levelColors: Record<string, string> = {
  ERROR: "text-destructive",
  WARN: "text-chart-3",
  INFO: "text-chart-2",
  DEBUG: "text-chart-4",
  TRACE: "text-muted-foreground",
};

export function LogEntry({ text }: { text: string }) {
  const match = text.match(
    /^(\d{4}-\d{2}-\d{2}T\S+)(\s+)(ERROR|WARN|INFO|DEBUG|TRACE)(\s+)(\S+:)(\s?)([\s\S]*)$/,
  );

  if (!match) {
    return <>{text}</>;
  }

  const [
    ,
    timestamp,
    beforeLevel,
    level,
    beforeSource,
    source,
    space,
    message,
  ] = match;

  return (
    <>
      <span className="text-muted-foreground">{timestamp}</span>
      {beforeLevel}
      <span className={cn(["font-semibold", levelColors[level]])}>{level}</span>
      {beforeSource}
      <span className="text-muted-foreground">{source}</span>
      {space}
      {message}
    </>
  );
}
