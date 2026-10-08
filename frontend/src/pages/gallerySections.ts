// The gallery's table of contents (development only, like the gallery itself).

/** The gallery's sections for the src/ui primitives, in order. Each names the components it shows. */
export const PRIMITIVE_SECTIONS = [
  'Design tokens',
  'Button / IconButton / ToggleButton',
  'Field / TextInput / NumberInput / Select / SearchInput',
  'Badge / Chip',
  'Disclosure',
  'Stack / Cluster / Grid',
  'Loading / Skeleton / ErrorState / EmptyState',
  'DataTable',
  'Tooltip / TooltipText',
  'Dialog',
  'Menu / MenuItem / Popover',
  'SegmentedControl / Tabs',
  'Toaster / toast',
  'VisuallyHidden',
] as const;

/** A section's anchor id. */
export const slug = (s: string) => s.replace(/\W+/g, '-').toLowerCase();
