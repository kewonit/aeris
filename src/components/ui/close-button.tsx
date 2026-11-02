import { X } from "lucide-react";

/**
 * The one close button: a 44 px target around a 32 px disc, the same on
 * cards, sheets, dialogs and dropdowns.
 */
export function CloseButton({
  label,
  onClick,
  className = "",
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`grid size-11 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:text-foreground ${className}`}
    >
      <span className="grid size-8 place-items-center rounded-full bg-card">
        <X className="size-4" aria-hidden="true" />
      </span>
    </button>
  );
}
