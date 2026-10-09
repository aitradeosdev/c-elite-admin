'use client';

import { TemplatesPage } from '../notification-templates/TemplatesPage';
import { TemplateSource } from '../notification-templates/TemplateParts';
import { EMAIL_CHANNEL, type TemplateRecord } from '../notification-templates/templateRules';
import type { TemplatePageConfig } from '../notification-templates/templateConfig';
import { EmailPreview } from './EmailPreview';

function summary(record: TemplateRecord) {
  return <TemplateSource text={record.values.subject ?? ''} variables={record.variables} />;
}

const CONFIG: TemplatePageConfig = {
  channel: EMAIL_CHANNEL,
  apiPath: '/api/email-templates',
  resourceKey: 'email-templates',
  readPermission: 'email_templates.read',
  writePermission: 'email_templates.write',
  writePermissionLabel: 'Edit email templates',
  title: 'Email templates',
  subtitle:
    'The emails the platform sends automatically, such as new-device sign-in warnings to users and security alerts to super admins. Saved changes apply to the next email sent; times are WAT.',
  listLabel: 'Email templates',
  searchPlaceholder: 'Name, key, subject or HTML',
  summaryLabel: 'Subject',
  renderSummary: summary,
  Preview: EmailPreview,
};

export default function EmailTemplatesPage() {
  return <TemplatesPage config={CONFIG} />;
}
