import './admin.css';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Check, ChevronLeft, ChevronRight, CircleHelp,
  ContactRound, LoaderCircle, LockKeyhole, MessageSquareText, Pause, Play,
  RefreshCw, Search, Send, Shield, ShieldCheck, Smartphone, Trash2, Users,
} from 'lucide-react';
import {
  getGetAdminOverviewQueryKey, getGetAdminSystemSettingsQueryKey,
  getListAdminContactsQueryKey, getListAdminMessagesQueryKey, getListAdminUsersQueryKey,
  useDeleteAdminContact, useDeleteAdminMessage, useDeleteAdminUser,
  useDisconnectAdminUserWhatsApp, useGetAdminMe, useGetAdminOverview, useGetCurrentUser,
  useGetAdminSystemSettings, useListAdminContacts, useListAdminMessages,
  useListAdminUsers, useSendAdminMessage, useUpdateAdminContact,
  useUpdateAdminSystemSettings, useUpdateAdminUserRole, useUpdateAdminUserStatus,
} from '@workspace/api-client-react';
import { useAppLanguage } from '@/lib/i18n';

const PAGE_SIZE = 12;
const locales = { id: 'id-ID', en: 'en-US', zh: 'zh-CN' } as const;
const connectionKeys = ['connected', 'disconnected', 'awaitingLink', 'reconnecting', 'error'] as const;

type Tab = 'overview' | 'accounts' | 'contacts' | 'messages' | 'system';

function dateLabel(value: string | null | undefined, language: keyof typeof locales) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locales[language], { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function AdminSkeleton() {
  const { t } = useAppLanguage();
  return <div className="admin-skeleton-stack" aria-label={t('Loading admin data')} data-testid="admin-loading">
    <div className="admin-skeleton-metrics">{[0, 1, 2, 3].map((item) => <div className="panel admin-skeleton-card" key={item}><i /><i /><i /></div>)}</div>
    <div className="panel admin-skeleton-table"><i /><i /><i /><i /></div>
  </div>;
}

function AdminMetric({ label, value, detail, icon: Icon, accent = false, testId }: {
  label: string; value: number; detail: string; icon: typeof Users; accent?: boolean; testId: string;
}) {
  const { language } = useAppLanguage();
  return <div className={`panel admin-metric${accent ? ' admin-metric-accent' : ''}`} data-testid={testId}>
    <div className="admin-metric-top"><span>{label}</span><span className="admin-metric-icon"><Icon size={16} /></span></div>
    <strong>{value.toLocaleString(locales[language])}</strong><small>{detail}</small>
  </div>;
}

export function AdminPage() {
  const { language, t } = useAppLanguage();
  const currentUser = useGetCurrentUser();
  const cache = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [offset, setOffset] = useState(0);
  const [contactSearch, setContactSearch] = useState('');
  const [contactConsent, setContactConsent] = useState('all');
  const [messageSearch, setMessageSearch] = useState('');
  const [messageStatus, setMessageStatus] = useState('all');
  const [messageOwner, setMessageOwner] = useState('');
  const [sendOwner, setSendOwner] = useState('');
  const [sendContact, setSendContact] = useState('');
  const [sendText, setSendText] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const adminCheck = useGetAdminMe();
  const isAdmin = adminCheck.data?.isAdmin === true;
  const overview = useGetAdminOverview({ query: { enabled: isAdmin, queryKey: getGetAdminOverviewQueryKey() } });
  const users = useListAdminUsers({ limit: 100, offset: 0 }, { query: { enabled: isAdmin, queryKey: getListAdminUsersQueryKey({ limit: 100, offset: 0 }) } });
  const contactsParams = { limit: 100, offset: 0, search: contactSearch || undefined, consentStatus: contactConsent as 'all' | 'opted_in' | 'opted_out' | 'pending' };
  const contacts = useListAdminContacts(contactsParams, { query: { enabled: isAdmin, queryKey: getListAdminContactsQueryKey(contactsParams) } });
  const candidatesParams = { limit: 100, offset: 0, consentStatus: 'opted_in' as const };
  const sendCandidates = useListAdminContacts(candidatesParams, { query: { enabled: isAdmin, queryKey: getListAdminContactsQueryKey(candidatesParams) } });
  const messagesParams = { limit: PAGE_SIZE, offset, search: messageSearch || undefined, ownerUserId: messageOwner || undefined, status: messageStatus as 'all' | 'queued' | 'sent' | 'delivered' | 'failed' };
  const messages = useListAdminMessages(messagesParams, { query: { enabled: isAdmin, queryKey: getListAdminMessagesQueryKey(messagesParams) } });
  const settings = useGetAdminSystemSettings({ query: { enabled: isAdmin, queryKey: getGetAdminSystemSettingsQueryKey() } });

  const updateRole = useUpdateAdminUserRole();
  const updateStatus = useUpdateAdminUserStatus();
  const deleteUser = useDeleteAdminUser();
  const updateContact = useUpdateAdminContact();
  const deleteContact = useDeleteAdminContact();
  const sendMessage = useSendAdminMessage();
  const deleteMessage = useDeleteAdminMessage();
  const updateSettings = useUpdateAdminSystemSettings();
  const disconnect = useDisconnectAdminUserWhatsApp();

  const refreshEverything = () => {
    void adminCheck.refetch(); void overview.refetch(); void users.refetch();
    void contacts.refetch(); void messages.refetch(); void settings.refetch();
  };
  const invalidateOverviewUsers = async () => Promise.all([
    cache.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }),
    cache.invalidateQueries({ queryKey: getListAdminUsersQueryKey() }),
  ]);
  const invalidateContacts = async () => Promise.all([
    cache.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }),
    cache.invalidateQueries({ queryKey: getListAdminContactsQueryKey() }),
  ]);
  const invalidateMessages = async () => Promise.all([
    cache.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }),
    cache.invalidateQueries({ queryKey: getListAdminMessagesQueryKey() }),
  ]);
  const accountList = users.data?.users ?? [];
  const activeAdminCount = accountList.filter((account) => account.isAdmin && account.accountStatus === 'active').length;
  const currentTotalAdmins = overview.data?.totalAdmins ?? 0;
  const lastActiveAdminRemovalBlocked = (account: (typeof accountList)[number]) =>
    account.isAdmin && account.accountStatus === 'active' && (activeAdminCount <= 1 || currentTotalAdmins <= 1);

  const changeRole = (userId: string, currentRole: boolean) => {
    if (currentRole && currentTotalAdmins <= 1) {
      setFeedback({ tone: 'error', message: t('The last administrator cannot be removed. Grant another admin role first.') });
      return;
    }
    const nextRole = !currentRole;
    updateRole.mutate({ userId, data: { isAdmin: nextRole } }, {
      onSuccess: async () => { await invalidateOverviewUsers(); setFeedback({ tone: 'success', message: t(nextRole ? 'Administrator role granted.' : 'Administrator role revoked.') }); },
      onError: () => setFeedback({ tone: 'error', message: t('Role update failed. Please try again.') }),
    });
  };

  const setAccountStatus = (account: (typeof accountList)[number]) => {
    const next = account.accountStatus === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && account.userId === currentUser.data?.userId) {
      setFeedback({ tone: 'error', message: t('You cannot suspend your own account.') }); return;
    }
    if (next === 'suspended' && lastActiveAdminRemovalBlocked(account)) {
      setFeedback({ tone: 'error', message: t('The last active administrator cannot be suspended.') }); return;
    }
    if (!window.confirm(t(next === 'suspended' ? 'Suspend this account?' : 'Reactivate this account?'))) return;
    updateStatus.mutate({ userId: account.userId, data: { status: next } }, {
      onSuccess: async () => { await invalidateOverviewUsers(); setFeedback({ tone: 'success', message: t(next === 'suspended' ? 'Account suspended.' : 'Account reactivated.') }); },
      onError: () => setFeedback({ tone: 'error', message: t('Account status update failed.') }),
    });
  };

  const removeAccount = (account: (typeof accountList)[number]) => {
    if (account.userId === currentUser.data?.userId) { setFeedback({ tone: 'error', message: t('You cannot delete your own account.') }); return; }
    if (lastActiveAdminRemovalBlocked(account)) { setFeedback({ tone: 'error', message: t('The last active administrator cannot be deleted.') }); return; }
    const pendingDelete = account.accountStatus === 'deletion_pending';
    const prompt = pendingDelete ? t('Retry permanent deletion for this account?') : t('Permanently delete this account and all stored contacts and message data?');
    if (!window.confirm(prompt)) return;
    deleteUser.mutate({ userId: account.userId }, {
      onSuccess: async (result) => {
        await Promise.all([invalidateOverviewUsers(), cache.invalidateQueries({ queryKey: getListAdminContactsQueryKey() }), cache.invalidateQueries({ queryKey: getListAdminMessagesQueryKey() })]);
        setFeedback({ tone: 'success', message: t(result.status === 'deletion_pending' ? 'Deletion is pending. Retry when ready.' : 'Account permanently deleted.') });
      },
      onError: () => setFeedback({ tone: 'error', message: t('Account deletion failed. Please try again.') }),
    });
  };

  const consentChange = (contact: NonNullable<typeof contacts.data>['contacts'][number], status: 'opted_in' | 'opted_out' | 'pending') => {
    const source = status === 'opted_in' ? window.prompt(t('Evidence note required for opt-in')) : undefined;
    if (status === 'opted_in' && !source?.trim()) return;
    if (status !== 'opted_in' && !window.confirm(t('Update this contact’s consent status?'))) return;
    updateContact.mutate({ contactId: contact.contactId, data: { consentStatus: status, ...(source ? { consentSource: source.trim() } : {}) } }, {
      onSuccess: async () => { await invalidateContacts(); setFeedback({ tone: 'success', message: t('Contact consent updated.') }); },
      onError: () => setFeedback({ tone: 'error', message: t('Contact update failed.') }),
    });
  };

  const renameContact = (contact: NonNullable<typeof contacts.data>['contacts'][number]) => {
    const name = window.prompt(t('Enter a new display name'), contact.displayName);
    if (!name?.trim() || name.trim() === contact.displayName) return;
    updateContact.mutate({ contactId: contact.contactId, data: { displayName: name.trim() } }, {
      onSuccess: async () => { await invalidateContacts(); setFeedback({ tone: 'success', message: t('Contact name updated.') }); },
      onError: () => setFeedback({ tone: 'error', message: t('Contact update failed.') }),
    });
  };

  const removeContact = (contact: NonNullable<typeof contacts.data>['contacts'][number]) => {
    if (!window.confirm(t('Deleting this contact also removes its message history. Continue?'))) return;
    deleteContact.mutate({ contactId: contact.contactId }, {
      onSuccess: async () => { await invalidateContacts(); await cache.invalidateQueries({ queryKey: getListAdminMessagesQueryKey() }); setFeedback({ tone: 'success', message: t('Contact deleted.') }); },
      onError: () => setFeedback({ tone: 'error', message: t('Contact deletion failed.') }),
    });
  };

  const removeMessage = (messageId: string) => {
    if (!window.confirm(t('Delete only this stored message record? A delivered WhatsApp message cannot be recalled.'))) return;
    deleteMessage.mutate({ messageId }, {
      onSuccess: async () => { await invalidateMessages(); setFeedback({ tone: 'success', message: t('Stored message record deleted.') }); },
      onError: () => setFeedback({ tone: 'error', message: t('Message deletion failed.') }),
    });
  };

  const sendableContacts = sendCandidates.data?.contacts ?? [];
  const selectedSendContact = sendableContacts.find((contact) => contact.contactId === sendContact);
  const ownerOptions = useMemo(() => accountList, [users.data]);
  const sendableForOwner = sendableContacts.filter((contact) => contact.ownerUserId === sendOwner);

  const submitSend = () => {
    if (!sendOwner || !sendContact || !sendText.trim()) return;
    if (!window.confirm(t('Send this message as the selected account to one recipient only?'))) return;
    sendMessage.mutate({ data: { ownerUserId: sendOwner, contactId: sendContact, text: sendText.trim() } }, {
      onSuccess: async () => {
        await Promise.all([invalidateMessages(), cache.invalidateQueries({ queryKey: getListAdminContactsQueryKey() })]);
        setSendText(''); setFeedback({ tone: 'success', message: t('Message send request completed.') });
      },
      onError: () => setFeedback({ tone: 'error', message: t('Admin message could not be sent.') }),
    });
  };

  if (adminCheck.isLoading) return <AdminSkeleton />;
  if (adminCheck.isError) return <div className="admin-state-panel panel" role="alert" data-testid="admin-access-error">
    <div className="admin-state-symbol admin-state-error"><AlertTriangle size={20} /></div><h2>{t('Admin access could not be checked')}</h2>
    <p>{t('Try again to verify your access before viewing platform information.')}</p>
    <button className="btn btn-secondary" type="button" onClick={() => void adminCheck.refetch()} data-testid="button-retry-admin-access"><RefreshCw size={14} />{t('Try again')}</button>
  </div>;
  if (!isAdmin) return <div className="admin-state-panel panel" role="status" data-testid="admin-access-denied">
    <div className="admin-state-symbol"><LockKeyhole size={20} /></div><span className="admin-overline">{t('Restricted area')}</span>
    <h2>{t('Admin access required')}</h2><p>{t('This workspace is limited to role-authorized administrators. Your account data remains private.')}</p>
  </div>;

  const overviewData = overview.data;
  const accountTotal = users.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(accountTotal / PAGE_SIZE));
  const displayAccounts = accountList.slice(offset, offset + PAGE_SIZE);
  const messageTotal = messages.data?.total ?? 0;
  const messagePages = Math.max(1, Math.ceil(messageTotal / PAGE_SIZE));
  const settingsOn = settings.data?.outboundMessagingEnabled === true;
  const onGlobalSetting = () => {
    if (!window.confirm(t(settingsOn ? 'Pause outbound messaging for every account?' : 'Resume outbound messaging for every account?'))) return;
    updateSettings.mutate({ data: { outboundMessagingEnabled: !settingsOn } }, {
      onSuccess: async () => { await Promise.all([cache.invalidateQueries({ queryKey: getGetAdminSystemSettingsQueryKey() }), cache.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() })]); setFeedback({ tone: 'success', message: t(!settingsOn ? 'Outbound messaging resumed.' : 'Outbound messaging paused.') }); },
      onError: () => setFeedback({ tone: 'error', message: t('System setting update failed.') }),
    });
  };

  return <div className="admin-page" data-testid="admin-control-center">
    <section className="admin-intro" data-testid="admin-intro">
      <div className="admin-intro-copy">
        <div className="admin-overline"><ShieldCheck size={13} />{t('Platform oversight')}</div>
        <h2>{t('ShareWa control center')}</h2>
        <p>{t('Manage accounts, consent records, message operations, and service safeguards from one restricted workspace.')}</p>
      </div>
      <div className="admin-privacy-note"><LockKeyhole size={16} /><span>{t('Authorized operations only')}<small>{t('Phone numbers remain masked. Pairing codes and WhatsApp credentials are never shown.')}</small></span></div>
    </section>

    {feedback && <div className={`admin-feedback ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'} data-testid="admin-feedback">
      {feedback.tone === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />}{feedback.message}
      <button type="button" aria-label={t('Dismiss notification')} onClick={() => setFeedback(null)} data-testid="button-dismiss-admin-feedback">×</button>
    </div>}

    <nav className="admin-tabs" aria-label={t('Admin sections')} data-testid="admin-tabs">
      {([
        ['overview', Activity, 'Overview'], ['accounts', Users, 'Accounts'], ['contacts', ContactRound, 'Contacts'],
        ['messages', MessageSquareText, 'Messages'], ['system', Shield, 'System'],
      ] as const).map(([key, Icon, label]) => <button key={key} type="button" className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)} data-testid={`tab-admin-${key}`}><Icon size={15} />{t(label)}</button>)}
    </nav>

    {tab === 'overview' && <div className="admin-tab-content" data-testid="admin-overview-section">
      {overview.isLoading ? <div className="admin-skeleton-metrics">{[0, 1, 2, 3].map((item) => <div className="panel admin-skeleton-card" key={item}><i /><i /><i /></div>)}</div> :
        overview.isError || !overviewData ? <div className="admin-inline-error" role="alert" data-testid="admin-overview-error"><span>{t('Platform overview is unavailable.')}</span><button type="button" className="text-link" onClick={() => void overview.refetch()} data-testid="button-retry-admin-overview">{t('Try again')}</button></div> :
          <section className="admin-overview" aria-label={t('Aggregate platform overview')} data-testid="admin-overview">
            <div className="admin-overview-heading"><div><span className="admin-overline">{t('Platform pulse')}</span><h3>{t('Aggregate health')}</h3></div><span className="admin-safe-mark"><Activity size={14} />{t('Live summary')}</span></div>
            <div className="admin-metric-grid">
              <AdminMetric label={t('Total accounts')} value={overviewData.totalUsers} detail={t('{{count}} administrators', { count: overviewData.totalAdmins })} icon={Users} accent testId="admin-metric-users" />
              <AdminMetric label={t('Suspended accounts')} value={overviewData.suspendedUsers} detail={t('Accounts currently suspended')} icon={LockKeyhole} testId="admin-metric-suspended" />
              <AdminMetric label={t('Pending deletion')} value={overviewData.deletionPendingUsers} detail={t('Deletion retry may be needed')} icon={RefreshCw} testId="admin-metric-deletion-pending" />
              <AdminMetric label={t('Contact records')} value={overviewData.totalContacts} detail={t('{{count}} opted in · {{out}} opted out', { count: overviewData.optedInContacts, out: overviewData.optedOutContacts })} icon={ContactRound} testId="admin-metric-contacts" />
              <AdminMetric label={t('Messages processed')} value={overviewData.totalMessages} detail={t('{{sent}} sent · {{delivered}} delivered', { sent: overviewData.sentMessages, delivered: overviewData.deliveredMessages })} icon={MessageSquareText} testId="admin-metric-messages" />
              <AdminMetric label={t('Delivery failures')} value={overviewData.failedMessages} detail={t('{{count}} contacts awaiting consent', { count: overviewData.pendingContacts })} icon={CircleHelp} testId="admin-metric-failures" />
            </div>
            <div className="admin-connection-strip" data-testid="admin-connection-health">
              <div className="admin-connection-label"><span className="admin-live-dot" /><span>{t('Account connections')}<small>{t('Across all workspace accounts')}</small></span></div>
              {connectionKeys.map((key) => <div className={`admin-connection-count ${key}`} key={key} data-testid={`admin-connection-${key}`}><span>{t(key)}</span><strong>{overviewData.connections?.[key] ?? 0}</strong></div>)}
            </div>
          </section>}
      {!overview.isLoading && !overview.isError && overviewData && <section className="admin-activity-section" data-testid="admin-activity-section">
        <div className="admin-section-heading"><div><span className="admin-overline">{t('Workspace signals')}</span><h3>{t('Recent platform activity')}</h3><p>{t('Activity log contains event type, account, and time only. Message bodies are never included.')}</p></div><span className="admin-count-badge">{overviewData.recentActivity.length} {t('events')}</span></div>
        {overviewData.recentActivity.length === 0 ? <div className="panel admin-empty admin-activity-empty" data-testid="admin-activity-empty"><Activity size={19} /><span>{t('No recent activity')}</span></div> :
          <div className="panel admin-activity-list" data-testid="admin-activity-list">{overviewData.recentActivity.map((event) => <div className="admin-activity-row" key={event.id} data-testid={`admin-activity-${event.id}`}>
            <span className="admin-activity-mark"><Activity size={14} /></span><span className="admin-activity-user"><strong>@{event.username}</strong><small>{t('Account activity')}</small></span>
            <span className="admin-activity-kind">{t(`activity:${event.kind}`)}</span><time>{dateLabel(event.createdAt, language)}</time>
          </div>)}</div>}
      </section>}
    </div>}

    {tab === 'accounts' && <section className="admin-section" data-testid="admin-accounts-section">
      <div className="admin-section-heading"><div><span className="admin-overline">{t('Access control')}</span><h3>{t('Account management')}</h3><p>{t('Role, account status, deletion, and session actions are audited.')}</p></div><span className="admin-count-badge">{accountTotal.toLocaleString(locales[language])} {t('accounts')}</span></div>
      {users.isLoading ? <div className="panel admin-table-skeleton" data-testid="admin-users-loading">{[0, 1, 2, 3, 4].map((item) => <div key={item}><i /><i /><i /></div>)}</div> :
        users.isError || !users.data ? <div className="admin-state-panel panel admin-small-state" role="alert" data-testid="admin-users-error"><AlertTriangle size={18} /><span>{t('Account list could not be loaded.')}</span><button type="button" className="text-link" onClick={() => void users.refetch()} data-testid="button-retry-admin-users">{t('Try again')}</button></div> :
          accountList.length === 0 ? <div className="panel admin-empty" data-testid="admin-users-empty"><div className="admin-state-symbol"><Users size={18} /></div><h4>{t('No accounts to display')}</h4><p>{t('There are no accounts on this page yet.')}</p></div> :
            <div className="panel admin-user-table-wrap"><table className="data-table admin-user-table" data-testid="admin-user-table">
              <thead><tr><th>{t('Account')}</th><th>{t('Connection')}</th><th>{t('Status')}</th><th>{t('Role')}</th><th>{t('Joined')}</th><th>{t('Actions')}</th></tr></thead>
              <tbody>{displayAccounts.map((account) => {
                const ownAccount = account.userId === currentUser.data?.userId;
                const safeRoleLock = lastActiveAdminRemovalBlocked(account);
                const pending = updateRole.isPending || updateStatus.isPending || deleteUser.isPending || disconnect.isPending;
                return <tr key={account.userId} data-testid={`admin-user-row-${account.userId}`}>
                  <td><div className="admin-user-identity"><span className="admin-user-avatar">{(account.fullName || account.username || '?').slice(0, 1).toUpperCase()}</span><span><strong>{account.fullName || account.username}</strong><small>@{account.username}{account.email ? ` · ${account.email}` : ''}</small></span></div></td>
                  <td><span className={`admin-status-dot ${account.connectionStatus}`} />{t(account.connectionStatus === 'awaiting_link' ? 'awaitingLink' : account.connectionStatus)}</td>
                  <td><span className={`admin-status-pill ${account.accountStatus}`} data-testid={`status-account-${account.userId}`}>{t(account.accountStatus === 'deletion_pending' ? 'Deletion pending' : account.accountStatus === 'suspended' ? 'Suspended' : 'Active')}</span></td>
                  <td><span className={`admin-role-pill${account.isAdmin ? ' administrator' : ''}`}>{account.isAdmin ? <><Shield size={12} />{t('Administrator')}</> : t('Member')}</span></td>
                  <td className="admin-date">{dateLabel(account.createdAt, language)}</td>
                  <td><div className="admin-actions">
                    <button className="btn btn-secondary btn-sm" type="button" disabled={pending || ownAccount && account.accountStatus === 'active' || (account.isAdmin && safeRoleLock)} onClick={() => changeRole(account.userId, account.isAdmin)} title={safeRoleLock ? t('The last active administrator cannot be removed.') : undefined} data-testid={`button-role-${account.userId}`}>{account.isAdmin ? t('Revoke role') : t('Make admin')}</button>
                    {account.accountStatus !== 'deletion_pending' && <button className="btn btn-secondary btn-sm" type="button" disabled={pending || ownAccount || account.isAdmin && account.accountStatus === 'active' && safeRoleLock} onClick={() => setAccountStatus(account)} data-testid={`button-status-${account.userId}`}>{t(account.accountStatus === 'suspended' ? 'Reactivate' : 'Suspend')}</button>}
                    <button className="btn btn-danger btn-sm" type="button" disabled={pending || ownAccount || account.isAdmin && safeRoleLock} onClick={() => removeAccount(account)} data-testid={`button-delete-account-${account.userId}`}>{account.accountStatus === 'deletion_pending' ? t('Retry deletion') : t('Delete')}</button>
                    {account.connectionStatus !== 'disconnected' && <button className="icon-btn danger" type="button" aria-label={t('Disconnect WhatsApp session')} disabled={pending} onClick={() => { if (window.confirm(t('Disconnect this account’s WhatsApp session? The account owner must reconnect and pair it again.'))) disconnect.mutate({ userId: account.userId }, { onSuccess: async () => { await invalidateOverviewUsers(); setFeedback({ tone: 'success', message: t('WhatsApp session disconnected.') }); }, onError: () => setFeedback({ tone: 'error', message: t('WhatsApp session disconnect failed.') }) }); }} data-testid={`button-disconnect-session-${account.userId}`}><Smartphone size={14} /></button>}
                  </div></td>
                </tr>;
              })}</tbody>
            </table><div className="admin-pagination" data-testid="admin-account-pagination"><span>{t('Page {{page}} of {{pages}}', { page: Math.floor(offset / PAGE_SIZE) + 1, pages: pageCount })}</span><div>
              <button className="icon-btn" type="button" aria-label={t('Previous page')} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} data-testid="button-admin-previous"><ChevronLeft size={16} /></button>
              <button className="icon-btn" type="button" aria-label={t('Next page')} disabled={offset + PAGE_SIZE >= accountTotal} onClick={() => setOffset(offset + PAGE_SIZE)} data-testid="button-admin-next"><ChevronRight size={16} /></button>
            </div></div></div>}
      <p className="admin-risk-note"><AlertTriangle size={14} />{t('Permanent account deletion removes all stored contacts and message data. The account owner is responsible for reconnecting WhatsApp.')}</p>
    </section>}

    {tab === 'contacts' && <section className="admin-section" data-testid="admin-contacts-section">
      <div className="admin-section-heading"><div><span className="admin-overline">{t('Consent operations')}</span><h3>{t('Contact records')}</h3><p>{t('Search across workspaces. Phone values are always masked.')}</p></div><span className="admin-count-badge">{(contacts.data?.total ?? 0).toLocaleString(locales[language])} {t('contacts')}</span></div>
      <div className="admin-toolbar"><label className="admin-search"><Search size={15} /><input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} className="field" placeholder={t('Search contacts')} aria-label={t('Search contacts')} data-testid="input-admin-contact-search" /></label>
        <select className="select" value={contactConsent} onChange={(event) => setContactConsent(event.target.value)} aria-label={t('Filter by permission')} data-testid="select-admin-contact-consent"><option value="all">{t('All contacts')}</option><option value="opted_in">{t('Permission recorded')}</option><option value="opted_out">{t('Opted out')}</option><option value="pending">{t('Not confirmed')}</option></select></div>
      {contacts.isLoading ? <div className="panel admin-table-skeleton" data-testid="admin-contacts-loading">{[0, 1, 2, 3].map((item) => <div key={item}><i /><i /><i /></div>)}</div> :
        contacts.isError || !contacts.data ? <div className="admin-inline-error" role="alert" data-testid="admin-contacts-error">{t('Contact list could not be loaded.')} <button type="button" className="text-link" onClick={() => void contacts.refetch()} data-testid="button-retry-admin-contacts">{t('Try again')}</button></div> :
          contacts.data.contacts.length === 0 ? <div className="panel admin-empty" data-testid="admin-contacts-empty"><div className="admin-state-symbol"><ContactRound size={18} /></div><h4>{t('No matching contacts')}</h4><p>{t('Try another search or permission filter.')}</p></div> :
            <div className="panel admin-user-table-wrap"><table className="data-table admin-contact-table" data-testid="admin-contact-table"><thead><tr><th>{t('Contact')}</th><th>{t('Account')}</th><th>{t('Phone')}</th><th>{t('Permission')}</th><th>{t('Source')}</th><th>{t('Actions')}</th></tr></thead>
              <tbody>{contacts.data.contacts.map((contact) => <tr key={contact.contactId} data-testid={`admin-contact-${contact.contactId}`}>
                <td><strong>{contact.displayName}</strong><small className="admin-cell-sub">{dateLabel(contact.createdAt, language)}</small></td><td>@{contact.ownerUsername}</td><td className="admin-date">{contact.phoneMasked}</td>
                <td><span className={`admin-status-pill ${contact.consentStatus}`}>{t(contact.consentStatus === 'opted_in' ? 'Permission recorded' : contact.consentStatus === 'opted_out' ? 'Opted out' : 'Not confirmed')}</span></td>
                <td className="admin-source">{contact.consentSource || '—'}</td><td><div className="admin-actions">
                  <button type="button" className="btn btn-secondary btn-sm" disabled={updateContact.isPending} onClick={() => renameContact(contact)} data-testid={`button-admin-contact-edit-${contact.contactId}`}>{t('Edit name')}</button>
                  {contact.consentStatus === 'opted_in' ? <button type="button" className="btn btn-secondary btn-sm" disabled={updateContact.isPending} onClick={() => consentChange(contact, 'opted_out')} data-testid={`button-admin-contact-optout-${contact.contactId}`}>{t('Opt out')}</button> :
                    <button type="button" className="btn btn-secondary btn-sm" disabled={updateContact.isPending} onClick={() => consentChange(contact, 'opted_in')} data-testid={`button-admin-contact-optin-${contact.contactId}`}>{t('Record opt-in')}</button>}
                  <button type="button" className="icon-btn danger" aria-label={t('Delete contact')} disabled={deleteContact.isPending} onClick={() => removeContact(contact)} data-testid={`button-admin-contact-delete-${contact.contactId}`}><Trash2 size={14} /></button>
                </div></td>
              </tr>)}</tbody></table></div>}
      <p className="admin-risk-note"><ShieldCheck size={14} />{t('Opt-in requires a source or evidence note. The server independently enforces consent checks before any send.')}</p>
    </section>}

    {tab === 'messages' && <section className="admin-section" data-testid="admin-messages-section">
      <div className="admin-section-heading"><div><span className="admin-overline">{t('Authorized message review')}</span><h3>{t('Message history')}</h3><p>{t('Bodies are visible only in this authorized admin area. Search results expose masked phones only.')}</p></div><span className="admin-count-badge">{messageTotal.toLocaleString(locales[language])} {t('messages')}</span></div>
      <section className="panel admin-send-panel" data-testid="admin-send-panel"><div className="admin-send-title"><div><span className="admin-overline">{t('One-recipient send')}</span><h4>{t('Send as an account')}</h4></div><Send size={17} /></div>
        <p className="admin-send-notice">{t('The API sends to one selected opted-in recipient only. Consent checks remain enforced server-side; confirm the recipient before sending.')}</p>
        <div className="admin-send-grid"><label><span className="field-label">{t('Sending account')}</span><select className="select" value={sendOwner} onChange={(event) => { setSendOwner(event.target.value); setSendContact(''); }} data-testid="select-admin-send-owner"><option value="">{t('Choose an account')}</option>{ownerOptions.map((account) => <option key={account.userId} value={account.userId}>@{account.username}</option>)}</select></label>
          <label><span className="field-label">{t('Opted-in recipient')}</span><select className="select" value={sendContact} onChange={(event) => setSendContact(event.target.value)} disabled={!sendOwner || sendCandidates.isLoading} data-testid="select-admin-send-contact"><option value="">{t('Choose one recipient')}</option>{sendableForOwner.map((contact) => <option key={contact.contactId} value={contact.contactId}>{contact.displayName} · {contact.phoneMasked}</option>)}</select></label></div>
        <label className="admin-message-compose"><span className="field-label">{t('Message body')}</span><textarea className="textarea" maxLength={4000} value={sendText} onChange={(event) => setSendText(event.target.value)} placeholder={t('Write a message…')} data-testid="textarea-admin-send-message" /></label>
        {sendCandidates.isError && <div className="admin-inline-error" role="alert">{t('Eligible recipients could not be loaded.')} <button type="button" className="text-link" onClick={() => void sendCandidates.refetch()}>{t('Try again')}</button></div>}
        {sendCandidates.isLoading && <div className="admin-inline-loading" data-testid="admin-send-candidates-loading">{t('Loading eligible recipients')}</div>}
        <div className="admin-send-bottom"><span>{selectedSendContact ? t('Selected recipient: {{name}} · {{phone}}', { name: selectedSendContact.displayName, phone: selectedSendContact.phoneMasked }) : t('One recipient only')}</span><button type="button" className="btn btn-primary" disabled={!sendOwner || !sendContact || !sendText.trim() || sendMessage.isPending || !settingsOn} onClick={submitSend} data-testid="button-admin-send-message">{sendMessage.isPending ? <><LoaderCircle className="admin-spin" size={14} />{t('Sending…')}</> : <><Send size={14} />{t('Review and send')}</>}</button></div>
        {!settings.isLoading && settings.data && !settingsOn && <p className="admin-inline-warning" data-testid="admin-outbound-paused-note">{t('Outbound messaging is paused globally. Resume it in System controls before sending.')}</p>}
      </section>
      <div className="admin-toolbar"><label className="admin-search"><Search size={15} /><input className="field" value={messageSearch} onChange={(event) => { setMessageSearch(event.target.value); setOffset(0); }} placeholder={t('Search message history')} aria-label={t('Search message history')} data-testid="input-admin-message-search" /></label>
        <select className="select" value={messageOwner} onChange={(event) => { setMessageOwner(event.target.value); setOffset(0); }} aria-label={t('Filter by account')} data-testid="select-admin-message-owner"><option value="">{t('All accounts')}</option>{accountList.map((account) => <option key={account.userId} value={account.userId}>@{account.username}</option>)}</select>
        <select className="select" value={messageStatus} onChange={(event) => { setMessageStatus(event.target.value); setOffset(0); }} aria-label={t('Filter by status')} data-testid="select-admin-message-status"><option value="all">{t('All statuses')}</option>{['queued', 'sent', 'delivered', 'failed'].map((status) => <option key={status} value={status}>{t(status === 'queued' ? 'Processing' : status[0].toUpperCase() + status.slice(1))}</option>)}</select></div>
      {messages.isLoading ? <div className="panel admin-table-skeleton" data-testid="admin-messages-loading">{[0, 1, 2, 3].map((item) => <div key={item}><i /><i /><i /></div>)}</div> :
        messages.isError || !messages.data ? <div className="admin-inline-error" role="alert" data-testid="admin-messages-error">{t('Message history could not be loaded.')} <button type="button" className="text-link" onClick={() => void messages.refetch()} data-testid="button-retry-admin-messages">{t('Try again')}</button></div> :
          messages.data.messages.length === 0 ? <div className="panel admin-empty" data-testid="admin-messages-empty"><div className="admin-state-symbol"><MessageSquareText size={18} /></div><h4>{t('No messages to display')}</h4><p>{t('Try another search or filter.')}</p></div> :
            <div className="admin-message-list" data-testid="admin-message-list">{messages.data.messages.map((message) => <article className="panel admin-message-record" key={message.id} data-testid={`admin-message-${message.id}`}>
              <div className="admin-message-meta"><div><strong>@{message.ownerUsername}</strong><span>{t('to')} {message.contactName} · {message.phoneMasked}</span></div><div className="admin-message-meta-right"><span className={`admin-status-pill ${message.status}`}>{t(message.status === 'queued' ? 'Processing' : message.status[0].toUpperCase() + message.status.slice(1))}</span><time>{dateLabel(message.createdAt, language)}</time><button type="button" className="icon-btn danger" aria-label={t('Delete message record')} disabled={deleteMessage.isPending} onClick={() => removeMessage(message.id)} data-testid={`button-admin-message-delete-${message.id}`}><Trash2 size={14} /></button></div></div>
              <p className="admin-message-body" data-testid={`text-admin-message-body-${message.id}`}>{message.text}</p>
            </article>)}
            <div className="admin-pagination" data-testid="admin-message-pagination"><span>{t('Page {{page}} of {{pages}}', { page: Math.floor(offset / PAGE_SIZE) + 1, pages: messagePages })}</span><div><button className="icon-btn" type="button" aria-label={t('Previous page')} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} data-testid="button-admin-message-previous"><ChevronLeft size={16} /></button><button className="icon-btn" type="button" aria-label={t('Next page')} disabled={offset + PAGE_SIZE >= messageTotal} onClick={() => setOffset(offset + PAGE_SIZE)} data-testid="button-admin-message-next"><ChevronRight size={16} /></button></div></div></div>}
      <p className="admin-risk-note"><AlertTriangle size={14} />{t('Deleting a message removes only its stored record. It cannot recall a message already delivered on WhatsApp.')}</p>
    </section>}

    {tab === 'system' && <section className="admin-section" data-testid="admin-system-section">
      <div className="admin-section-heading"><div><span className="admin-overline">{t('Service safeguards')}</span><h3>{t('System controls')}</h3><p>{t('Global outbound controls affect every account.')}</p></div></div>
      {settings.isLoading ? <div className="panel admin-setting-skeleton" data-testid="admin-settings-loading"><i /><i /></div> :
        settings.isError || !settings.data ? <div className="admin-inline-error" role="alert" data-testid="admin-settings-error">{t('System settings could not be loaded.')} <button className="text-link" type="button" onClick={() => void settings.refetch()} data-testid="button-retry-admin-settings">{t('Try again')}</button></div> :
          <div className={`panel admin-global-control${settingsOn ? '' : ' paused'}`} data-testid="admin-outbound-control">
            <div className="admin-global-icon">{settingsOn ? <Play size={18} /> : <Pause size={18} />}</div><div className="admin-global-copy"><span className="admin-overline">{t('Outbound WhatsApp messaging')}</span><h4>{t(settingsOn ? 'Messaging is enabled' : 'Messaging is paused')}</h4><p>{t('Updated {{time}}', { time: dateLabel(settings.data.updatedAt, language) })}</p><small>{t('A global pause blocks new outbound sends. Existing WhatsApp sessions remain connected.')}</small></div>
            <button type="button" className={`btn ${settingsOn ? 'btn-danger' : 'btn-primary'}`} disabled={updateSettings.isPending} onClick={onGlobalSetting} data-testid="button-toggle-outbound">{updateSettings.isPending ? <LoaderCircle className="admin-spin" size={14} /> : settingsOn ? <Pause size={14} /> : <Play size={14} />}{t(settingsOn ? 'Pause all messaging' : 'Resume all messaging')}</button>
          </div>}
      <div className="admin-system-note panel"><LockKeyhole size={16} /><p>{t('Session disconnect does not expose credentials or pairing codes. Reconnection and pairing remain the account owner’s responsibility.')}</p></div>
    </section>}

    <div className="admin-bottom-actions"><button type="button" className="admin-refresh-link" onClick={refreshEverything} data-testid="button-refresh-admin"><RefreshCw size={13} />{t('Refresh platform data')}</button><div className="admin-footnote"><LockKeyhole size={13} /><span>{t('Administrative actions are audited. Account deletion and message operations require explicit confirmation.')}</span></div></div>
  </div>;
}

export default AdminPage;
