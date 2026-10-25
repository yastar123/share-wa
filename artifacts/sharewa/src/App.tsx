import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown,
  ContactRound, Languages, Link2, LockKeyhole, LogOut,
  MessageSquareText, MoreHorizontal, Pencil, Plus, Search, Send, Settings2,
  ShieldCheck, Smartphone, Trash2, Unplug, UserRound, X,
} from 'lucide-react';
import {
  getGetConnectionStatusQueryKey, getGetDashboardSummaryQueryKey,
  getGetProfileQueryKey, getListContactsQueryKey,
  getListMessagesQueryKey, useCreateContact, useDeleteContact,
  useDisconnectWhatsApp, useGetConnectionStatus, useGetDashboardActivity,
  useGetDashboardSummary, useGetProfile, useHealthCheck, useListContacts,
  useListMessages, useRequestPairingCode, useSendManualMessage,
  useUpdateContact, useUpdateContactConsent, useUpdateProfile,
  type ActivityItem, type Contact, type Message,
  type UserProfileLanguage,
} from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#24dc68', colorForeground: '#e4f0e7', colorMutedForeground: '#8da094',
    colorDanger: '#e5776c', colorBackground: '#0d1b12', colorInput: '#09160e',
    colorInputForeground: '#e2eee5', colorNeutral: '#294334', fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.7rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#0d1b12] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#294334]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#e4f0e7] font-bold', headerSubtitle: 'text-[#8da094]',
    socialButtonsBlockButtonText: 'text-[#dce9df]', formFieldLabel: 'text-[#b4c4b8]',
    footerActionLink: 'text-[#4be47c]', footerActionText: 'text-[#91a295]',
    dividerText: 'text-[#829588]', identityPreviewEditButton: 'text-[#4be47c]',
    formFieldSuccessText: 'text-[#66de8b]', alertText: 'text-[#e1ece4]',
    logoBox: 'rounded-xl', logoImage: 'rounded-lg',
    socialButtonsBlockButton: 'border-[#294334] bg-[#112219] hover:bg-[#183021]',
    formButtonPrimary: 'bg-[#24dc68] text-[#07120b] hover:bg-[#52e982]',
    formFieldInput: 'bg-[#09160e] border-[#294334] text-[#e2eee5]',
    footerAction: 'text-[#91a295]', dividerLine: 'bg-[#294334]',
    alert: 'bg-[#17271c] border-[#35563d]', otpCodeFieldInput: 'bg-[#09160e] border-[#294334]',
    formFieldRow: 'text-[#b4c4b8]', main: 'text-[#e4f0e7]',
  },
};

type Lang = 'id' | 'en' | 'zh';
const landingText: Record<Lang, { eyebrow: string; title: string; line: string; subtitle: string; cta: string; signIn: string; proof: string }> = {
  id: { eyebrow: 'RUANG KERJA WHATSAPP', title: 'Semua pesan Anda', line: 'dalam satu layar.', subtitle: 'Kelola kontak dengan izin yang tercatat, hubungkan WhatsApp Anda sendiri, dan kirim pesan satu per satu dengan tenang.', cta: 'Mulai sekarang', signIn: 'Masuk', proof: 'Akun Anda · Izin tercatat · Pesan satu per satu' },
  en: { eyebrow: 'A WHATSAPP WORKSPACE', title: 'Every message,', line: 'on one screen.', subtitle: 'Keep your permission-aware contacts in view, connect your own WhatsApp account, and send one message at a time.', cta: 'Get started', signIn: 'Sign in', proof: 'Your account · Recorded permission · One-to-one messages' },
  zh: { eyebrow: 'WHATSAPP 工作空间', title: '所有消息，', line: '尽在一屏。', subtitle: '清晰管理已授权联系人，连接您自己的 WhatsApp 账户，并一次发送一条消息。', cta: '开始使用', signIn: '登录', proof: '您的账户 · 记录授权 · 一对一消息' },
};

function Brand({ light = false }: { light?: boolean }) {
  return <span className={`brand${light ? ' brand-light' : ''}`}><span className="brand-mark"><span>W</span></span><span>ShareWa</span></span>;
}

function LanguageSwitch({ value, onChange }: { value: Lang; onChange: (lang: Lang) => void }) {
  return <div className="lang-switch" aria-label="Choose language">{(['id', 'en', 'zh'] as Lang[]).map((lang) => <button data-testid={`button-language-${lang}`} type="button" className={value === lang ? 'active' : ''} key={lang} onClick={() => onChange(lang)}>{lang.toUpperCase()}</button>)}</div>;
}

function Landing() {
  const [lang, setLang] = useState<Lang>('id');
  const copy = landingText[lang];
  return <div className="shell">
    <header className="topbar"><Link href="/" className="brand" data-testid="link-home-brand"><Brand /></Link><div className="topbar-right"><LanguageSwitch value={lang} onChange={setLang} /><Link href="/sign-in" className="btn btn-quiet" data-testid="link-sign-in">{copy.signIn}</Link><Link href="/sign-up" className="btn btn-primary" data-testid="link-get-started">{copy.cta}<ArrowRight size={15} /></Link></div></header>
    <main className="landing"><span className="orbit" /><div className="landing-inner"><div className="hero-copy">
      <div className="brand" style={{ marginBottom: 30 }}><span className="brand-mark"><span>W</span></span><span>ShareWa</span></div>
      <div className="eyebrow"><span className="eyebrow-dot" />{copy.eyebrow}</div>
      <h1 className="hero-title" data-testid="text-landing-heading">{copy.title}<br /><em>{copy.line}</em></h1>
      <p className="hero-lede">{copy.subtitle}</p>
      <div className="hero-actions"><Link href="/sign-up" className="btn btn-primary" data-testid="link-landing-sign-up">{copy.cta}<ArrowRight size={15} /></Link><Link href="/sign-in" className="btn btn-secondary" data-testid="link-landing-sign-in">{copy.signIn}</Link></div>
      <div className="trust-note"><ShieldCheck size={14} /> Built around permission, not volume.</div>
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
const pageNames: Record<string, string> = { '/dashboard': 'Your workspace', '/contacts': 'Contact book', '/messages': 'Message history', '/settings': 'Preferences' };

function Workspace({ children, path }: { children: ReactNode; path: string }) {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const profile = useGetProfile();
  const shortName = profile.data?.fullName || user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Your account';
  return <div className="app-layout">
    <aside className="sidebar">
      <div className="side-brand"><Link href="/dashboard" className="brand"><Brand /></Link></div>
      <div className="side-label">Workspace</div>
      <nav className="nav-links">{routes.map(({ href, label, icon: Icon }) => <Link href={href} className={`nav-link${path === href ? ' active' : ''}`} key={href} data-testid={`link-nav-${label.toLowerCase()}`}><Icon size={17} /><span>{label}</span></Link>)}</nav>
      <div className="side-spacer" />
      <button className="side-account" type="button" onClick={() => setLocation('/settings')} data-testid="button-open-profile"><span className="avatar">{shortName.slice(0, 1).toUpperCase()}</span><span style={{ minWidth: 0, flex: 1 }}><span className="account-name" style={{ display: 'block' }}>{shortName}</span><span className="account-id" style={{ display: 'block' }}>Personal workspace</span></span><ChevronDown size={14} className="muted" /></button>
      <button className="nav-link" style={{ border: 0, width: '100%', marginTop: 8 }} onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={16} /><span>Sign out</span></button>
    </aside>
    <main className="workspace-main">
      <header className="workspace-header"><div><div className="page-kicker">ShareWa / Workspace</div><h1 className="page-title" data-testid="text-page-title">{pageNames[path] || 'Workspace'}</h1></div><div className="header-actions"><span className="status-line hide-mobile"><span className="state-dot live" /><span className="small-caption">Private workspace</span></span></div></header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}

function ProtectedPage({ path, children }: { path: string; children: ReactNode }) {
  return <><Show when="signed-in"><Workspace path={path}>{children}</Workspace></Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}

function LoadingPanel() {
  return <div className="panel loading-stack" aria-label="Loading"><div className="skeleton skeleton-line" style={{ width: '32%' }} /><div className="skeleton skeleton-line" style={{ width: '76%' }} /><div className="skeleton skeleton-line" style={{ width: '58%' }} /></div>;
}
function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark"><ContactRound size={20} /></div><div className="empty-title">{title}</div><p className="empty-copy">{copy}</p>{action}</div>;
}
function ErrorBox({ onRetry }: { onRetry: () => void }) {
  return <div className="error-state">This information could not be loaded. <button className="text-link" type="button" onClick={onRetry} data-testid="button-retry">Try again</button></div>;
}
function Badge({ status }: { status: string }) {
  const labels: Record<string, string> = { opted_in: 'Permission recorded', opted_out: 'Opted out', pending: 'Not confirmed', sent: 'Sent', delivered: 'Delivered', failed: 'Failed', queued: 'Processing' };
  return <span className={`badge ${status}`} data-testid={`status-${status}`}>{labels[status] || status.replaceAll('_', ' ')}</span>;
}
function useToastMessage() {
  const [message, setMessage] = useState('');
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 3200); return () => window.clearTimeout(timer); }, [message]);
  return { message, notify: setMessage, view: message ? <div role="status" className="toast" data-testid="status-toast">{message}</div> : null };
}
function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatCompact(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}
function activityIcon(kind: ActivityItem['kind']) {
  if (kind === 'message_sent') return <Send size={14} />;
  if (kind === 'device_connected' || kind === 'device_disconnected') return <Smartphone size={14} />;
  if (kind === 'consent_updated') return <ShieldCheck size={14} />;
  return <Plus size={14} />;
}

function DashboardPage() {
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
  const refresh = () => { void summary.refetch(); void activity.refetch(); void connection.refetch(); };
  const submitPair = (event: FormEvent) => {
    event.preventDefault();
    requestCode.mutate({ data: { phone: phone.trim() } }, {
      onSuccess: (result) => { setPairing(result); void invalidate.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); toast.notify('Pairing code requested. Follow the WhatsApp linking steps.'); },
    });
  };
  const activities = activity.data || [];
  return <><div className="section-heading"><div><h2 className="section-title">Account at a glance</h2><p className="section-subtitle">A clear view of your connection, permission, and delivery.</p></div><div className="small-caption">Service {health.data?.status || (health.isError ? 'unavailable' : 'checking')}</div></div>
    {summary.isLoading ? <div className="metric-grid">{[0,1,2,3].map((i) => <div className="panel metric" key={i}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" style={{ width: '48%', height: 23 }} /></div>)}</div> : summary.isError ? <ErrorBox onRetry={refresh} /> : <div className="metric-grid">
      <Metric label="All contacts" value={data?.totalContacts ?? 0} note="In your contact book" />
      <Metric label="Permission recorded" value={data?.optedInContacts ?? 0} note="Eligible for one-to-one messages" highlight />
      <Metric label="Messages delivered" value={data?.messagesDelivered ?? 0} note={`${data?.messagesSent ?? 0} sent · ${data?.messagesFailed ?? 0} failed`} />
      <Metric label="Opted out" value={data?.optedOutContacts ?? 0} note="Respected across your workspace" />
    </div>}
    <div className="dash-grid">
      <section className="panel panel-pad"><div className="section-heading"><div><h2 className="section-title">Recent activity</h2><p className="section-subtitle">A private record of workspace changes.</p></div><Link href="/messages" className="text-link">View messages <ArrowRight size={12} /></Link></div>
        {activity.isLoading ? <LoadingPanel /> : activity.isError ? <ErrorBox onRetry={() => void activity.refetch()} /> : activities.length ? <div className="activity-list">{activities.map((item) => <div className="activity-row" key={item.id} data-testid={`activity-item-${item.id}`}><span className="activity-icon">{activityIcon(item.kind)}</span><div className="activity-copy">{item.summary}<div className="activity-time">{formatDate(item.createdAt)}</div></div></div>)}</div> : <EmptyState title="No activity yet" copy="Your contact, consent, and message actions will appear here." />}</section>
      <section className="panel panel-pad"><div className="section-heading"><div><h2 className="section-title">Your WhatsApp</h2><p className="section-subtitle">One linked account, under your control.</p></div><Link href="/settings" className="icon-btn" aria-label="Open connection settings"><MoreHorizontal size={17} /></Link></div>
        <div className="connection-card"><div className="connection-state"><span className={`state-dot ${isLive ? 'live' : ''}`} /><span>{isLive ? 'Connected' : connection.data?.status === 'awaiting_link' ? 'Awaiting link' : connection.data?.status === 'reconnecting' ? 'Reconnecting' : 'Not connected'}</span></div><div className="phone-line">{connection.data?.linkedPhone || data?.linkedPhone || <span className="muted">No account linked</span>}</div><p className="connection-note">{connection.data?.message || (isLive ? 'Messages are available only for contacts with recorded permission.' : 'Link your own WhatsApp account to send individual messages.')}</p>
          {connection.isError ? <ErrorBox onRetry={() => void connection.refetch()} /> : isLive ? <button type="button" className="btn btn-danger btn-sm" onClick={() => disconnect.mutate(undefined, { onSuccess: () => { void invalidate.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); void invalidate.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast.notify('WhatsApp disconnected.'); } })} disabled={disconnect.isPending} data-testid="button-disconnect">{disconnect.isPending ? 'Disconnecting…' : <><Unplug size={14} /> Disconnect</>}</button> : <button type="button" className="btn btn-primary btn-sm" onClick={() => { setShowPair(true); setPairing(null); }} data-testid="button-link-whatsapp"><Link2 size={14} /> Link WhatsApp</button>}
        </div>
      </section>
    </div>
    {showPair && <Dialog title="Link your WhatsApp" description="Use your own WhatsApp account. Your number is used only to request a pairing code." onClose={() => setShowPair(false)}>
      {pairing ? <><p className="small-caption">Enter this code in WhatsApp on the phone number you provided. Expires in {Math.ceil(pairing.expiresInSeconds / 60)} minutes.</p><div className="pairing-code" data-testid="text-pairing-code">{pairing.pairingCode}</div><p className="small-caption">WhatsApp → Linked devices → Link a device → Link with phone number instead. Keep this page open while linking.</p><div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="button" onClick={() => setShowPair(false)}>Done</button></div></> :
        <form onSubmit={submitPair}><div className="form-field"><label className="field-label" htmlFor="pair-phone">Your WhatsApp phone number</label><input id="pair-phone" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62 812 3456 7890" minLength={7} maxLength={20} required data-testid="input-pairing-phone" /></div>{requestCode.isError && <p className="dialog-error">Could not request a code. Check the number and try again.</p>}<div className="notice"><LockKeyhole size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />Only link a WhatsApp account you own or are authorized to use.</div><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 19 }}><button type="button" className="btn btn-secondary" onClick={() => setShowPair(false)}>Cancel</button><button className="btn btn-primary" disabled={requestCode.isPending} data-testid="button-request-pairing">{requestCode.isPending ? 'Requesting…' : 'Request pairing code'}<ArrowRight size={14} /></button></div></form>}
    </Dialog>}
    {toast.view}
  </>;
}
function Metric({ label, value, note, highlight = false }: { label: string; value: number; note: string; highlight?: boolean }) {
  return <div className={`panel metric${highlight ? ' metric-highlight' : ''}`} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="metric-label">{label}</div><div className="metric-value">{value.toLocaleString()}</div><div className="metric-note">{note}</div></div>;
}

function Dialog({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  return <div className="dialog-backdrop" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-head"><div><h2 id="dialog-title" className="dialog-title">{title}</h2><p className="dialog-description">{description}</p></div><button className="icon-btn" type="button" aria-label="Close dialog" onClick={onClose} data-testid="button-close-dialog"><X size={17} /></button></div>{children}</section></div>;
}

function ContactsPage() {
  const [search, setSearch] = useState('');
  const [consentFilter, setConsentFilter] = useState('all');
  const [editing, setEditing] = useState<Contact | null>(null);
  const [adding, setAdding] = useState(false);
  const contactsQuery = useListContacts({ search: search || undefined, consent: consentFilter as 'all' | 'opted_in' | 'opted_out' | 'pending' });
  const create = useCreateContact();
  const update = useUpdateContact();
  const remove = useDeleteContact();
  const consent = useUpdateContactConsent();
  const cache = useQueryClient();
  const toast = useToastMessage();
  const refresh = () => void contactsQuery.refetch();
  const mutateConsent = (contact: Contact, status: 'opted_in' | 'opted_out') => {
    const source = status === 'opted_in' ? window.prompt('Where and when did this contact give permission?') : undefined;
    if (status === 'opted_in' && !source?.trim()) return;
    consent.mutate({ contactId: contact.id, data: { status, ...(source ? { source: source.trim() } : {}) } }, { onSuccess: () => { void cache.invalidateQueries({ queryKey: getListContactsQueryKey() }); void cache.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast.notify(status === 'opted_in' ? 'Permission recorded.' : 'Contact opted out.'); } });
  };
  const submitContact = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (editing) update.mutate({ contactId: editing.id, data: { displayName: String(data.get('displayName')).trim() } }, { onSuccess: () => { void cache.invalidateQueries({ queryKey: getListContactsQueryKey() }); setEditing(null); toast.notify('Contact updated.'); } });
    else create.mutate({ data: { displayName: String(data.get('displayName')).trim(), phone: String(data.get('phone')).trim(), consentConfirmed: data.get('confirmed') === 'on', consentSource: String(data.get('source')).trim() } }, { onSuccess: () => { void cache.invalidateQueries({ queryKey: getListContactsQueryKey() }); void cache.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setAdding(false); toast.notify('Contact added with permission record.'); } });
  };
  const contacts = contactsQuery.data || [];
  return <>
    <div className="section-heading"><div><h2 className="section-title">Contacts with context</h2><p className="section-subtitle">Permission status stays visible next to every person.</p></div><div className="toolbar"><div className="search-field"><Search size={15} /><input className="field" aria-label="Search contacts" placeholder="Search name or phone" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-contacts" /></div><select aria-label="Filter by permission" className="select" style={{ width: 'auto', minWidth: 135 }} value={consentFilter} onChange={(e) => setConsentFilter(e.target.value)} data-testid="select-consent-filter"><option value="all">All contacts</option><option value="opted_in">Permission recorded</option><option value="opted_out">Opted out</option><option value="pending">Not confirmed</option></select><button className="btn btn-primary" type="button" onClick={() => setAdding(true)} data-testid="button-add-contact"><Plus size={15} /> Add contact</button></div></div>
    {contactsQuery.isLoading ? <LoadingPanel /> : contactsQuery.isError ? <ErrorBox onRetry={refresh} /> : contacts.length === 0 ? <section className="panel"><EmptyState title={search || consentFilter !== 'all' ? 'No matching contacts' : 'Start with a person who said yes'} copy={search || consentFilter !== 'all' ? 'Try another search or permission filter.' : 'Record the source of consent when you add someone. You will only be able to message opted-in contacts.'} action={!(search || consentFilter !== 'all') ? <button className="btn btn-primary" type="button" onClick={() => setAdding(true)}><Plus size={14} /> Add your first contact</button> : undefined} /></section> :
      <div className="panel table-wrap"><table className="data-table"><thead><tr><th>Contact</th><th>Phone</th><th>Permission</th><th>Source</th><th>Added</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead><tbody>{contacts.map((contact) => <tr key={contact.id} data-testid={`row-contact-${contact.id}`}><td><div className="contact-cell"><span className="contact-initial">{contact.displayName.slice(0, 1).toUpperCase()}</span><span className="contact-name">{contact.displayName}</span></div></td><td className="mono">{contact.phone}</td><td><Badge status={contact.consentStatus} /></td><td>{contact.consentSource || <span className="muted">—</span>}</td><td>{formatCompact(contact.createdAt)}</td><td><div className="row-actions">{contact.consentStatus === 'opted_in' ? <button className="btn btn-secondary btn-sm" disabled={consent.isPending} onClick={() => mutateConsent(contact, 'opted_out')} type="button" data-testid={`button-opt-out-${contact.id}`}>Opt out</button> : <button className="btn btn-secondary btn-sm" disabled={consent.isPending} onClick={() => mutateConsent(contact, 'opted_in')} type="button" data-testid={`button-record-consent-${contact.id}`}>Record yes</button>}<button type="button" className="icon-btn" title="Edit name" onClick={() => setEditing(contact)} data-testid={`button-edit-contact-${contact.id}`}><Pencil size={14} /></button><button type="button" className="icon-btn danger" title="Delete contact" onClick={() => { if (window.confirm(`Remove ${contact.displayName} and its message history?`)) remove.mutate({ contactId: contact.id }, { onSuccess: () => { void cache.invalidateQueries({ queryKey: getListContactsQueryKey() }); toast.notify('Contact removed.'); } }); }} data-testid={`button-delete-contact-${contact.id}`}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div>}
    {(adding || editing) && <Dialog title={editing ? 'Edit contact' : 'Add a contact'} description={editing ? 'Update the display name for this contact.' : 'Add one person and record how they gave permission.'} onClose={() => { setAdding(false); setEditing(null); }}>
      <form onSubmit={submitContact}><div className="form-field"><label className="field-label" htmlFor="contact-name">Name</label><input id="contact-name" name="displayName" className="field" defaultValue={editing?.displayName || ''} maxLength={120} required placeholder="Contact name" data-testid="input-contact-name" /></div>
        {!editing && <><div className="form-field"><label className="field-label" htmlFor="contact-phone">Phone number</label><input id="contact-phone" name="phone" className="field" minLength={7} maxLength={20} required placeholder="+62 812 3456 7890" data-testid="input-contact-phone" /></div><div className="form-field"><label className="field-label" htmlFor="contact-source">Permission source</label><input id="contact-source" name="source" className="field" minLength={2} maxLength={200} required placeholder="For example: asked in person, 12 June" data-testid="input-consent-source" /></div><label className="check-line"><input type="checkbox" name="confirmed" required data-testid="checkbox-consent-confirmed" /><span>I confirm this person gave permission to receive messages from me. I will respect any request to opt out.</span></label></>}
        {(create.isError || update.isError) && <p className="dialog-error">Could not save this contact. Please review the details and try again.</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}><button type="button" className="btn btn-secondary" onClick={() => { setAdding(false); setEditing(null); }}>Cancel</button><button className="btn btn-primary" disabled={create.isPending || update.isPending} data-testid="button-save-contact">{create.isPending || update.isPending ? 'Saving…' : editing ? 'Save changes' : 'Add contact'}</button></div>
      </form>
    </Dialog>}
    {toast.view}
  </>;
}

function MessagesPage() {
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
      onSuccess: () => { setText(''); void cache.invalidateQueries({ queryKey: getListMessagesQueryKey() }); void cache.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast.notify(`Message sent to ${selected.displayName}.`); },
    });
  };
  return <>
    <div className="section-heading"><div><h2 className="section-title">One person at a time</h2><p className="section-subtitle">Choose an opted-in contact, review the conversation, and send deliberately.</p></div><span className={`badge ${connected ? 'opted_in' : 'opted_out'}`}>{connected ? 'WhatsApp connected' : 'WhatsApp not connected'}</span></div>
    {(contactsQuery.isError || connection.isError) && <ErrorBox onRetry={() => { void contactsQuery.refetch(); void connection.refetch(); }} />}
    <div className="message-layout">
      <section className="panel message-list-panel"><div className="section-heading"><div><h3 className="section-title">Permission recorded</h3><p className="section-subtitle">{contacts.length} eligible contact{contacts.length === 1 ? '' : 's'}</p></div></div>
        {contactsQuery.isLoading ? <LoadingPanel /> : contacts.length === 0 ? <EmptyState title="No eligible contacts" copy="Only contacts with recorded permission can be selected here." action={<Link href="/contacts" className="btn btn-secondary btn-sm">Open contacts</Link>} /> : contacts.map((contact) => {
          const latest = (messagesQuery.data || []).find((message) => message.contactId === contact.id);
          return <button className={`message-item${contact.id === selected?.id ? ' selected' : ''}`} type="button" key={contact.id} onClick={() => setSelectedId(contact.id)} data-testid={`button-select-contact-${contact.id}`}><span className="message-item-top"><span className="contact-name">{contact.displayName}</span><span className="small-caption">{latest ? formatCompact(latest.createdAt) : ''}</span></span><span className="message-snippet">{latest?.text || contact.phone}</span></button>;
        })}
      </section>
      <section className="panel conversation">
        {selected ? <><div className="conversation-head"><div className="contact-cell"><span className="contact-initial">{selected.displayName.slice(0, 1).toUpperCase()}</span><span><span className="contact-name" style={{ display: 'block' }}>{selected.displayName}</span><span className="small-caption mono">{selected.phone}</span></span></div><Badge status={selected.consentStatus} /></div>
          <div className="conversation-body">{messagesQuery.isLoading ? <LoadingPanel /> : messagesQuery.isError ? <ErrorBox onRetry={() => void messagesQuery.refetch()} /> : messages.length ? messages.map((message: Message) => <div className="bubble" key={message.id} data-testid={`message-${message.id}`}>{message.text}<div className="bubble-meta"><span>{formatDate(message.createdAt)}</span><Badge status={message.status} />{message.status === 'delivered' ? <CheckCheck size={12} /> : <Check size={12} />}</div></div>) : <EmptyState title="A fresh conversation" copy="Your one-to-one message history with this person will appear here." />}</div>
          {!connected && <div style={{ padding: '0 14px 12px' }}><div className="notice">Connect your WhatsApp account in Overview before sending. No message will be sent while disconnected.</div></div>}
          <form className="compose" onSubmit={sendMessage}><label className="field-label" htmlFor="message-text">Message to {selected.displayName}</label><textarea className="textarea" id="message-text" maxLength={4000} placeholder={connected ? 'Write a personal message…' : 'Connect WhatsApp to compose and send'} value={text} onChange={(e) => setText(e.target.value)} disabled={!connected || selected.consentStatus !== 'opted_in'} data-testid="input-message-text" /><div className="compose-actions"><span className="small-caption">{text.length}/4000 · one recipient only</span><button className="btn btn-primary" type="submit" disabled={!canSend} data-testid="button-send-message"><Send size={14} />{send.isPending ? 'Sending…' : 'Send message'}</button></div>{send.isError && <p className="dialog-error">Message could not be sent. You can try again when the connection is ready.</p>}</form>
        </> : <EmptyState title="Select a contact" copy="Choose one opted-in contact to view and send a one-to-one message." />}
      </section>
    </div>
    {toast.view}
  </>;
}

function SettingsPage() {
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
  useEffect(() => {
    if (profile.data && !initialized) {
      setFullName(profile.data.fullName);
      setTelegram(profile.data.telegramUsername || '');
      setLanguage(profile.data.language);
      setInitialized(true);
    }
  }, [profile.data, initialized]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateProfile.mutate({ data: { fullName: fullName.trim(), telegramUsername: telegram.trim() || null, language } }, {
      onSuccess: (updated) => { cache.setQueryData(getGetProfileQueryKey(), updated); toast.notify('Preferences saved.'); },
    });
  };
  return <>
    <div className="section-heading"><div><h2 className="section-title">Your account, your choices</h2><p className="section-subtitle">Update how your workspace identifies and speaks to you.</p></div></div>
    {profile.isLoading ? <LoadingPanel /> : profile.isError ? <ErrorBox onRetry={() => void profile.refetch()} /> : <div className="settings-grid">
      <form className="panel settings-panel" onSubmit={submit}><div className="section-heading"><div><h3 className="section-title">Profile</h3><p className="section-subtitle">Your settings are private to this workspace.</p></div><UserRound size={17} className="muted" /></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-name">Full name</label><input className="field" id="profile-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} required data-testid="input-profile-name" /></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-username">Username</label><input className="field" id="profile-username" value={profile.data?.username || ''} readOnly disabled data-testid="input-profile-username" /><div className="small-caption" style={{ marginTop: 6 }}>Managed by your sign-in account.</div></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-telegram">Telegram username <span className="muted">(optional)</span></label><input className="field" id="profile-telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} maxLength={64} placeholder="@username" data-testid="input-profile-telegram" /></div>
        <button className="btn btn-primary" type="submit" disabled={updateProfile.isPending || !fullName.trim()} data-testid="button-save-profile">{updateProfile.isPending ? 'Saving…' : 'Save preferences'}<ArrowRight size={14} /></button>{updateProfile.isError && <p className="dialog-error">Could not save preferences. Try again.</p>}
      </form>
      <div className="panel settings-panel"><div className="section-heading"><div><h3 className="section-title">Workspace language</h3><p className="section-subtitle">Choose your preferred language.</p></div><Languages size={17} className="muted" /></div><div className="lang-options">{([{ id: 'id', title: 'Bahasa Indonesia', hint: 'Indonesian' }, { id: 'en', title: 'English', hint: 'English' }, { id: 'zh', title: '简体中文', hint: 'Chinese' }] as const).map((item) => <button type="button" className={`lang-option${language === item.id ? ' selected' : ''}`} key={item.id} onClick={() => setLanguage(item.id)} data-testid={`button-preference-language-${item.id}`}><span className="radio-dot" /><span style={{ flex: 1, textAlign: 'left' }}>{item.title}<span className="small-caption" style={{ display: 'block', marginTop: 2 }}>{item.hint}</span></span>{language === item.id && <Check size={15} />}</button>)}</div><div className="notice" style={{ marginTop: 18 }}>Language preference is saved with your profile.</div></div>
      <div className="panel settings-panel" style={{ gridColumn: '1 / -1' }}><div className="section-heading"><div><h3 className="section-title">WhatsApp connection</h3><p className="section-subtitle">Connection status and linked account.</p></div><Smartphone size={17} className="muted" /></div><div className="connection-card" style={{ marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}><div><div className="connection-state"><span className={`state-dot ${connection.data?.status === 'connected' ? 'live' : ''}`} /><span>{connection.data?.status === 'connected' ? 'Connected' : connection.data?.status || 'Status unavailable'}</span></div><div className="phone-line">{connection.data?.linkedPhone || 'No linked phone'}</div><p className="small-caption">{connection.data?.message || 'Only your own linked WhatsApp account can be used for manual one-to-one messages.'}</p></div>{connection.data?.status === 'connected' && <button className="btn btn-danger btn-sm" type="button" disabled={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSuccess: () => { void cache.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); void cache.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast.notify('WhatsApp disconnected.'); } })} data-testid="button-settings-disconnect"><Unplug size={14} />Disconnect WhatsApp</button>}</div></div>
    </div>}
    {toast.view}
  </>;
}

function SignInPage() {
  return <main className="shell" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}><div><Link href="/" className="brand" style={{ justifyContent: 'center', marginBottom: 22 }}><Brand /></Link><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></main>;
}
function SignUpPage() {
  return <main className="shell" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}><div><Link href="/" className="brand" style={{ justifyContent: 'center', marginBottom: 22 }}><Brand /></Link><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></main>;
}
function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/dashboard" /></Show><Show when="signed-out"><Landing /></Show></>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (previousUserId.current !== undefined && previousUserId.current !== userId) client.clear();
      previousUserId.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{
    signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to return to your ShareWa workspace' } },
    signUp: { start: { title: 'Create your ShareWa account', subtitle: 'A focused workspace for permission-aware messaging' } },
  }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <ClerkQueryClientCacheInvalidator />
    <RoutedErrorBoundary><Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/dashboard">{() => <ProtectedPage path="/dashboard"><DashboardPage /></ProtectedPage>}</Route>
      <Route path="/contacts">{() => <ProtectedPage path="/contacts"><ContactsPage /></ProtectedPage>}</Route>
      <Route path="/messages">{() => <ProtectedPage path="/messages"><MessagesPage /></ProtectedPage>}</Route>
      <Route path="/settings">{() => <ProtectedPage path="/settings"><SettingsPage /></ProtectedPage>}</Route>
      <Route><div className="shell" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}><EmptyState title="Page not found" copy="This ShareWa workspace page does not exist." action={<Link href="/" className="btn btn-primary"><ArrowLeft size={14} /> Back to home</Link>} /></div></Route>
    </Switch></RoutedErrorBoundary>
  </ClerkProvider>;
}
function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ClerkRoutes /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
