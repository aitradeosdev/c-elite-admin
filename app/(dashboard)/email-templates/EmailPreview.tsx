'use client';

import { useId, useMemo, useState } from 'react';
import { TabPanel, Tabs, Toggle, useDebouncedValue, type TabItem } from '../../_ui';
import { renderTemplate } from '../notification-templates/templateRules';
import { RenderedText, type TemplatePreviewProps } from '../notification-templates/TemplateParts';
import { pickSamples, plainTextOf, previewDocument, remoteReferenceCount } from './previewDocument';
import s from './page.module.css';

type PreviewView = 'rendered' | 'text';

const VIEWS: ReadonlyArray<TabItem<PreviewView>> = [
  { value: 'rendered', label: 'Rendered' },
  { value: 'text', label: 'Plain text' },
];

const HTML_DEBOUNCE_MS = 300;

function imageCount(count: number): string {
  return count === 1 ? '1 remote image or font' : `${count.toLocaleString('en-NG')} remote images or fonts`;
}

export function EmailPreview({ variables, values, samples }: TemplatePreviewProps) {
  const tabsId = useId();
  const [view, setView] = useState<PreviewView>('rendered');
  const [phone, setPhone] = useState(false);
  const [remote, setRemote] = useState(false);
  const html = useDebouncedValue(values.html ?? '', HTML_DEBOUNCE_MS);
  const subject = values.subject ?? '';
  const filled = useMemo(() => pickSamples(samples, variables), [samples, variables]);
  const rendered = useMemo(() => renderTemplate(html, filled, 'html'), [html, filled]);
  const srcDoc = useMemo(() => previewDocument(rendered, { remoteImages: remote }), [rendered, remote]);
  const plain = useMemo(() => plainTextOf(rendered), [rendered]);
  const remoteCount = useMemo(() => remoteReferenceCount(rendered), [rendered]);

  return (
    <div className={s.preview}>
      <div className={s.subjectLine}>
        <span className={s.subjectLabel}>Subject</span>
        <span className={s.subjectText}>
          {subject.trim()
            ? <RenderedText text={subject} variables={variables} samples={filled} />
            : <span className={s.muted}>No subject</span>}
        </span>
      </div>

      <div className={s.toolbar}>
        <Tabs<PreviewView> id={tabsId} aria-label="Preview format" value={view} onChange={setView} items={VIEWS} />
        {view === 'rendered' ? (
          <div className={s.toggles}>
            <Toggle checked={phone} onChange={setPhone} label="Phone width" />
            {remoteCount > 0 ? <Toggle checked={remote} onChange={setRemote} label="Load remote images" /> : null}
          </div>
        ) : null}
      </div>

      <TabPanel tabsId={tabsId} value="rendered" active={view === 'rendered'} className={s.panel}>
        <div className={phone ? `${s.frameWrap} ${s.phone}` : s.frameWrap}>
          <iframe
            className={s.frame}
            title="Email preview with sample values"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
          />
        </div>
      </TabPanel>

      <TabPanel tabsId={tabsId} value="text" active={view === 'text'} className={s.panel}>
        <pre className={s.plain}>{plain || 'This email has no text outside its tags.'}</pre>
        <p className={s.note}>
          {`Mail apps that cannot show HTML display this version. It is made by removing the tags, so any styles inside the email and codes such as ${'&amp;'} appear as written.`}
        </p>
      </TabPanel>

      <p className={s.note}>
        {remoteCount > 0 && !remote
          ? `This email uses ${imageCount(remoteCount)} from other servers. They are not loaded here until you switch them on. `
          : null}
        {remoteCount > 0 && remote ? 'Remote images load from their own servers, which can see that the preview was opened. ' : null}
        Scripts never run in this preview and links do not open.
      </p>
    </div>
  );
}
