/**
 * The one keycap, for shortcut hints. Hidden on touch screens, where there
 * is no keyboard to press it on.
 */
export function Kbd({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={`hidden h-5 min-w-5 place-items-center rounded-sm px-1 font-mono text-label text-subtle ring-1 ring-border ring-inset pointer-fine:inline-grid ${className}`}
    >
      {children}
    </kbd>
  );
}
