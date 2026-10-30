import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown,
  ContactRound, Languages, Link2, LockKeyhole, LogOut,
  MessageSquareText, MoreHorizontal, Pencil, Plus, Search, Send, Settings2,
  ShieldCheck, Smartphone, Trash2, Unplug, UserRound, X,
} from 'lucide-react';
import {
  useGetAdminMe,
  getGetConnectionStatusQueryKey, getGetCurrentUserQueryKey, getGetDashboardActivityQueryKey, getGetDashboardSummaryQueryKey,
  getGetProfileQueryKey, getListContactsQueryKey,
  getListMessagesQueryKey, useCreateContact, useDeleteContact,
  useDisconnectWhatsApp, useGetConnectionStatus, useGetDashboardActivity,
  useGetDashboardSummary, useGetProfile, useHealthCheck, useListContacts,
  useListMessages, useRequestPairingCode, useSendManualMessage,
  useGetCurrentUser, useRegisterUser, useSignIn, useSignOut,
  useUpdateContact, useUpdateContactConsent, useUpdateProfile,
  type ActivityItem, type Contact, type Message,
  type AuthUser, type UserProfileLanguage,
} from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import AdminPage from '@/pages/admin';
import ContactsPage from '@/pages/contacts';
import WithdrawalPage from '@/pages/withdrawal';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LanguageProvider, translate, translateActivitySummary, useAppLanguage, type AppLanguage } from '@/lib/i18n';
import { DemoAccessPanel } from '@/components/demo-access';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const landingText: Record<AppLanguage, { eyebrow: string; title: string; line: string; subtitle: string; cta: string; signIn: string; proof: string }> = {
  id: { eyebrow: 'RUANG KERJA WHATSAPP', title: 'Semua pesan Anda', line: 'dalam satu layar.', subtitle: 'Kelola kontak dengan izin yang tercatat, hubungkan WhatsApp Anda sendiri, dan kirim pesan satu per satu dengan tenang.', cta: 'Mulai sekarang', signIn: 'Masuk', proof: 'Akun Anda · Izin tercatat · Pesan satu per satu' },
  en: { eyebrow: 'A WHATSAPP WORKSPACE', title: 'Every message,', line: 'on one screen.', subtitle: 'Keep your permission-aware contacts in view, connect your own WhatsApp account, and send one message at a time.', cta: 'Get started', signIn: 'Sign in', proof: 'Your account · Recorded permission · One-to-one messages' },
  zh: { eyebrow: 'WHATSAPP 工作空间', title: '所有消息，', line: '尽在一屏。', subtitle: '清晰管理已授权联系人，连接您自己的 WhatsApp 账户，并一次发送一条消息。', cta: '开始使用', signIn: '登录', proof: '您的账户 · 记录授权 · 一对一消息' },
};

function Brand({ light = false }: { light?: boolean }) {
  return <span className={`brand${light ? ' brand-light' : ''}`}><span className="brand-mark"><span>W</span></span><span>ShareWa</span></span>;
}

function LanguageSwitch({ value, onChange }: { value: AppLanguage; onChange: (lang: AppLanguage) => void }) {
  const { t } = useAppLanguage();
  return <div className="lang-switch" aria-label={t('Choose language')}>{(['id', 'en', 'zh'] as AppLanguage[]).map((lang) => <button data-testid={`button-language-${lang}`} type="button" className={value === lang ? 'active' : ''} key={lang} onClick={() => onChange(lang)}>{lang.toUpperCase()}</button>)}</div>;
}

function Landing() {
  const { language: lang, setLanguage: setLang, t } = useAppLanguage();
  const copy = landingText[lang];
  return <div className="shell">
    <header className="topbar"><Link href="/" className="brand" data-testid="link-home-brand"><Brand /></Link><div className="topbar-right"><LanguageSwitch value={lang} onChange={setLang} /><Link href="/sign-in" className="btn btn-quiet" data-testid="link-sign-in">{copy.signIn}</Link><Link href="/sign-up" className="btn btn-primary" data-testid="link-get-started">{copy.cta}<ArrowRight size={15} /></Link></div></header>
    <main className="landing"><span className="orbit" /><div className="landing-inner"><div className="hero-copy">
      <div className="brand" style={{ marginBottom: 30 }}><span className="brand-mark"><span>W</span></span><span>ShareWa</span></div>
      <div className="eyebrow"><span className="eyebrow-dot" />{copy.eyebrow}</div>
      <h1 className="hero-title" data-testid="text-landing-heading">{copy.title}<br /><em>{copy.line}</em></h1>
      <p className="hero-lede">{copy.subtitle}</p>
      <div className="hero-actions"><Link href="/sign-up" className="btn btn-primary" data-testid="link-landing-sign-up">{copy.cta}<ArrowRight size={15} /></Link><Link href="/sign-in" className="btn btn-secondary" data-testid="link-landing-sign-in">{copy.signIn}</Link></div>
      <div className="trust-note"><ShieldCheck size={14} /> {t('Built around permission, not volume.')}</div>
    </div>
    <div className="hero-visual" aria-hidden="true"><span className="visual-ring" /><span className="visual-ring" /><span className="visual-ring" /><span className="visual-core"><span>W</span></span><i className="visual-node one" /><i className="visual-node two" /><i className="visual-node three" /></div>
    </div><div className="landing-foot"><span>{copy.proof.split(' · ')[0]}</span><span>{copy.proof.split(' · ')[1]}</span><span>{copy.proof.split(' · ')[2]}</span></div></main>
  </div>;
}

const routes = [
  { href: '/dashboard', label: 'Overview', icon: Activity },
  { href: '/contacts', label: 'Contacts', icon: ContactRound },
  { href: '/messages', label: 'Messages', icon: MessageSquareText },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];
const pageNames: Record<string, string> = { '/dashboard': 'Your workspace', '/contacts': 'Contact book', '/messages': 'Message history', '/settings': 'Preferences', '/admin': 'Admin console' };

function Workspace({ children, path }: { children: ReactNode; path: string }) {
  const [, setLocation] = useLocation();
  const currentUser = useGetCurrentUser();
  const signOut = useSignOut();
  const cache = useQueryClient();
  const { language, setLanguage, t } = useAppLanguage();
  const profile = useGetProfile();
  const adminAccess = useGetAdminMe();
  useEffect(() => {
    if (profile.data?.language && profile.data.language !== language) setLanguage(profile.data.language);
  }, [language, profile.data?.language, setLanguage]);
  const shortName = profile.data?.fullName || currentUser.data?.fullName || currentUser.data?.email || 'Your account';
  return <div className="app-layout">
    <aside className="sidebar">
      <div className="side-brand"><Link href="/dashboard" className="brand"><Brand /></Link></div>
      <div className="side-label">{t('Workspace')}</div>
      <nav className="nav-links">{routes.map(({ href, label, icon: Icon }) => <Link href={href} className={`nav-link${path === href ? ' active' : ''}`} key={href} data-testid={`link-nav-${label.toLowerCase()}`}><Icon size={17} /><span>{t(label)}</span></Link>)}{adminAccess.data?.isAdmin && <Link href="/admin" className={`nav-link${path === '/admin' ? ' active' : ''}`} data-testid="link-nav-admin"><ShieldCheck size={17} /><span>{t('Admin')}</span></Link>}</nav>
      <div className="side-spacer" />
      <button className="side-account" type="button" onClick={() => setLocation('/settings')} data-testid="button-open-profile"><span className="avatar">{shortName.slice(0, 1).toUpperCase()}</span><span style={{ minWidth: 0, flex: 1 }}><span className="account-name" style={{ display: 'block' }}>{shortName}</span><span className="account-id" style={{ display: 'block' }}>{t('Personal workspace')}</span></span><ChevronDown size={14} className="muted" /></button>
      <button className="nav-link" style={{ border: 0, width: '100%', marginTop: 8 }} disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onSuccess: () => { cache.clear(); setLocation('/'); } })} data-testid="button-sign-out"><LogOut size={16} /><span>{t('Sign out')}</span></button>
    </aside>
    <main className="workspace-main">
      <header className="workspace-header"><div><div className="page-kicker">ShareWa / {t('Workspace')}</div><h1 className="page-title" data-testid="text-page-title">{t(pageNames[path] || 'Workspace')}</h1></div><div className="header-actions"><span className="status-line hide-mobile"><span className="state-dot live" /><span className="small-caption">{t('Private workspace')}</span></span></div></header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}

function ProtectedPage({ path, children }: { path: string; children: ReactNode }) {
  const currentUser = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  if (currentUser.isLoading) return <LoadingPanel />;
  if (!currentUser.data) return <Redirect to="/sign-in" />;
  return <Workspace path={path}>{children}</Workspace>;
}

function LoadingPanel() {
  const { t } = useAppLanguage();
  return <div className="panel loading-stack" aria-label={t('Loading')}><div className="skeleton skeleton-line" style={{ width: '32%' }} /><div className="skeleton skeleton-line" style={{ width: '76%' }} /><div className="skeleton skeleton-line" style={{ width: '58%' }} /></div>;
}
function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark"><ContactRound size={20} /></div><div className="empty-title">{title}</div><p className="empty-copy">{copy}</p>{action}</div>;
}
function ErrorBox({ onRetry }: { onRetry: () => void }) {
  const { t } = useAppLanguage();
  return <div className="error-state">{t('This information could not be loaded.')} <button className="text-link" type="button" onClick={onRetry} data-testid="button-retry">{t('Try again')}</button></div>;
}
function Badge({ status }: { status: string }) {
  const { t } = useAppLanguage();
  const labels: Record<string, string> = { opted_in: 'Permission recorded', opted_out: 'Opted out', pending: 'Not confirmed', sent: 'Sent', delivered: 'Delivered', failed: 'Failed', queued: 'Processing' };
  return <span className={`badge ${status}`} data-testid={`status-${status}`}>{t(labels[status] || status.replaceAll('_', ' '))}</span>;
}
function useToastMessage() {
  const [message, setMessage] = useState('');
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 3200); return () => window.clearTimeout(timer); }, [message]);
  return { message, notify: setMessage, view: message ? <div role="status" className="toast" data-testid="status-toast">{message}</div> : null };
}
const dateLocales: Record<AppLanguage, string> = { id: 'id-ID', en: 'en-US', zh: 'zh-CN' };
function formatDate(value: string | null | undefined, language: AppLanguage) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(dateLocales[language], { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatCompact(value: string | null | undefined, language: AppLanguage) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(dateLocales[language], { month: 'short', day: 'numeric' }).format(date);
}
function activityIcon(kind: ActivityItem['kind']) {
  if (kind === 'message_sent') return <Send size={14} />;
  if (kind === 'device_connected' || kind === 'device_disconnected') return <Smartphone size={14} />;
  if (kind === 'consent_updated') return <ShieldCheck size={14} />;
  return <Plus size={14} />;
}

function DashboardPage() {
  const { language, t } = useAppLanguage();
  const summary = useGetDashboardSummary();
  const activity = useGetDashboardActivity({ limit: 8 });
  const connection = useGetConnectionStatus();
  const health = useHealthCheck();
  const invalidate = useQueryClient();
  const requestCode = useRequestPairingCode();
  const disconnect = useDisconnectWhatsApp();
  const toast = useToastMessage();
  const [showPair, setShowPair] = useState(false);
  const [phone, setPhone] = useState('');
  const [pairing, setPairing] = useState<{ pairingCode: string; expiresInSeconds: number } | null>(null);
  const data = summary.data;
  const isLive = connection.data?.status === 'connected' || data?.connectionStatus === 'connected';
  const waitingForConnection = connection.data?.status === 'awaiting_link' || connection.data?.status === 'reconnecting';
  useEffect(() => {
    if (!waitingForConnection) return;
    const timer = window.setInterval(() => void connection.refetch(), 3000);
    return () => window.clearInterval(timer);
  }, [connection.refetch, waitingForConnection]);
  const refresh = () => { void summary.refetch(); void activity.refetch(); void connection.refetch(); };
  const submitPair = (event: FormEvent) => {
    event.preventDefault();
    requestCode.mutate({ data: { phone: phone.trim() } }, {
      onSuccess: (result) => { setPairing(result); void invalidate.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); toast.notify(t('Pairing code requested. Follow the WhatsApp linking steps.')); },
    });
  };
  const activities = activity.data || [];
  return <><div className="section-heading"><div><h2 className="section-title">{t('Account at a glance')}</h2><p className="section-subtitle">{t('A clear view of your connection, permission, and delivery.')}</p></div><div className="small-caption">{t('Service')} {health.data?.status || (health.isError ? t('unavailable') : t('checking'))}</div></div>
    {summary.isLoading ? <div className="metric-grid">{[0,1,2,3].map((i) => <div className="panel metric" key={i}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" style={{ width: '48%', height: 23 }} /></div>)}</div> : summary.isError ? <ErrorBox onRetry={refresh} /> : <div className="metric-grid">
      <Metric metricId="all-contacts" label={t('All contacts')} value={data?.totalContacts ?? 0} note={t('In your contact book')} />
      <Metric metricId="permission-recorded" label={t('Permission recorded')} value={data?.optedInContacts ?? 0} note={t('Eligible for one-to-one messages')} highlight />
      <Metric metricId="messages-delivered" label={t('Messages delivered')} value={data?.messagesDelivered ?? 0} note={t('{{sent}} sent · {{failed}} failed', { sent: data?.messagesSent ?? 0, failed: data?.messagesFailed ?? 0 })} />
      <Metric metricId="opted-out" label={t('Opted out')} value={data?.optedOutContacts ?? 0} note={t('Respected across your workspace')} />
    </div>}
    <div className="dash-grid">
      <section className="panel panel-pad"><div className="section-heading"><div><h2 className="section-title">{t('Recent activity')}</h2><p className="section-subtitle">{t('A private record of workspace changes.')}</p></div><Link href="/messages" className="text-link">{t('View messages')} <ArrowRight size={12} /></Link></div>
        {activity.isLoading ? <LoadingPanel /> : activity.isError ? <ErrorBox onRetry={() => void activity.refetch()} /> : activities.length ? <div className="activity-list">{activities.map((item) => <div className="activity-row" key={item.id} data-testid={`activity-item-${item.id}`}><span className="activity-icon">{activityIcon(item.kind)}</span><div className="activity-copy">{translateActivitySummary(language, item.summary)}<div className="activity-time">{formatDate(item.createdAt, language)}</div></div></div>)}</div> : <EmptyState title={t('No activity yet')} copy={t('Your contact, consent, and message actions will appear here.')} />}</section>
      <section className="panel panel-pad"><div className="section-heading"><div><h2 className="section-title">{t('Your WhatsApp')}</h2><p className="section-subtitle">{t('One linked account, under your control.')}</p></div><Link href="/settings" className="icon-btn" aria-label={t('Open connection settings')}><MoreHorizontal size={17} /></Link></div>
        <div className="connection-card"><div className="connection-state"><span className={`state-dot ${isLive ? 'live' : ''}`} /><span>{isLive ? t('Connected') : connection.data?.status === 'awaiting_link' ? t('Awaiting link') : connection.data?.status === 'reconnecting' ? t('Reconnecting') : t('Not connected')}</span></div><div className="phone-line">{connection.data?.linkedPhone || data?.linkedPhone || <span className="muted">{t('No account linked')}</span>}</div><p className="connection-note">{connection.data?.message ? t(connection.data.message) : (isLive ? t('Messages are available only for contacts with recorded permission.') : t('Link your own WhatsApp account to send individual messages.'))}</p>
          {connection.isError ? <ErrorBox onRetry={() => void connection.refetch()} /> : isLive ? <button type="button" className="btn btn-danger btn-sm" onClick={() => disconnect.mutate(undefined, { onSuccess: () => { void invalidate.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); void invalidate.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast.notify(t('WhatsApp disconnected.')); } })} disabled={disconnect.isPending} data-testid="button-disconnect">{disconnect.isPending ? t('Disconnecting…') : <><Unplug size={14} /> {t('Disconnect')}</>}</button> : <button type="button" className="btn btn-primary btn-sm" onClick={() => { setShowPair(true); setPairing(null); }} data-testid="button-link-whatsapp"><Link2 size={14} /> {t('Link WhatsApp')}</button>}
        </div>
      </section>
    </div>
    {showPair && <Dialog title={t('Link your WhatsApp')} description={t('Use your own WhatsApp account. Your number is used only to request a pairing code.')} onClose={() => setShowPair(false)}>
      {pairing ? <><p className="small-caption">{t('Enter this code in WhatsApp on the phone number you provided. Expires in {{minutes}} minutes.', { minutes: Math.ceil(pairing.expiresInSeconds / 60) })}</p><div className="pairing-code" data-testid="text-pairing-code">{pairing.pairingCode}</div><p className="small-caption">{t('WhatsApp → Linked devices → Link a device → Link with phone number instead. Keep this page open while linking.')}</p><div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="button" onClick={() => setShowPair(false)}>{t('Done')}</button></div></> :
        <form onSubmit={submitPair}><div className="form-field"><label className="field-label" htmlFor="pair-phone">{t('Your WhatsApp phone number')}</label><input id="pair-phone" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62 812 3456 7890" minLength={7} maxLength={20} required data-testid="input-pairing-phone" /></div>{requestCode.isError && <p className="dialog-error">{t('Could not request a code. Check the number and try again.')}</p>}<div className="notice"><LockKeyhole size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{t('Only link a WhatsApp account you own or are authorized to use.')}</div><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 19 }}><button type="button" className="btn btn-secondary" onClick={() => setShowPair(false)}>{t('Cancel')}</button><button className="btn btn-primary" disabled={requestCode.isPending} data-testid="button-request-pairing">{requestCode.isPending ? t('Requesting…') : t('Request pairing code')}<ArrowRight size={14} /></button></div></form>}
    </Dialog>}
    {toast.view}
  </>;
}
function Metric({ metricId, label, value, note, highlight = false }: { metricId: string; label: string; value: number; note: string; highlight?: boolean }) {
  const { language } = useAppLanguage();
  return <div className={`panel metric${highlight ? ' metric-highlight' : ''}`} data-testid={`metric-${metricId}`}><div className="metric-label">{label}</div><div className="metric-value">{value.toLocaleString(dateLocales[language])}</div><div className="metric-note">{note}</div></div>;
}

function Dialog({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  const { t } = useAppLanguage();
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  return <div className="dialog-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-head"><div><h2 id="dialog-title" className="dialog-title">{title}</h2><p className="dialog-description">{description}</p></div><button className="icon-btn" type="button" aria-label={t('Close dialog')} onClick={onClose} data-testid="button-close-dialog"><X size={17} /></button></div>{children}</section></div>;
}




function MessagesPage() {
  const { language, t } = useAppLanguage();
  const contactsQuery = useListContacts({ consent: 'opted_in' });
  const [selectedId, setSelectedId] = useState('');
  const [text, setText] = useState('');
  const connection = useGetConnectionStatus();
  const messagesQuery = useListMessages({ limit: 100 });
  const send = useSendManualMessage();
  const cache = useQueryClient();
  const toast = useToastMessage();
  const contacts = contactsQuery.data || [];
  const selected = contacts.find((contact) => contact.id === selectedId) || contacts[0];
  useEffect(() => { if (!selectedId && contacts[0]) setSelectedId(contacts[0].id); }, [contacts, selectedId]);
  const messages = useMemo(() => (messagesQuery.data || []).filter((message) => message.contactId === selected?.id), [messagesQuery.data, selected?.id]);
  const connected = connection.data?.status === 'connected';
  const canSend = !!selected && selected.consentStatus === 'opted_in' && connected && text.trim().length > 0 && !send.isPending;
  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || selected.consentStatus !== 'opted_in' || !connected || !text.trim()) return;
    const deliberateText = text.trim();
    send.mutate({ data: { contactId: selected.id, text: deliberateText } }, {
      onSuccess: () => { setText(''); void cache.invalidateQueries({ queryKey: getListMessagesQueryKey() }); void cache.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void cache.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() }); toast.notify(t('Message sent to {{name}}.', { name: selected.displayName })); },
    });
  };
  return <>
    <div className="section-heading"><div><h2 className="section-title">{t('One person at a time')}</h2><p className="section-subtitle">{t('Choose an opted-in contact, review the conversation, and send deliberately.')}</p></div><span className={`badge ${connected ? 'opted_in' : 'opted_out'}`}>{connected ? t('WhatsApp connected') : t('WhatsApp not connected')}</span></div>
    {(contactsQuery.isError || connection.isError) && <ErrorBox onRetry={() => { void contactsQuery.refetch(); void connection.refetch(); }} />}
    <div className="message-layout">
      <section className="panel message-list-panel"><div className="section-heading"><div><h3 className="section-title">{t('Permission recorded')}</h3><p className="section-subtitle">{t(contacts.length === 1 ? '{{count}} eligible contact' : '{{count}} eligible contacts', { count: contacts.length })}</p></div></div>
        {contactsQuery.isLoading ? <LoadingPanel /> : contacts.length === 0 ? <EmptyState title={t('No eligible contacts')} copy={t('Only contacts with recorded permission can be selected here.')} action={<Link href="/contacts" className="btn btn-secondary btn-sm">{t('Open contacts')}</Link>} /> : contacts.map((contact) => {
          const latest = (messagesQuery.data || []).find((message) => message.contactId === contact.id);
          return <button className={`message-item${contact.id === selected?.id ? ' selected' : ''}`} type="button" key={contact.id} onClick={() => setSelectedId(contact.id)} data-testid={`button-select-contact-${contact.id}`}><span className="message-item-top"><span className="contact-name">{contact.displayName}</span><span className="small-caption">{latest ? formatCompact(latest.createdAt, language) : ''}</span></span><span className="message-snippet">{latest?.text || contact.phone}</span></button>;
        })}
      </section>
      <section className="panel conversation">
        {selected ? <><div className="conversation-head"><div className="contact-cell"><span className="contact-initial">{selected.displayName.slice(0, 1).toUpperCase()}</span><span><span className="contact-name" style={{ display: 'block' }}>{selected.displayName}</span><span className="small-caption mono">{selected.phone}</span></span></div><Badge status={selected.consentStatus} /></div>
          <div className="conversation-body">{messagesQuery.isLoading ? <LoadingPanel /> : messagesQuery.isError ? <ErrorBox onRetry={() => void messagesQuery.refetch()} /> : messages.length ? messages.map((message: Message) => <div className="bubble" key={message.id} data-testid={`message-${message.id}`}>{message.text}<div className="bubble-meta"><span>{formatDate(message.createdAt, language)}</span><Badge status={message.status} />{message.status === 'delivered' ? <CheckCheck size={12} /> : <Check size={12} />}</div></div>) : <EmptyState title={t('A fresh conversation')} copy={t('Your one-to-one message history with this person will appear here.')} />}</div>
          {!connected && <div style={{ padding: '0 14px 12px' }}><div className="notice">{t('Connect your WhatsApp account in Overview before sending. No message will be sent while disconnected.')}</div></div>}
          <form className="compose" onSubmit={sendMessage}><label className="field-label" htmlFor="message-text">{t('Message to {{name}}', { name: selected.displayName })}</label><textarea className="textarea" id="message-text" maxLength={4000} placeholder={connected ? t('Write a personal message…') : t('Connect WhatsApp to compose and send')} value={text} onChange={(e) => setText(e.target.value)} disabled={!connected || selected.consentStatus !== 'opted_in'} data-testid="input-message-text" /><div className="compose-actions"><span className="small-caption">{t('{{count}}/4000 · one recipient only', { count: text.length })}</span><button className="btn btn-primary" type="submit" disabled={!canSend} data-testid="button-send-message"><Send size={14} />{send.isPending ? t('Sending…') : t('Send message')}</button></div>{send.isError && <p className="dialog-error">{t('Message could not be sent. You can try again when the connection is ready.')}</p>}</form>
        </> : <EmptyState title={t('Select a contact')} copy={t('Choose one opted-in contact to view and send a one-to-one message.')} />}
      </section>
    </div>
    {toast.view}
  </>;
}

function SettingsPage() {
  const { t, setLanguage: setAppLanguage } = useAppLanguage();
  const profile = useGetProfile();
  const updateProfile = useUpdateProfile();
  const connection = useGetConnectionStatus();
  const disconnect = useDisconnectWhatsApp();
  const cache = useQueryClient();
  const toast = useToastMessage();
  const [fullName, setFullName] = useState('');
  const [telegram, setTelegram] = useState('');
  const [language, setLanguage] = useState<UserProfileLanguage>('id');
  const [initialized, setInitialized] = useState(false);
  const connectionStatus = connection.data?.status;
  const connectionStatusLabel = connectionStatus === 'connected'
    ? t('Connected')
    : connectionStatus === 'awaiting_link'
      ? t('Awaiting link')
      : connectionStatus === 'reconnecting'
        ? t('Reconnecting')
        : connectionStatus === 'error'
          ? t('Connection error')
          : connectionStatus === 'disconnected'
            ? t('Not connected')
            : t('Status unavailable');
  useEffect(() => {
    if (profile.data && !initialized) {
      setFullName(profile.data.fullName);
      setTelegram(profile.data.telegramUsername || '');
      setLanguage(profile.data.language);
      setAppLanguage(profile.data.language);
      setInitialized(true);
    }
  }, [profile.data, initialized, setAppLanguage]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateProfile.mutate({ data: { fullName: fullName.trim(), telegramUsername: telegram.trim() || null, language } }, {
      onSuccess: (updated) => { cache.setQueryData(getGetProfileQueryKey(), updated); setAppLanguage(updated.language); toast.notify(translate(updated.language, 'Preferences saved.')); },
    });
  };
  return <>
    <div className="section-heading"><div><h2 className="section-title">{t('Your account, your choices')}</h2><p className="section-subtitle">{t('Update how your workspace identifies and speaks to you.')}</p></div></div>
    {profile.isLoading ? <LoadingPanel /> : profile.isError ? <ErrorBox onRetry={() => void profile.refetch()} /> : <div className="settings-grid">
      <form className="panel settings-panel" onSubmit={submit}><div className="section-heading"><div><h3 className="section-title">{t('Profile')}</h3><p className="section-subtitle">{t('Your settings are private to this workspace.')}</p></div><UserRound size={17} className="muted" /></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-name">{t('Full name')}</label><input className="field" id="profile-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} required data-testid="input-profile-name" /></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-username">{t('Username')}</label><input className="field" id="profile-username" value={profile.data?.username || ''} readOnly disabled data-testid="input-profile-username" /><div className="small-caption" style={{ marginTop: 6 }}>{t('Managed by your sign-in account.')}</div></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-telegram">{t('Telegram username')} <span className="muted">{t('(optional)')}</span></label><input className="field" id="profile-telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} maxLength={64} placeholder="@username" data-testid="input-profile-telegram" /></div>
        <button className="btn btn-primary" type="submit" disabled={updateProfile.isPending || !fullName.trim()} data-testid="button-save-profile">{updateProfile.isPending ? t('Saving…') : t('Save preferences')}<ArrowRight size={14} /></button>{updateProfile.isError && <p className="dialog-error">{t('Could not save preferences. Try again.')}</p>}
      </form>
      <div className="panel settings-panel"><div className="section-heading"><div><h3 className="section-title">{t('Workspace language')}</h3><p className="section-subtitle">{t('Choose your preferred language.')}</p></div><Languages size={17} className="muted" /></div><div className="lang-options">{([{ id: 'id', title: 'Bahasa Indonesia', hint: 'Indonesian' }, { id: 'en', title: 'English', hint: 'English' }, { id: 'zh', title: '简体中文', hint: 'Chinese' }] as const).map((item) => <button type="button" className={`lang-option${language === item.id ? ' selected' : ''}`} key={item.id} onClick={() => { setLanguage(item.id); setAppLanguage(item.id); }} data-testid={`button-preference-language-${item.id}`}><span className="radio-dot" /><span style={{ flex: 1, textAlign: 'left' }}>{t(item.title)}<span className="small-caption" style={{ display: 'block', marginTop: 2 }}>{t(item.hint)}</span></span>{language === item.id && <Check size={15} />}</button>)}</div><div className="notice" style={{ marginTop: 18 }}>{t('Language preference is saved with your profile.')}</div></div>
      <div className="panel settings-panel" style={{ gridColumn: '1 / -1' }}><div className="section-heading"><div><h3 className="section-title">{t('WhatsApp connection')}</h3><p className="section-subtitle">{t('Connection status and linked account.')}</p></div><Smartphone size={17} className="muted" /></div><div className="connection-card" style={{ marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}><div><div className="connection-state"><span className={`state-dot ${connectionStatus === 'connected' ? 'live' : ''}`} /><span>{connectionStatusLabel}</span></div><div className="phone-line">{connection.data?.linkedPhone || t('No linked phone')}</div><p className="small-caption">{connection.data?.message ? t(connection.data.message) : t('Only your own linked WhatsApp account can be used for manual one-to-one messages.')}</p></div>{connection.data?.status === 'connected' && <button className="btn btn-danger btn-sm" type="button" disabled={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSuccess: () => { void cache.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); void cache.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast.notify(t('WhatsApp disconnected.')); } })} data-testid="button-settings-disconnect"><Unplug size={14} />{t('Disconnect WhatsApp')}</button>}</div></div>
    </div>}
    {toast.view}
  </>;
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { t } = useAppLanguage();
  const [, setLocation] = useLocation();
  const cache = useQueryClient();
  const currentUser = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const signIn = useSignIn();
  const register = useRegisterUser();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const isSignUp = mode === 'sign-up';
  const isPending = signIn.isPending || register.isPending;
  const mutationError = isSignUp ? register.error : signIn.error;
  const errorMessage = authErrorMessage(mutationError, t('Check your details and try again.'));

  useEffect(() => {
    if (currentUser.data) setLocation('/dashboard');
  }, [currentUser.data, setLocation]);

  const completeSignIn = (user: AuthUser) => {
    cache.clear();
    cache.setQueryData(getGetCurrentUserQueryKey(), user);
    setLocation('/dashboard');
  };



  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSignUp) {
      register.mutate(
        { data: { fullName: fullName.trim(), email, password } },
        { onSuccess: completeSignIn },
      );
    } else {
      signIn.mutate({ data: { email, password } }, { onSuccess: completeSignIn });
    }
  };

  const fillDemo = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
  };

  return <main className="shell" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
    <div className="sign-in-main" style={{ width: '100%', maxWidth: 440 }}>
      <Link href="/" className="brand" style={{ justifyContent: 'center', marginBottom: 20 }}><Brand /></Link>
      <form className="panel panel-pad auth-form" onSubmit={submit}>
        <div className="section-heading"><div><h1 className="section-title">{t(isSignUp ? 'Create your ShareWa account' : 'Welcome back')}</h1><p className="section-subtitle">{t(isSignUp ? 'A focused workspace for permission-aware messaging' : 'Sign in to return to your ShareWa workspace')}</p></div></div>
        {isSignUp && <div className="form-field"><label className="field-label" htmlFor="auth-full-name">{t('Full name')}</label><input className="field" id="auth-full-name" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={1} maxLength={120} required data-testid="input-auth-name" /></div>}
        <div className="form-field"><label className="field-label" htmlFor="auth-email">{t('Email')}</label><input className="field" id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required data-testid="input-auth-email" /></div>
        <div className="form-field"><label className="field-label" htmlFor="auth-password">{t('Password')}</label><input className="field" id="auth-password" type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required data-testid="input-auth-password" />{isSignUp && <div className="small-caption" style={{ marginTop: 7 }}>{t('Use at least 12 characters.')}</div>}</div>
        {mutationError && <p className="dialog-error" role="alert">{errorMessage}</p>}
        <button className="btn btn-primary auth-submit" type="submit" disabled={isPending} data-testid="button-auth-submit">{isPending ? t('Please wait…') : t(isSignUp ? 'Create account' : 'Sign in')}<ArrowRight size={15} /></button>
        <p className="auth-switch">{isSignUp ? t('Already have an account?') : t('New to ShareWa?')} <Link href={isSignUp ? '/sign-in' : '/sign-up'}>{t(isSignUp ? 'Sign in' : 'Create account')}</Link></p>
      </form>
      {!isSignUp && <DemoAccessPanel onFill={fillDemo} />}
    </div>
  </main>;
}

function HomeRedirect() {
  const currentUser = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  return currentUser.data ? <Redirect to="/dashboard" /> : <Landing />;
}

function authErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'error' in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === 'string') return message;
    }
  }
  return fallback;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function AppRoutes() {
  const { t } = useAppLanguage();
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={HomeRedirect} />
    <Route path="/sign-in/*?">{() => <AuthPage mode="sign-in" />}</Route>
    <Route path="/sign-up/*?">{() => <AuthPage mode="sign-up" />}</Route>
    <Route path="/dashboard">{() => <ProtectedPage path="/dashboard"><DashboardPage /></ProtectedPage>}</Route>
    <Route path="/contacts">{() => <ProtectedPage path="/contacts"><ContactsPage /></ProtectedPage>}</Route>
    <Route path="/withdraw">{() => <ProtectedPage path="/withdraw"><WithdrawalPage /></ProtectedPage>}</Route>
    <Route path="/messages">{() => <ProtectedPage path="/messages"><MessagesPage /></ProtectedPage>}</Route>
    <Route path="/settings">{() => <ProtectedPage path="/settings"><SettingsPage /></ProtectedPage>}</Route>
    <Route path="/admin">{() => <ProtectedPage path="/admin"><AdminPage /></ProtectedPage>}</Route>
    <Route><div className="shell" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}><EmptyState title={t('Page not found')} copy={t('This ShareWa workspace page does not exist.')} action={<Link href="/" className="btn btn-primary"><ArrowLeft size={14} /> {t('Back to home')}</Link>} /></div></Route>
  </Switch></RoutedErrorBoundary>;
}
function App() {
  return <LanguageProvider><QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><AppRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider></LanguageProvider>;
}
export default App;
