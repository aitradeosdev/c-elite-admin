// Single import surface for the admin design system. Pages do:
//   import { Button, Card, Badge, Table, Tr, Td, Modal, useToast } from '@/app/_ui';
// instead of remembering which file each lives in.

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Card, CardHeader, CardBody, CardFooter } from './Card';
export type { CardProps, CardHeaderProps, CardBodyProps } from './Card';

export { Badge } from './Badge';
export type { BadgeProps, BadgeTone, BadgeSize } from './Badge';

export { FieldShell, Input, Textarea, Select } from './Field';
export type { InputProps, TextareaProps, SelectProps } from './Field';

export { Toggle } from './Toggle';
export type { ToggleProps } from './Toggle';

export { Tabs } from './Tabs';
export type { TabsProps } from './Tabs';

export { Modal, SidePanel } from './Overlay';
export type { ModalProps, SidePanelProps, ModalSize } from './Overlay';

export { Table, THead, TBody, Tr, Th, Td, TableEmpty } from './Table';
export type { TableProps, TrProps, ThProps, TdProps, TableDensity } from './Table';

export {
  Skeleton, EmptyState, PageHeader, SectionTitle, Kpi, KpiGrid, Spinner,
  ToastProvider, useToast,
} from './Misc';
export type {
  SkeletonProps, EmptyStateProps, PageHeaderProps, KpiProps, ToastTone,
} from './Misc';

export { ThemeProvider, useTheme } from './theme';
export type { ThemeMode, ResolvedTheme } from './theme';
