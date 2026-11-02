/**
 * The one switch track, 40 by 24: tinted when on, an outlined well when off.
 * It is drawn inside a row that is itself the switch control, so it is
 * hidden from assistive technology.
 */
export function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
        checked ? "bg-tint" : "bg-accent ring-1 ring-subtle ring-inset"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-lift transition-transform ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </span>
  );
}
