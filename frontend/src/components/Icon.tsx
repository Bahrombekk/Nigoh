/* components/Icon.tsx — <Icon name="camera" size="sm" />
   Qoida (Dev handoff §5): ≤16px — "Solid" (chiziq 2px), ≥20px — Linear 1.5px. */
import { ICONS } from "./icons";

export type IconSize = "xs" | "sm" | "md" | "lg";

export function Icon({ name, size = "md", className = "" }: { name: string; size?: IconSize; className?: string }) {
  const d = ICONS[name] || ICONS["circle"];
  const sw = size === "xs" || size === "sm" ? 2 : 1.5;
  const cls = "i" + (size === "md" ? "" : " " + size) + (className ? " " + className : "");
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
  );
}
