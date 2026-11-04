import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

type TriggerProps = {
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string;
  onClick: () => void;
};

/**
 * A small anchored menu. Closes on outside click and Escape, and returns focus
 * to its trigger when closed with Escape.
 */
export function Popover({
  trigger,
  children,
  align = 'right',
  width = 'w-60',
}: {
  trigger: (props: TriggerProps) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {trigger({
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': id,
        onClick: () => setOpen((o) => !o),
      })}
      {open && (
        <div
          id={id}
          role="menu"
          className={`absolute top-full z-20 mt-1 ${align === 'right' ? 'right-0' : 'left-0'} ${width} rounded-lg border border-rule bg-raised p-1 shadow-lg`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export const menuItemClass =
  'block w-full rounded-md px-3 py-1.5 text-left text-[15px] hover:bg-rule/60 focus-visible:bg-rule/60 focus-visible:outline-none';

export function MenuNote({ children }: { children: ReactNode }) {
  return <p className="px-3 pb-1 pt-1.5 text-[13px] text-muted">{children}</p>;
}

export function MenuDivider() {
  return <hr className="my-1 border-rule" />;
}
