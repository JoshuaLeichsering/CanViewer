// SPDX-License-Identifier: GPL-2.0-or-later
import { ICON_PATHS, type IconName } from './icon-paths';

/** A Material Symbols icon as inline SVG; it takes the surrounding text color. */
export function Icon({
  name,
  size = 24,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 -960 960 960"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
