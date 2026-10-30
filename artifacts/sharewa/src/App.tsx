import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowLeft, ArrowRight, Bell, Check, CheckCheck, ChevronDown, Eye, EyeOff,
  ContactRound, Languages, Link2, LockKeyhole, LogOut,
  MessageSquareText, MoreHorizontal, Pencil, Plus, Search, Send, Settings2,
  ShieldCheck, Smartphone, Trash2, Unplug, UserRound, Users, WalletCards, X,
} from 'lucide-react';
import {
  useGetAdminMe,
  getGetConnectionStatusQueryKey, getGetCurrentUserQueryKey, getGetDashboardActivityQueryKey, getGetDashboardSummaryQueryKey,
  getGetProfileQueryKey, getListContactsQueryKey,
  getListMessagesQueryKey, useCreateContact, useDeleteContact,
  useDisconnectWhatsApp, useGetConnectionStatus, useGetDashboardActivity,
  useGetDashboardSummary, useGetProfile, useHealthCheck, useListContacts,
  useListMessages, useRequestPairingCode, useRequestWhatsAppQrCode, useSendManualMessage, useSendMessageBatch,
  useGetCurrentUser, useRegisterUser, useSignIn, useSignOut,
  useUpdateContact, useUpdateContactConsent, useUpdateProfile,
  useChangePassword, useGetPayoutPreferences, useSavePayoutPreferences,
  useCreateWithdrawal, useGetWallet, useGetReferrals,
  getGetWalletQueryKey, getGetPayoutPreferencesQueryKey,
  getGetReferralsQueryKey,
  getListNotificationsQueryKey, useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
  useRequestPasswordReset, useConfirmPasswordReset,
  type ActivityItem, type Contact, type Message,
  ResponseParseError, type AuthUser, type UserProfileLanguage, type MessageBatchResult, type Notification,
} from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { QRCodeSVG } from 'qrcode.react';
import AdminPage from '@/pages/admin';
import ContactsPage from '@/pages/contacts';
import WithdrawalPage from '@/pages/withdrawal';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LanguageProvider, translate, translateActivitySummary, useAppLanguage, type AppLanguage } from '@/lib/i18n';
import { DemoAccessPanel } from '@/components/demo-access';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const supportTelegramUrl = (() => {
  const configuredUrl = import.meta.env.VITE_SUPPORT_TELEGRAM_URL?.trim();
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol === 'https:' && ['t.me', 'telegram.me'].includes(url.hostname)) {
      return url.toString();
    }
  } catch (error) {
    console.error('VITE_SUPPORT_TELEGRAM_URL must be a valid Telegram HTTPS URL.', error);
    return null;
  }
  console.error('VITE_SUPPORT_TELEGRAM_URL must use https://t.me or https://telegram.me.');
  return null;
})();

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        'expired-callback': () => void;
        'error-callback': () => void;
      }) => string;
      remove: (widgetId: string) => void;
    };
  }
}

const landingText: Record<AppLanguage, { eyebrow: string; title: string; line: string; subtitle: string; cta: string; signIn: string; proof: string; authEyebrow: string; authTitle: string; authSubtitle: string; authFeatures: [string, string, string] }> = {
  id: { eyebrow: 'RUANG KERJA WHATSAPP', title: 'Semua pesan Anda', line: 'dalam satu layar.', subtitle: 'Kelola kontak dengan izin yang tercatat, hubungkan WhatsApp Anda sendiri, dan kirim pesan satu per satu dengan tenang.', cta: 'Mulai sekarang', signIn: 'Masuk', proof: 'Akun Anda · Izin tercatat · Pesan satu per satu', authEyebrow: 'RUANG KERJA WHATSAPP ANDA', authTitle: 'Percakapan terasa lebih teratur.', authSubtitle: 'Kelola kontak, izin, dan pesan dalam satu ruang kerja yang tetap berada di bawah kendali Anda.', authFeatures: ['Izin kontak tercatat dengan jelas', 'Satu pesan untuk satu penerima', 'Akun WhatsApp tetap milik Anda'] },
  en: { eyebrow: 'A WHATSAPP WORKSPACE', title: 'Every message,', line: 'on one screen.', subtitle: 'Keep your permission-aware contacts in view, connect your own WhatsApp account, and send one message at a time.', cta: 'Get started', signIn: 'Sign in', proof: 'Your account · Recorded permission · One-to-one messages', authEyebrow: 'YOUR WHATSAPP WORKSPACE', authTitle: 'Make every conversation more intentional.', authSubtitle: 'Keep contacts, consent, and messages in one workspace that stays under your control.', authFeatures: ['Clear records of contact permission', 'One message to one recipient', 'Your WhatsApp account stays yours'] },
  zh: { eyebrow: 'WHATSAPP 工作空间', title: '所有消息，', line: '尽在一屏。', subtitle: '清晰管理已授权联系人，连接您自己的 WhatsApp 账户，并一次发送一条消息。', cta: '开始使用', signIn: '登录', proof: '您的账户 · 记录授权 · 一对一消息', authEyebrow: '您的 WHATSAPP 工作空间', authTitle: '让每次沟通都清晰有序。', authSubtitle: '在一个由您掌控的工作空间中管理联系人、授权和消息。', authFeatures: ['清晰记录联系人授权', '一次只向一位联系人发送消息', 'WhatsApp 账户始终由您掌控'] },
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
  { href: '/withdraw', label: 'Withdrawal', icon: WalletCards },
  { href: '/team', label: 'Referral team', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];
const pageNames: Record<string, string> = { '/dashboard': 'Your workspace', '/contacts': 'Contact book', '/messages': 'Message history', '/withdraw': 'Withdrawal', '/team': 'Referral team', '/settings': 'Preferences', '/admin': 'Admin console' };

function Workspace({ children, path }: { children: ReactNode; path: string }) {
  const [, setLocation] = useLocation();
  const currentUser = useGetCurrentUser();
  const signOut = useSignOut();
  const cache = useQueryClient();
  const { language, setLanguage, t } = useAppLanguage();
  const profile = useGetProfile();
  const adminAccess = useGetAdminMe();
  const notifications = useListNotifications({ limit: 20 }, { query: { refetchInterval: 20_000 } });
  const markNotificationRead = useMarkNotificationRead();
  const markAllNotificationsRead = useMarkAllNotificationsRead();
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
      <button className="nav-link sign-out-nav" style={{ border: 0, width: '100%', marginTop: 8 }} disabled={signOut.isPending} onClick={() => signOut.mutate(undefined, { onSuccess: () => { cache.clear(); setLocation('/'); } })} data-testid="button-sign-out"><LogOut size={16} /><span>{t('Sign out')}</span></button>
    </aside>
    <main className="workspace-main">
      <header className="workspace-header"><div><div className="page-kicker">ShareWa / {t('Workspace')}</div><h1 className="page-title" data-testid="text-page-title">{t(pageNames[path] || 'Workspace')}</h1></div><div className="header-actions"><Popover><PopoverTrigger asChild><button type="button" className="icon-btn" aria-label={t('Notifications')} data-testid="button-notifications"><Bell size={17} />{(notifications.data ?? []).some((item) => !item.readAt) && <span className="notification-dot" />}</button></PopoverTrigger><PopoverContent align="end" style={{ width: 'min(360px, calc(100vw - 32px))', padding: 14 }}><div className="section-heading" style={{ marginBottom: 10 }}><h2 className="section-title">{t('Notifications')}</h2><button className="text-link" type="button" disabled={markAllNotificationsRead.isPending || !(notifications.data ?? []).some((item) => !item.readAt)} onClick={() => markAllNotificationsRead.mutate(undefined, { onSuccess: () => void cache.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) })}>{t('Mark all read')}</button></div>{notifications.isError ? <ErrorBox onRetry={() => void notifications.refetch()} /> : (notifications.data ?? []).length === 0 ? <p className="small-caption">{t('No notifications yet.')}</p> :             <div style={{ display: 'grid', gap: 8, maxHeight: 360, overflowY: 'auto' }}>{(notifications.data ?? []).map((item: Notification) => <button key={item.id} type="button" className="notification-item" data-unread={!item.readAt} onClick={() => { if (!item.readAt) markNotificationRead.mutate({ notificationId: item.id }, { onSuccess: () => void cache.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) }); }}><strong>{t(({ message_sent: 'Message sent', batch_attention: 'Batch needs review', batch_sent: 'Batch completed', withdrawal_pending: 'Withdrawal request received', withdrawal_cancelled: 'Withdrawal request cancelled', withdrawal_paid: 'Withdrawal paid', withdrawal_rejected: 'Withdrawal request rejected', message_delivered: 'Message delivered' } as Record<string, string>)[item.kind] || item.title)}</strong><span>{item.body}</span><small>{formatDate(item.createdAt, language)}</small></button>)}</div>}{(markNotificationRead.isError || markAllNotificationsRead.isError) && <p className="dialog-error" role="alert">{t('Could not update notifications. Try again.')}</p>}</PopoverContent></Popover><span className="status-line hide-mobile"><span className="state-dot live" /><span className="small-caption">{t('Private workspace')}</span></span></div></header>
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
const currencyScale = { IDR: 1, USD: 100, CNY: 100 } as const;
function formatCurrencyAmount(amount: number, currency: 'IDR' | 'USD' | 'CNY', language: AppLanguage) {
  return new Intl.NumberFormat(dateLocales[language], {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'IDR' ? 0 : 2,
  }).format(amount / currencyScale[currency]);
}
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
  const summary = useGetDashboardSummary({ query: { refetchInterval: 5_000 } });
  const activity = useGetDashboardActivity({ limit: 8 }, { query: { refetchInterval: 10_000 } });
  const connection = useGetConnectionStatus({ query: { refetchInterval: 3_000 } });
  const health = useHealthCheck({ query: { refetchInterval: 30_000 } });
  const wallet = useGetWallet({ query: { refetchInterval: 15_000 } });
  const invalidate = useQueryClient();
  const requestCode = useRequestPairingCode();
  const requestQr = useRequestWhatsAppQrCode();
  const disconnect = useDisconnectWhatsApp();
  const toast = useToastMessage();
  const [showPair, setShowPair] = useState(false);
  const [phone, setPhone] = useState('');
  const [pairing, setPairing] = useState<{ pairingCode: string; expiresInSeconds: number } | null>(null);
  const [qrCode, setQrCode] = useState<{ qrCode: string; expiresAt: number } | null>(null);
  const [qrSecondsRemaining, setQrSecondsRemaining] = useState(0);
  const data = summary.data;
  const isLive = connection.data?.status === 'connected' || data?.connectionStatus === 'connected';
  const waitingForConnection = connection.data?.status === 'awaiting_link' || connection.data?.status === 'reconnecting';
  useEffect(() => {
    if (!waitingForConnection) return;
    const timer = window.setInterval(() => void connection.refetch(), 3000);
    return () => window.clearInterval(timer);
  }, [connection.refetch, waitingForConnection]);
  useEffect(() => {
    if (!qrCode) {
      setQrSecondsRemaining(0);
      return;
    }
    const updateRemaining = () => {
      setQrSecondsRemaining(Math.max(0, Math.ceil((qrCode.expiresAt - Date.now()) / 1000)));
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [qrCode]);
  const refresh = () => { void summary.refetch(); void activity.refetch(); void connection.refetch(); };
  const submitPair = (event: FormEvent) => {
    event.preventDefault();
    setQrCode(null);
    requestCode.mutate({ data: { phone: phone.trim() } }, {
      onSuccess: (result) => { setPairing(result); void invalidate.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); toast.notify(t('Pairing code requested. Follow the WhatsApp linking steps.')); },
    });
  };
  const submitQrRequest = () => {
    setPairing(null);
    requestQr.mutate(undefined, {
      onSuccess: (result) => {
        setQrCode({
          qrCode: result.qrCode,
          expiresAt: Date.now() + result.expiresInSeconds * 1000,
        });
        void invalidate.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() });
      },
    });
  };
  const closePairDialog = () => {
    setShowPair(false);
    setPairing(null);
    setQrCode(null);
  };
  const activities = activity.data || [];
  return <><div className="section-heading"><div><h2 className="section-title">{t('Account at a glance')}</h2><p className="section-subtitle">{t('A clear view of your connection, permission, and delivery.')}</p></div><div className="small-caption">{t('Service')} {health.data?.status || (health.isError ? t('unavailable') : t('checking'))}</div></div>
    {summary.isLoading ? <div className="metric-grid">{[0,1,2,3].map((i) => <div className="panel metric" key={i}><div className="skeleton skeleton-line" /><div className="skeleton skeleton-line" style={{ width: '48%', height: 23 }} /></div>)}</div> : summary.isError ? <ErrorBox onRetry={refresh} /> : <div className="metric-grid">
      <Metric metricId="all-contacts" label={t('All contacts')} value={data?.totalContacts ?? 0} note={t('In your contact book')} />
      <Metric metricId="permission-recorded" label={t('Permission recorded')} value={data?.optedInContacts ?? 0} note={t('Eligible for one-to-one messages')} highlight />
      <Metric metricId="messages-delivered" label={t('Messages delivered')} value={data?.messagesDelivered ?? 0} note={t('{{sent}} sent · {{failed}} failed', { sent: data?.messagesSent ?? 0, failed: data?.messagesFailed ?? 0 })} />
      <Metric metricId="opted-out" label={t('Opted out')} value={data?.optedOutContacts ?? 0} note={t('Respected across your workspace')} />
      <Metric metricId="messages-queued" label={t('Messages queued')} value={data?.messagesQueued ?? 0} note={t('Waiting for processing')} />
      <Metric metricId="messages-delivered-7d" label={t('Delivered in the last 7 days')} value={data?.messagesDeliveredLast7Days ?? 0} note={t('{{count}} failed in the same period', { count: data?.messagesFailedLast7Days ?? 0 })} />
    </div>}
    {wallet.data && <section className="panel panel-pad" style={{ marginBottom: 16 }}>
      <div className="section-heading"><div><h2 className="section-title">{t('Available balance')}</h2><p className="section-subtitle">{t('Earned from successful sends and eligible referral messages.')}</p></div><Link href="/withdraw" className="btn btn-primary btn-sm">{t('Withdraw balance')}<ArrowRight size={14} /></Link></div>
      <div className="metric-grid">
        <div className="panel metric"><div className="metric-label">{t('Available balance')}</div><div className="metric-value">{formatCurrencyAmount(wallet.data.availableBalance, wallet.data.currency, language)}</div><div className="metric-note">{t('Total earned')}: {formatCurrencyAmount(wallet.data.totalEarned, wallet.data.currency, language)}</div></div>
        <div className="panel metric"><div className="metric-label">{t('Referral members')}</div><div className="metric-value">{wallet.data.referralCount.toLocaleString(dateLocales[language])}</div><div className="metric-note">{t('People who joined with your link')}</div></div>
        <div className="panel metric"><div className="metric-label">{t('Referral earnings')}</div><div className="metric-value">{formatCurrencyAmount(wallet.data.referralEarnings, wallet.data.currency, language)}</div><div className="metric-note">{wallet.data.referralMessages} {t('messages sent by your referral team')}</div></div>
      </div>
    </section>}
    {supportTelegramUrl && <section className="panel panel-pad" style={{ marginBottom: 16 }}>
      <div className="section-heading">
        <div><h2 className="section-title">{t('Need help?')}</h2><p className="section-subtitle">{t('If something looks wrong, contact our support team on Telegram and include a screenshot.')}</p></div>
        <a className="btn btn-secondary btn-sm" href={supportTelegramUrl} target="_blank" rel="noopener noreferrer">{t('Contact support')}<ArrowRight size={14} /></a>
      </div>
    </section>}
    <div className="dash-grid">
      <section className="panel panel-pad"><div className="section-heading"><div><h2 className="section-title">{t('Recent activity')}</h2><p className="section-subtitle">{t('A private record of workspace changes.')}</p></div><Link href="/messages" className="text-link">{t('View messages')} <ArrowRight size={12} /></Link></div>
        {activity.isLoading ? <LoadingPanel /> : activity.isError ? <ErrorBox onRetry={() => void activity.refetch()} /> : activities.length ? <div className="activity-list">{activities.map((item) => <div className="activity-row" key={item.id} data-testid={`activity-item-${item.id}`}><span className="activity-icon">{activityIcon(item.kind)}</span><div className="activity-copy">{translateActivitySummary(language, item.summary)}<div className="activity-time">{formatDate(item.createdAt, language)}</div></div></div>)}</div> : <EmptyState title={t('No activity yet')} copy={t('Your contact, consent, and message actions will appear here.')} />}</section>
      <section className="panel panel-pad"><div className="section-heading"><div><h2 className="section-title">{t('Your WhatsApp')}</h2><p className="section-subtitle">{t('One linked account, under your control.')}</p></div><Link href="/settings" className="icon-btn" aria-label={t('Open connection settings')}><MoreHorizontal size={17} /></Link></div>
        <div className="connection-card"><div className="connection-state"><span className={`state-dot ${isLive ? 'live' : ''}`} /><span>{isLive ? t('Connected') : connection.data?.status === 'awaiting_link' ? t('Awaiting link') : connection.data?.status === 'reconnecting' ? t('Reconnecting') : t('Not connected')}</span></div><div className="phone-line">{connection.data?.linkedPhone || data?.linkedPhone || <span className="muted">{t('No account linked')}</span>}</div><p className="connection-note">{connection.data?.message ? t(connection.data.message) : (isLive ? t('Messages are available only for contacts with recorded permission.') : t('Link your own WhatsApp account to send individual messages.'))}</p>
          {connection.isError ? <ErrorBox onRetry={() => void connection.refetch()} /> : isLive ? <button type="button" className="btn btn-danger btn-sm" onClick={() => disconnect.mutate(undefined, { onSuccess: () => { void invalidate.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); void invalidate.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast.notify(t('WhatsApp disconnected.')); } })} disabled={disconnect.isPending} data-testid="button-disconnect">{disconnect.isPending ? t('Disconnecting…') : <><Unplug size={14} /> {t('Disconnect')}</>}</button> : <button type="button" className="btn btn-primary btn-sm" onClick={() => { setShowPair(true); setPairing(null); setQrCode(null); }} data-testid="button-link-whatsapp"><Link2 size={14} /> {t('Link WhatsApp')}</button>}
        </div>
      </section>
    </div>
    {showPair && <Dialog title={t('Link your WhatsApp')} description={t('Use your own WhatsApp account. Your number is used only to request a pairing code.')} onClose={closePairDialog}>
      {qrCode ? <div style={{ display: 'grid', justifyItems: 'center', gap: 14 }}>{qrSecondsRemaining > 0 ? <><p className="small-caption">{t('Scan this temporary QR code using WhatsApp Linked Devices. It expires in {{seconds}} seconds.', { seconds: qrSecondsRemaining })}</p><div style={{ background: '#fff', padding: 14, borderRadius: 12 }}><QRCodeSVG value={qrCode.qrCode} size={240} level="M" /></div></> : <p className="small-caption" role="status">{t('QR code expired. Request a new one.')}</p>}<p className="small-caption">{t('Keep this page open while linking. Never share a WhatsApp linking QR code.')}</p>{requestQr.isError && <p className="dialog-error">{authErrorMessage(requestQr.error, t('Could not request a QR code. Try again.'))}</p>}<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}><button type="button" className="btn btn-secondary" disabled={requestQr.isPending} onClick={submitQrRequest}>{requestQr.isPending ? t('Requesting…') : t('Request a new QR code')}</button><button type="button" className="btn btn-secondary" onClick={() => { setQrCode(null); setPairing(null); }}>{t('Back')}</button><button className="btn btn-primary" type="button" onClick={closePairDialog}>{t('Done')}</button></div></div> :
      pairing ? <><p className="small-caption">{t('Enter this code in WhatsApp on the phone number you provided. Expires in {{minutes}} minutes.', { minutes: Math.ceil(pairing.expiresInSeconds / 60) })}</p><div className="pairing-code" data-testid="text-pairing-code">{pairing.pairingCode}</div><p className="small-caption">{t('WhatsApp → Linked devices → Link a device → Link with phone number instead. Keep this page open while linking.')}</p><div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}><button className="btn btn-primary" type="button" onClick={closePairDialog}>{t('Done')}</button></div></> :
        <form onSubmit={submitPair}><div className="form-field"><label className="field-label" htmlFor="pair-phone">{t('Your WhatsApp phone number')}</label><input id="pair-phone" className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+62 812 3456 7890" minLength={7} maxLength={20} required data-testid="input-pairing-phone" /></div>{requestCode.isError && <p className="dialog-error">{authErrorMessage(requestCode.error, t('Could not request a code. Check the number and try again.'))}</p>}{requestQr.isError && <p className="dialog-error">{authErrorMessage(requestQr.error, t('Could not request a QR code. Try again.'))}</p>}<div className="notice"><LockKeyhole size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />{t('Only link a WhatsApp account you own or are authorized to use.')}</div><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', marginTop: 19 }}><button type="button" className="btn btn-secondary" onClick={closePairDialog}>{t('Cancel')}</button><button type="button" className="btn btn-secondary" disabled={requestQr.isPending} onClick={submitQrRequest}>{requestQr.isPending ? t('Requesting…') : t('Scan QR')}</button><button className="btn btn-primary" disabled={requestCode.isPending} data-testid="button-request-pairing">{requestCode.isPending ? t('Requesting…') : t('Request pairing code')}<ArrowRight size={14} /></button></div></form>}
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
  const messagesQuery = useListMessages({ limit: 100 }, { query: { refetchInterval: 3_000 } });
  const send = useSendManualMessage();
  const batchSend = useSendMessageBatch();
  const cache = useQueryClient();
  const toast = useToastMessage();
  const contacts = contactsQuery.data || [];
  const [batchContactIds, setBatchContactIds] = useState<string[]>([]);
  const [batchText, setBatchText] = useState('');
  const [batchResults, setBatchResults] = useState<MessageBatchResult['results']>([]);
  const [batchError, setBatchError] = useState('');
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
  const toggleBatchContact = (contactId: string, checked: boolean) => {
    setBatchError('');
    setBatchResults([]);
    if (checked && batchContactIds.length >= 5) {
      setBatchError(t('A batch can include at most five contacts.'));
      return;
    }
    setBatchContactIds((current) => checked
      ? [...current, contactId]
      : current.filter((id) => id !== contactId));
  };
  const sendBatch = (event: FormEvent) => {
    event.preventDefault();
    if (!connected || !batchContactIds.length || !batchText.trim()) return;
    if (!window.confirm(t('Send this message to {{count}} opted-in contacts?', { count: batchContactIds.length }))) return;
    setBatchError('');
    setBatchResults([]);
    batchSend.mutate({ data: { contactIds: batchContactIds, text: batchText.trim() } }, {
      onSuccess: (result) => {
        setBatchResults(result.results);
        setBatchContactIds([]);
        setBatchText('');
        void cache.invalidateQueries({ queryKey: getListMessagesQueryKey() });
        void cache.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void cache.invalidateQueries({ queryKey: getGetDashboardActivityQueryKey() });
      },
      onError: (error) => setBatchError(authErrorMessage(
        error,
        t('The batch could not be sent. Check the connection and contact permissions.'),
      )),
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
          <form className="compose" onSubmit={sendMessage}><label className="field-label" htmlFor="message-text">{t('Message to {{name}}', { name: selected.displayName })}</label><textarea className="textarea" id="message-text" maxLength={4000} placeholder={connected ? t('Write a personal message…') : t('Connect WhatsApp to compose and send')} value={text} onChange={(e) => setText(e.target.value)} disabled={!connected || selected.consentStatus !== 'opted_in'} data-testid="input-message-text" /><div className="compose-actions"><span className="small-caption">{t('{{count}}/4000 · one recipient only', { count: text.length })}</span><button className="btn btn-primary" type="submit" disabled={!canSend} data-testid="button-send-message"><Send size={14} />{send.isPending ? t('Sending…') : t('Send message')}</button></div>{send.isError && <p className="dialog-error">{authErrorMessage(send.error, t('Message could not be sent. You can try again when the connection is ready.'))}</p>}</form>
        </> : <EmptyState title={t('Select a contact')} copy={t('Choose one opted-in contact to view and send a one-to-one message.')} />}
      </section>
    </div>
    <form className="panel" style={{ marginTop: 16 }} onSubmit={sendBatch}>
      <div className="section-heading">
        <div><h3 className="section-title">{t('Small opted-in batch')}</h3><p className="section-subtitle">{t('Up to five contacts per batch, twenty attempted messages per hour, with a three-second pause between sends.')}</p></div>
      </div>
      {!connected && <div className="notice" style={{ marginBottom: 14 }}>{t('Connect your WhatsApp account in Overview before sending. No message will be sent while disconnected.')}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <div>
          <div className="field-label">{t('Choose opted-in contacts')} ({batchContactIds.length}/5)</div>
          <div style={{ display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto', padding: '4px 0' }}>
            {contacts.map((contact) => <label key={contact.id} className="small-caption" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={batchContactIds.includes(contact.id)}
                disabled={!connected || batchSend.isPending || (!batchContactIds.includes(contact.id) && batchContactIds.length >= 5)}
                onChange={(event) => toggleBatchContact(contact.id, event.target.checked)}
              />
              <span>{contact.displayName} · {contact.phone}</span>
            </label>)}
            {!contacts.length && <span className="small-caption">{t('No eligible contacts')}</span>}
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="batch-message-text">{t('Message for selected contacts')}</label>
          <textarea
            className="textarea"
            id="batch-message-text"
            maxLength={4000}
            placeholder={connected ? t('Write a personal message…') : t('Connect WhatsApp to compose and send')}
            value={batchText}
            onChange={(event) => setBatchText(event.target.value)}
            disabled={!connected || batchSend.isPending}
          />
          <div className="compose-actions">
            <span className="small-caption">{t('{{count}}/4000', { count: batchText.length })}</span>
            <button className="btn btn-primary" type="submit" disabled={!connected || !batchContactIds.length || !batchText.trim() || batchSend.isPending}>
              <Send size={14} />{batchSend.isPending ? t('Sending batch…') : t('Review and send batch')}
            </button>
          </div>
        </div>
      </div>
      {batchError && <p className="dialog-error" role="alert">{batchError}</p>}
      {batchResults.length > 0 && <div role="status" style={{ marginTop: 14 }}>
        <p className="small-caption">{t('Batch finished: {{sent}} sent, {{notSent}} not sent.', {
          sent: batchResults.filter((result) => result.status === 'sent').length,
          notSent: batchResults.filter((result) => result.status !== 'sent').length,
        })}</p>
        {batchResults.map((result) => <p className="small-caption" key={result.contactId}>
          {result.contactName}: {result.status === 'sent' ? t('Sent') : result.status === 'failed' ? t('Failed') : t('Not sent')}
          {result.error ? ` — ${result.error}` : ''}
        </p>)}
      </div>}
    </form>
    {toast.view}
  </>;
}

function ReferralPage() {
  const { language, t } = useAppLanguage();
  const referrals = useGetReferrals();
  const wallet = useGetWallet({ query: { refetchInterval: 15_000 } });
  const toast = useToastMessage();
  const referralUrl = referrals.data
    ? referrals.data.referralLink.startsWith('http')
      ? referrals.data.referralLink
      : `${window.location.origin}${referrals.data.referralLink}`
    : '';
  const copyLink = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      toast.notify(t('Referral link copied.'));
    } catch (error) {
      console.error('Could not copy referral link.', error);
      toast.notify(t('Could not copy the referral link.'));
    }
  };
  return <>
    <div className="section-heading"><div><h2 className="section-title">{t('Invite friends, earn rewards')}</h2><p className="section-subtitle">{t('Earn a referral commission from eligible messages sent by people who join with your link.')}</p></div></div>
    {referrals.isLoading ? <LoadingPanel /> : referrals.isError || !referrals.data ? <ErrorBox onRetry={() => void referrals.refetch()} /> : <>
      <section className="panel panel-pad">
        <div className="section-heading"><div><h3 className="section-title">{t('Your referral code')}</h3><p className="section-subtitle">{t('Share this code or the link to invite someone.')}</p></div><ShieldCheck size={18} className="muted" /></div>
        <div className="pairing-code" data-testid="text-referral-code">{referrals.data.referralCode}</div>
        <div className="compose-actions" style={{ marginTop: 16 }}>
          <span className="small-caption" style={{ overflowWrap: 'anywhere' }}>{referralUrl}</span>
          <button type="button" className="btn btn-primary" onClick={() => void copyLink()}>{t('Copy link')}</button>
        </div>
      </section>
      {wallet.data && <div className="metric-grid" style={{ marginTop: 16 }}>
        <Metric metricId="team-members" label={t('Team members')} value={wallet.data.referralCount} note={t('Joined through your link')} />
        <Metric metricId="team-sent" label={t('Team messages sent')} value={wallet.data.referralMessages} note={t('Eligible consent-based sends')} />
        <div className="panel metric"><div className="metric-label">{t('Referral earnings')}</div><div className="metric-value">{formatCurrencyAmount(wallet.data.referralEarnings, wallet.data.currency, language)}</div><div className="metric-note">{wallet.data.currency}</div></div>
      </div>}
      <section className="panel" style={{ marginTop: 16, overflow: 'hidden' }}>
        <div className="section-heading" style={{ padding: 18, marginBottom: 0 }}><div><h3 className="section-title">{t('People who joined')}</h3><p className="section-subtitle">{t('Referral members and their sent-message totals.')}</p></div></div>
        {referrals.data.members.length ? <div className="admin-user-table-wrap"><table className="data-table"><thead><tr><th>{t('Username')}</th><th>{t('Joined')}</th><th>{t('Messages sent')}</th></tr></thead><tbody>{referrals.data.members.map((member) => <tr key={member.username}><td>@{member.username}</td><td>{formatDate(member.joinedAt, language)}</td><td>{member.sentMessages}</td></tr>)}</tbody></table></div> : <EmptyState title={t('No referrals yet')} copy={t('Share your invitation link to get started.')} />}
      </section>
    </>}
    {toast.view}
  </>;
}

function SettingsPage() {
  const { t, setLanguage: setAppLanguage } = useAppLanguage();
  const profile = useGetProfile();
  const updateProfile = useUpdateProfile();
  const payoutQuery = useGetPayoutPreferences();
  const savePayout = useSavePayoutPreferences();
  const changePassword = useChangePassword();
  const connection = useGetConnectionStatus();
  const disconnect = useDisconnectWhatsApp();
  const cache = useQueryClient();
  const toast = useToastMessage();
  const [fullName, setFullName] = useState('');
  const [telegram, setTelegram] = useState('');
  const [currency, setCurrency] = useState<'IDR' | 'USD' | 'CNY'>('IDR');
  const [payoutMethod, setPayoutMethod] = useState<'bank' | 'e_wallet'>('bank');
  const [institution, setInstitution] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
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
      setCurrency(profile.data.preferredCurrency);
      setAppLanguage(profile.data.language);
      setInitialized(true);
    }
  }, [profile.data, initialized, setAppLanguage]);
  useEffect(() => {
    if (!payoutQuery.data) return;
    setPayoutMethod(payoutQuery.data.method || 'bank');
    setInstitution(payoutQuery.data.institution || '');
    setAccountNumber(payoutQuery.data.accountNumber || '');
    setAccountHolder(payoutQuery.data.accountHolder || '');
  }, [payoutQuery.data]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateProfile.mutate({ data: { fullName: fullName.trim(), telegramUsername: telegram.trim() || null, language, preferredCurrency: currency } }, {
      onSuccess: (updated) => { cache.setQueryData(getGetProfileQueryKey(), updated); setAppLanguage(updated.language); toast.notify(translate(updated.language, 'Preferences saved.')); },
    });
  };
  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== repeatPassword) return;
    changePassword.mutate({ data: { currentPassword, newPassword } }, {
      onSuccess: () => {
        cache.clear();
        setCurrentPassword('');
        setNewPassword('');
        setRepeatPassword('');
        toast.notify(t('Password changed. Sign in again with your new password.'));
      },
    });
  };
  const submitPayout = (event: FormEvent) => {
    event.preventDefault();
    savePayout.mutate({ data: { method: payoutMethod, institution: institution.trim(), accountNumber: accountNumber.trim(), accountHolder: accountHolder.trim() } }, {
      onSuccess: (updated) => {
        cache.setQueryData(getGetPayoutPreferencesQueryKey(), updated);
        void cache.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        toast.notify(t('Payout destination saved.'));
      },
    });
  };
  return <>
    <div className="section-heading"><div><h2 className="section-title">{t('Your account, your choices')}</h2><p className="section-subtitle">{t('Update how your workspace identifies and speaks to you.')}</p></div></div>
    {profile.isLoading ? <LoadingPanel /> : profile.isError ? <ErrorBox onRetry={() => void profile.refetch()} /> : <div className="settings-grid">
      <form className="panel settings-panel" onSubmit={submit}><div className="section-heading"><div><h3 className="section-title">{t('Profile')}</h3><p className="section-subtitle">{t('Your settings are private to this workspace.')}</p></div><UserRound size={17} className="muted" /></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-name">{t('Full name')}</label><input className="field" id="profile-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} required data-testid="input-profile-name" /></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-username">{t('Username')}</label><input className="field" id="profile-username" value={profile.data?.username || ''} readOnly disabled data-testid="input-profile-username" /><div className="small-caption" style={{ marginTop: 6 }}>{t('Managed by your sign-in account.')}</div></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-telegram">{t('Telegram username')} <span className="muted">{t('(optional)')}</span></label><input className="field" id="profile-telegram" value={telegram} onChange={(e) => setTelegram(e.target.value)} maxLength={64} placeholder="@username" data-testid="input-profile-telegram" /></div>
        <div className="form-field"><label className="field-label" htmlFor="profile-currency">{t('Wallet currency')}</label><select className="select" id="profile-currency" value={currency} onChange={(event) => setCurrency(event.target.value as 'IDR' | 'USD' | 'CNY')}><option value="IDR">IDR · Rupiah</option><option value="USD">USD · US Dollar</option><option value="CNY">CNY · Yuan</option></select></div>
        <button className="btn btn-primary" type="submit" disabled={updateProfile.isPending || !fullName.trim()} data-testid="button-save-profile">{updateProfile.isPending ? t('Saving…') : t('Save preferences')}<ArrowRight size={14} /></button>{updateProfile.isError && <p className="dialog-error">{t('Could not save preferences. Try again.')}</p>}
      </form>
      <div className="panel settings-panel"><div className="section-heading"><div><h3 className="section-title">{t('Workspace language')}</h3><p className="section-subtitle">{t('Choose your preferred language.')}</p></div><Languages size={17} className="muted" /></div><div className="lang-options">{([{ id: 'id', title: 'Bahasa Indonesia', hint: 'Indonesian' }, { id: 'en', title: 'English', hint: 'English' }, { id: 'zh', title: '简体中文', hint: 'Chinese' }] as const).map((item) => <button type="button" className={`lang-option${language === item.id ? ' selected' : ''}`} key={item.id} onClick={() => { setLanguage(item.id); setAppLanguage(item.id); }} data-testid={`button-preference-language-${item.id}`}><span className="radio-dot" /><span style={{ flex: 1, textAlign: 'left' }}>{t(item.title)}<span className="small-caption" style={{ display: 'block', marginTop: 2 }}>{t(item.hint)}</span></span>{language === item.id && <Check size={15} />}</button>)}</div><div className="notice" style={{ marginTop: 18 }}>{t('Language preference is saved with your profile.')}</div></div>
      <form className="panel settings-panel" onSubmit={submitPassword}>
        <div className="section-heading"><div><h3 className="section-title">{t('Change password')}</h3><p className="section-subtitle">{t('Use at least 12 characters. Changing your password signs out other sessions.')}</p></div><LockKeyhole size={17} className="muted" /></div>
        <div className="form-field"><label className="field-label" htmlFor="current-password">{t('Current password')}</label><input className="field" id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
        <div className="form-field"><label className="field-label" htmlFor="new-password">{t('New password')}</label><input className="field" id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></div>
        <div className="form-field"><label className="field-label" htmlFor="repeat-password">{t('Repeat new password')}</label><input className="field" id="repeat-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} required /></div>
        {newPassword && repeatPassword && newPassword !== repeatPassword && <p className="dialog-error">{t('Passwords do not match.')}</p>}
        {changePassword.isError && <p className="dialog-error">{authErrorMessage(changePassword.error, t('Could not change password. Check your current password.'))}</p>}
        <button className="btn btn-primary" type="submit" disabled={changePassword.isPending || newPassword.length < 12 || newPassword !== repeatPassword}>{changePassword.isPending ? t('Saving…') : t('Change password')}</button>
      </form>
      <form className="panel settings-panel" onSubmit={submitPayout}>
        <div className="section-heading"><div><h3 className="section-title">{t('Payout destination')}</h3><p className="section-subtitle">{t('Enter the exact account holder name used by your bank or e-wallet.')}</p></div><ArrowRight size={17} className="muted" /></div>
        <div className="form-field"><label className="field-label" htmlFor="payout-method">{t('Destination type')}</label><select className="select" id="payout-method" value={payoutMethod} onChange={(event) => { setPayoutMethod(event.target.value as 'bank' | 'e_wallet'); setInstitution(''); setAccountNumber(''); setAccountHolder(''); }}><option value="bank">{t('Bank')}</option><option value="e_wallet">{t('E-wallet')}</option></select></div>
        <div className="form-field"><label className="field-label" htmlFor="payout-institution">{t(payoutMethod === 'bank' ? 'Bank name' : 'E-wallet name')}</label><input className="field" id="payout-institution" value={institution} onChange={(event) => setInstitution(event.target.value)} maxLength={80} required placeholder={t(payoutMethod === 'bank' ? 'Select or enter a bank' : 'Select or enter an e-wallet')} /></div>
        <div className="form-field"><label className="field-label" htmlFor="payout-account-number">{t('Account number or phone')}</label><input className="field" id="payout-account-number" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value)} maxLength={40} required /></div>
        <div className="form-field"><label className="field-label" htmlFor="payout-account-holder">{t('Account holder name')}</label><input className="field" id="payout-account-holder" value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} maxLength={120} required /></div>
        <div className="notice">{t('A name mismatch may cause a payout to be rejected.')}</div>
        {payoutQuery.isError && <ErrorBox onRetry={() => void payoutQuery.refetch()} />}
        {savePayout.isError && <p className="dialog-error">{authErrorMessage(savePayout.error, t('Could not save payout destination.'))}</p>}
        <button className="btn btn-primary" type="submit" disabled={savePayout.isPending || payoutQuery.isLoading}>{savePayout.isPending ? t('Saving…') : t('Save payout destination')}</button>
      </form>
      <div className="panel settings-panel" style={{ gridColumn: '1 / -1' }}><div className="section-heading"><div><h3 className="section-title">{t('WhatsApp connection')}</h3><p className="section-subtitle">{t('Connection status and linked account.')}</p></div><Smartphone size={17} className="muted" /></div><div className="connection-card" style={{ marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}><div><div className="connection-state"><span className={`state-dot ${connectionStatus === 'connected' ? 'live' : ''}`} /><span>{connectionStatusLabel}</span></div><div className="phone-line">{connection.data?.linkedPhone || t('No linked phone')}</div><p className="small-caption">{connection.data?.message ? t(connection.data.message) : t('Only your own linked WhatsApp account can be used for manual one-to-one messages.')}</p></div>{connection.data?.status === 'connected' && <button className="btn btn-danger btn-sm" type="button" disabled={disconnect.isPending} onClick={() => disconnect.mutate(undefined, { onSuccess: () => { void cache.invalidateQueries({ queryKey: getGetConnectionStatusQueryKey() }); void cache.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); toast.notify(t('WhatsApp disconnected.')); } })} data-testid="button-settings-disconnect"><Unplug size={14} />{t('Disconnect WhatsApp')}</button>}</div></div>
    </div>}
    {toast.view}
  </>;
}

function AuthPage({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { language, t } = useAppLanguage();
  const copy = landingText[language];
  const [, setLocation] = useLocation();
  const cache = useQueryClient();
  const currentUser = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const signIn = useSignIn();
  const register = useRegisterUser();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const captchaContainer = useRef<HTMLDivElement>(null);
  const isSignUp = mode === 'sign-up';
  const isPending = signIn.isPending || register.isPending;
  const mutationError = isSignUp ? register.error : signIn.error;
  const errorMessage = mutationError instanceof ResponseParseError
    ? t('The sign-in service returned an unexpected response. Please try again shortly.')
    : authErrorMessage(mutationError, t('Check your details and try again.'));

  useEffect(() => {
    if (currentUser.data) setLocation('/dashboard');
  }, [currentUser.data, setLocation]);
  useEffect(() => {
    if (!isSignUp) return;
    const referralFromUrl = new URLSearchParams(window.location.search).get('ref');
    if (referralFromUrl) setReferralCode(referralFromUrl);
  }, [isSignUp]);
  useEffect(() => {
    if (!isSignUp || !turnstileSiteKey || !captchaContainer.current) return;
    let widgetId: string | undefined;
    const container = captchaContainer.current;
    const renderWidget = () => {
      if (!window.turnstile || widgetId || !container.isConnected) return;
      widgetId = window.turnstile.render(container, {
        sitekey: turnstileSiteKey,
        callback: setCaptchaToken,
        'expired-callback': () => setCaptchaToken(''),
        'error-callback': () => setCaptchaToken(''),
      });
    };
    const existingScript = document.querySelector<HTMLScriptElement>('#sharewa-turnstile');
    if (existingScript) {
      existingScript.addEventListener('load', renderWidget);
      renderWidget();
    } else {
      const script = document.createElement('script');
      script.id = 'sharewa-turnstile';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.addEventListener('load', renderWidget);
      document.head.appendChild(script);
    }
    return () => {
      if (widgetId) window.turnstile?.remove(widgetId);
      existingScript?.removeEventListener('load', renderWidget);
    };
  }, [isSignUp]);

  const completeSignIn = (user: AuthUser) => {
    cache.clear();
    cache.setQueryData(getGetCurrentUserQueryKey(), user);
    setLocation('/dashboard');
  };



  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSignUp) {
      register.mutate(
        { data: {
          fullName: fullName.trim(),
          username: username.trim().toLowerCase(),
          email: email.trim(),
          password,
          referralCode: referralCode.trim() || undefined,
          termsAccepted,
          captchaToken: captchaToken || undefined,
        } },
        { onSuccess: completeSignIn },
      );
    } else {
      signIn.mutate({ data: { identifier: username.trim(), password } }, { onSuccess: completeSignIn });
    }
  };

  const fillDemo = (demoEmail: string, demoPassword: string) => {
    setUsername(demoEmail);
    setPassword(demoPassword);
  };
  const requiresCaptcha = import.meta.env.PROD;
  const captchaReady = !requiresCaptcha || (!!turnstileSiteKey && !!captchaToken);

  return <main className="auth-shell">
    <div className="auth-layout">
      <aside className="auth-showcase">
        <Link href="/" className="brand auth-brand"><Brand /></Link>
        <div className="auth-showcase-content">
          <span className="auth-eyebrow"><span className="eyebrow-dot" />{copy.authEyebrow}</span>
          <h2>{copy.authTitle}</h2>
          <p>{copy.authSubtitle}</p>
          <div className="auth-preview" aria-hidden="true">
            <div className="auth-preview-orbit auth-preview-orbit-one" />
            <div className="auth-preview-orbit auth-preview-orbit-two" />
            <div className="auth-preview-card">
              <div className="auth-preview-heading"><span className="auth-preview-mark"><MessageSquareText size={14} /></span><span>{t('Recent activity')}</span><span className="auth-preview-live" /></div>
              <div className="auth-preview-message"><span className="auth-preview-avatar">A</span><span><strong>{t('Permission recorded')}</strong><small>{t('Contact book')}</small></span><ShieldCheck size={15} /></div>
              <div className="auth-preview-message"><span className="auth-preview-avatar alt">W</span><span><strong>{t('One linked account, under your control.')}</strong><small>{t('Private workspace')}</small></span><Activity size={15} /></div>
            </div>
          </div>
          <ul className="auth-feature-list">{copy.authFeatures.map((feature, index) => {
            const Icon = [ShieldCheck, ContactRound, MessageSquareText][index];
            return <li key={feature}><span><Icon size={15} /></span>{feature}</li>;
          })}</ul>
        </div>
        <div className="auth-showcase-footer"><ShieldCheck size={15} />{t('Built around permission, not volume.')}</div>
      </aside>
      <section className="auth-content">
        <form className="auth-form" onSubmit={submit}>
        <div className="section-heading"><div><h1 className="section-title">{t(isSignUp ? 'Create your ShareWa account' : 'Welcome back')}</h1><p className="section-subtitle">{t(isSignUp ? 'A focused workspace for permission-aware messaging' : 'Sign in to return to your ShareWa workspace')}</p></div></div>
        {isSignUp && <div className="form-field"><label className="field-label" htmlFor="auth-full-name">{t('Full name')}</label><input className="field" id="auth-full-name" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={1} maxLength={120} required data-testid="input-auth-name" /></div>}
        <div className="form-field"><label className="field-label" htmlFor="auth-username">{t(isSignUp ? 'Username' : 'Username or email')}</label><input className="field" id="auth-username" autoComplete="username" value={username} onChange={(event) => setUsername(isSignUp ? event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') : event.target.value)} minLength={isSignUp ? 3 : 1} maxLength={isSignUp ? 28 : 254} required data-testid="input-auth-username" placeholder={t(isSignUp ? 'Your username' : 'Username or email')} />{isSignUp && <div className="small-caption" style={{ marginTop: 7 }}>{t('Use lowercase letters, numbers, and underscores.')}</div>}</div>
        {isSignUp && <div className="form-field"><label className="field-label" htmlFor="auth-email">{t('Email')}</label><input className="field" id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required data-testid="input-auth-email" /></div>}
        <div className="form-field"><label className="field-label" htmlFor="auth-password">{t('Password')}</label><div style={{ position: 'relative' }}><input className="field" style={{ paddingRight: 48 }} id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={isSignUp ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required data-testid="input-auth-password" /><button type="button" className="icon-btn" style={{ position: 'absolute', right: 6, top: 5 }} aria-label={t(showPassword ? 'Hide password' : 'Show password')} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>{isSignUp && <div className="small-caption" style={{ marginTop: 7 }}>{t('Use at least 12 characters.')}</div>}</div>
        {isSignUp && <div className="form-field"><label className="field-label" htmlFor="auth-referral">{t('Referral code')} <span className="muted">{t('(optional)')}</span></label><input className="field" id="auth-referral" value={referralCode} onChange={(event) => setReferralCode(event.target.value.toUpperCase())} maxLength={16} placeholder={t('Have a friend code?')} /></div>}
        {isSignUp && <>
          <div className="notice">{t('Use an email you can access if you need to reset your password.')}</div>
          <div className="form-field"><span className="field-label">{t('One last step: verify you are human')}</span>{turnstileSiteKey ? <div ref={captchaContainer} /> : <div className="small-caption">{t('Human verification is configured by the administrator.')}</div>}</div>
          <label className="small-caption" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} required /><span>{t('I agree to the')} <Link href="/terms" className="text-link">{t('Terms & Conditions')}</Link> {t('and')} <Link href="/privacy" className="text-link">{t('Privacy Policy')}</Link>.</span></label>
        </>}
        {mutationError && <p className="dialog-error" role="alert">{errorMessage}</p>}
        <button className="btn btn-primary auth-submit" type="submit" disabled={isPending || isSignUp && (!termsAccepted || !captchaReady)} data-testid="button-auth-submit">{isPending ? t('Please wait…') : t(isSignUp ? 'Create account' : 'Sign in')}<ArrowRight size={15} /></button>
        <p className="auth-switch">{isSignUp ? t('Already have an account?') : t('New to ShareWa?')} <Link href={isSignUp ? '/sign-in' : '/sign-up'}>{t(isSignUp ? 'Sign in' : 'Create account')}</Link></p>
        {!isSignUp && <p className="auth-switch"><Link href="/reset-password">{t('Forgot password?')}</Link></p>}
      </form>
      {!isSignUp && import.meta.env.DEV && <div className="auth-demo-wrap"><DemoAccessPanel onFill={fillDemo} /></div>}
      </section>
    </div>
  </main>;
}

function PasswordResetPage() {
  const { t } = useAppLanguage();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const request = useRequestPasswordReset();
  const confirm = useConfirmPasswordReset();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [requestAccepted, setRequestAccepted] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const submitRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    request.mutate({ data: { email: email.trim() } }, {
      onSuccess: () => setRequestAccepted(true),
    });
  };
  const submitConfirmation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== repeatPassword || !token) return;
    confirm.mutate({ data: { token, password } }, {
      onSuccess: () => setResetComplete(true),
    });
  };
  return <main className="shell" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
    <div className="sign-in-main" style={{ width: '100%', maxWidth: 440 }}>
      <Link href="/" className="brand" style={{ justifyContent: 'center', marginBottom: 20 }}><Brand /></Link>
      <section className="panel panel-pad auth-form">
        <div className="section-heading"><div><h1 className="section-title">{t('Reset your password')}</h1><p className="section-subtitle">{t('Use your account email to receive a secure, one-time reset link.')}</p></div></div>
        {token ? resetComplete ? <><div className="notice">{t('Password updated. Sign in with your new password.')}</div><Link className="btn btn-primary" href="/sign-in" style={{ marginTop: 16 }}>{t('Back to sign in')}<ArrowRight size={14} /></Link></> :
          <form onSubmit={submitConfirmation}>
            <div className="form-field"><label className="field-label" htmlFor="reset-password">{t('New password')}</label><input className="field" id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required /></div>
            <div className="form-field"><label className="field-label" htmlFor="reset-password-repeat">{t('Repeat new password')}</label><input className="field" id="reset-password-repeat" type="password" autoComplete="new-password" value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} minLength={12} maxLength={128} required /></div>
            {password && repeatPassword && password !== repeatPassword && <p className="dialog-error">{t('Passwords do not match.')}</p>}
            {confirm.isError && <p className="dialog-error" role="alert">{t('This reset link is invalid, expired, or already used.')}</p>}
            <button className="btn btn-primary auth-submit" type="submit" disabled={confirm.isPending || password.length < 12 || password !== repeatPassword}>{confirm.isPending ? t('Saving…') : t('Reset password')}<ArrowRight size={14} /></button>
          </form> :
          requestAccepted ? <div className="notice" role="status">{t('If the email belongs to an account, password reset instructions will be sent.')}</div> :
          <form onSubmit={submitRequest}>
            <div className="form-field"><label className="field-label" htmlFor="reset-email">{t('Email')}</label><input className="field" id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></div>
            {request.isError && <p className="dialog-error" role="alert">{authErrorMessage(request.error, t('Password recovery is not configured or available right now.'))}</p>}
            <button className="btn btn-primary auth-submit" type="submit" disabled={request.isPending}>{request.isPending ? t('Please wait…') : t('Send reset link')}<ArrowRight size={14} /></button>
          </form>}
        {!resetComplete && <p className="auth-switch"><Link href="/sign-in">{t('Back to sign in')}</Link></p>}
      </section>
    </div>
  </main>;
}

function LegalPage({ policy }: { policy: 'terms' | 'privacy' }) {
  const { t } = useAppLanguage();
  return <main className="shell" style={{ minHeight: '100dvh', padding: 24 }}>
    <header className="topbar"><Link href="/" className="brand"><Brand /></Link><Link href="/sign-up" className="btn btn-secondary">{t('Back to sign up')}</Link></header>
    <article className="panel panel-pad" style={{ maxWidth: 760, margin: '40px auto' }}>
      <h1 className="section-title">{t(policy === 'terms' ? 'Terms & Conditions' : 'Privacy Policy')}</h1>
      {policy === 'terms' ? <>
        <p className="section-subtitle">{t('ShareWa is a workspace for managing contacts that have given you permission to receive messages.')}</p>
        <h2>{t('Messaging responsibility')}</h2><p>{t('You may only message contacts with current, recorded permission. Respect opt-out requests and applicable law and WhatsApp terms. Automated sending is limited and may be paused by administrators.')}</p>
        <h2>{t('Wallet and withdrawals')}</h2><p>{t('Displayed earnings follow the rates configured by administrators. Withdrawal requests are reviewed and paid manually; a pending request is not a guarantee of payment.')}</p>
        <h2>{t('Account security')}</h2><p>{t('Use an account and WhatsApp number you own or are authorized to manage. Keep your password and linked-device access private.')}</p>
      </> : <>
        <p className="section-subtitle">{t('ShareWa stores account, contact-permission, message-status, and payout information needed to operate your workspace.')}</p>
        <h2>{t('WhatsApp and contacts')}</h2><p>{t('Linked WhatsApp credentials are encrypted at rest. Contact details and message records are accessible only to the account owner and authorized administrators for service operations.')}</p>
        <h2>{t('Payout information')}</h2><p>{t('Payout destination details are used to process withdrawal requests. You can update your saved destination in account settings.')}</p>
        <h2>{t('Retention and choices')}</h2><p>{t('You can opt contacts out, remove contact records, disconnect WhatsApp, and request account deletion through available account controls.')}</p>
      </>}
      <Link href="/sign-up" className="btn btn-primary" style={{ marginTop: 16 }}>{t('Back to sign up')}</Link>
    </article>
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
    <Route path="/reset-password" component={PasswordResetPage} />
    <Route path="/terms">{() => <LegalPage policy="terms" />}</Route>
    <Route path="/privacy">{() => <LegalPage policy="privacy" />}</Route>
    <Route path="/dashboard">{() => <ProtectedPage path="/dashboard"><DashboardPage /></ProtectedPage>}</Route>
    <Route path="/contacts">{() => <ProtectedPage path="/contacts"><ContactsPage /></ProtectedPage>}</Route>
    <Route path="/withdraw">{() => <ProtectedPage path="/withdraw"><WithdrawalPage /></ProtectedPage>}</Route>
    <Route path="/team">{() => <ProtectedPage path="/team"><ReferralPage /></ProtectedPage>}</Route>
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
