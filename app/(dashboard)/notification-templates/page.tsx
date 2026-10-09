'use client';

import { TemplatesPage } from './TemplatesPage';
import { PushPreview, TemplateSource } from './TemplateParts';
import { NOTIFICATION_CHANNEL, type TemplateRecord } from './templateRules';
import type { TemplatePageConfig } from './templateConfig';
import s from './page.module.css';

function summary(record: TemplateRecord) {
  return (
    <>
      <TemplateSource className={s.summaryTitle} text={record.values.title ?? ''} variables={record.variables} />
      {' · '}
      <TemplateSource text={record.values.body ?? ''} variables={record.variables} />
    </>
  );
}

const CONFIG: TemplatePageConfig = {
  channel: NOTIFICATION_CHANNEL,
  apiPath: '/api/notification-templates',
  resourceKey: 'notification-templates',
  readPermission: 'notification_templates.read',
  writePermission: 'notification_templates.write',
  writePermissionLabel: 'Edit notification templates',
  title: 'Push templates',
  subtitle:
    'The push and in-app notifications users get automatically after card decisions, payouts, bill payments and PIN resets. Saved changes apply to the next notification sent; times are WAT.',
  listLabel: 'Notification templates',
  searchPlaceholder: 'Name, key or text',
  summaryLabel: 'Message',
  renderSummary: summary,
  Preview: PushPreview,
};

export default function NotificationTemplatesPage() {
  return <TemplatesPage config={CONFIG} />;
}
