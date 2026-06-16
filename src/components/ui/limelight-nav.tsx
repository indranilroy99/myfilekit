import React, { cloneElement, useLayoutEffect, useRef, useState } from "react";

const DefaultHomeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const DefaultCompassIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" />
  </svg>
);

const DefaultBellIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

export type NavItem = {
  id: string | number;
  icon: React.ReactElement<React.SVGProps<SVGSVGElement>>;
  label?: string;
  onClick?: () => void;
};

const defaultNavItems: NavItem[] = [
  { id: "default-home", icon: <DefaultHomeIcon />, label: "Home" },
  { id: "default-explore", icon: <DefaultCompassIcon />, label: "Explore" },
  { id: "default-notifications", icon: <DefaultBellIcon />, label: "Notifications" },
];

type LimelightNavProps = {
  items?: NavItem[];
  defaultActiveIndex?: number;
  activeIndex?: number;
  onTabChange?: (index: number) => void;
  className?: string;
  limelightClassName?: string;
  iconContainerClassName?: string;
  iconClassName?: string;
};

export function LimelightNav({
  items = defaultNavItems,
  defaultActiveIndex = 0,
  activeIndex,
  onTabChange,
  className = "",
  limelightClassName = "",
  iconContainerClassName = "",
  iconClassName = "",
}: LimelightNavProps) {
  const [internalActiveIndex, setInternalActiveIndex] = useState(defaultActiveIndex);
  const [isReady, setIsReady] = useState(false);
  const navItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const limelightRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = activeIndex ?? internalActiveIndex;

  useLayoutEffect(() => {
    if (items.length === 0) return;

    const limelight = limelightRef.current;
    const activeItem = navItemRefs.current[selectedIndex] || navItemRefs.current[0];

    if (limelight && activeItem) {
      const newLeft = activeItem.offsetLeft + activeItem.offsetWidth / 2 - limelight.offsetWidth / 2;
      limelight.style.left = `${newLeft}px`;

      if (!isReady) {
        window.setTimeout(() => setIsReady(true), 50);
      }
    }
  }, [isReady, items, selectedIndex]);

  if (items.length === 0) return null;

  const handleItemClick = (index: number, itemOnClick?: () => void) => {
    setInternalActiveIndex(index);
    onTabChange?.(index);
    itemOnClick?.();
  };

  return (
    <nav className={`relative inline-flex h-14 items-center rounded-full border border-white/80 bg-white/70 px-1.5 text-foreground shadow-sm backdrop-blur-xl ${className}`} aria-label="Primary navigation">
      {items.map(({ id, icon, label, onClick }, index) => (
        <button
          key={id}
          ref={(element) => {
            navItemRefs.current[index] = element;
          }}
          className={`relative z-20 flex h-full cursor-pointer items-center justify-center gap-2 rounded-full px-4 text-sm font-black text-[var(--ink)] transition-colors hover:bg-white/60 focus-visible:bg-white/70 ${iconContainerClassName}`}
          onClick={() => handleItemClick(index, onClick)}
          type="button"
          aria-label={label}
          aria-current={selectedIndex === index ? "page" : undefined}
        >
          {cloneElement(icon, {
            className: `h-4 w-4 transition-opacity duration-100 ease-in-out ${
              selectedIndex === index ? "opacity-100" : "opacity-45"
            } ${icon.props.className || ""} ${iconClassName}`,
          })}
          {label && <span className="hidden xl:inline">{label}</span>}
        </button>
      ))}

      <div
        ref={limelightRef}
        className={`absolute top-0 z-10 h-[4px] w-10 rounded-full bg-[var(--primary)] shadow-[0_42px_18px_rgba(16,24,40,0.2)] ${
          isReady ? "transition-[left] duration-300 ease-out" : ""
        } ${limelightClassName}`}
        style={{ left: "-999px" }}
      >
        <div className="pointer-events-none absolute left-[-35%] top-[4px] h-12 w-[170%] bg-gradient-to-b from-[rgba(16,24,40,0.16)] to-transparent [clip-path:polygon(8%_100%,28%_0,72%_0,92%_100%)]" />
      </div>
    </nav>
  );
}
