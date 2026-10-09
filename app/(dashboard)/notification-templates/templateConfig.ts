import type { ComponentType, ReactNode } from 'react';
import type { Permission } from '../../lib/permissions';
import type { TemplateChannel, TemplateRecord } from './templateRules';
import type { TemplatePreviewProps } from './TemplateParts';

export interface TemplatePageConfig {
  channel: TemplateChannel;
  apiPath: string;
  resourceKey: string;
  readPermission: Permission;
  writePermission: Permission;
  writePermissionLabel: string;
  title: string;
  subtitle: string;
  listLabel: string;
  searchPlaceholder: string;
  summaryLabel: string;
  renderSummary: (record: TemplateRecord) => ReactNode;
  Preview: ComponentType<TemplatePreviewProps>;
}
