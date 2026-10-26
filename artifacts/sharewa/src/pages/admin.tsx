import './admin.css';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronRight,
  CircleHelp, LoaderCircle, LockKeyhole, RefreshCw, Shield, ShieldCheck, Users,
} from 'lucide-react';
import {
  getGetAdminOverviewQueryKey, getListAdminUsersQueryKey,
  useGetAdminMe, useGetAdminOverview, useListAdminUsers, useUpdateAdminUserRole,
} from '@workspace/api-client-react';
import { useAppLanguage } from '@/lib/i18n';

const PAGE_SIZE = 12;
const locales = { id: 'id-ID', en: 'en-US', zh: 'zh-CN' } as const;
const connectionKeys = ['connected', 'disconnected', 'awaitingLink', 'reconnecting', 'error'] as const;

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
    <strong>{value.toLocaleString(locales[language])}</strong>
    <small>{detail}</small>
  </div>;
}

function dateLabel(value: string, language: keyof typeof locales) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locales[language], { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function AdminPage() {
  const { language, t } = useAppLanguage();
  const cache = useQueryClient();
  const [offset, setOffset] = useState(0);
  const adminCheck = useGetAdminMe();
  const isAdmin = adminCheck.data?.isAdmin === true;
  const overview = useGetAdminOverview({ query: { enabled: isAdmin, queryKey: getGetAdminOverviewQueryKey() } });
  const users = useListAdminUsers({ limit: PAGE_SIZE, offset }, { query: { enabled: isAdmin, queryKey: getListAdminUsersQueryKey({ limit: PAGE_SIZE, offset }) } });
  const updateRole = useUpdateAdminUserRole();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const retry = () => {
    void adminCheck.refetch();
    void overview.refetch();
    void users.refetch();
  };

  if (adminCheck.isLoading) return <AdminSkeleton />;
  if (adminCheck.isError) return <div className="admin-state-panel panel" role="alert" data-testid="admin-access-error">
    <div className="admin-state-symbol admin-state-error"><AlertTriangle size={20} /></div>
    <h2>{t('Admin access could not be checked')}</h2><p>{t('Try again to verify your access before viewing platform information.')}</p>
    <button className="btn btn-secondary" type="button" onClick={() => void adminCheck.refetch()} data-testid="button-retry-admin-access"><RefreshCw size={14} />{t('Try again')}</button>
  </div>;
  if (!isAdmin) return <div className="admin-state-panel panel" role="status" data-testid="admin-access-denied">
    <div className="admin-state-symbol"><LockKeyhole size={20} /></div>
    <span className="admin-overline">{t('Restricted area')}</span>
    <h2>{t('Admin access required')}</h2><p>{t('This workspace is limited to role-authorized administrators. Your account data remains private.')}</p>
  </div>;

  const overviewData = overview.data;
  const userData = users.data;
  const lastAdminWouldBeRemoved = (isCurrentlyAdmin: boolean) =>
    isCurrentlyAdmin && (!overviewData || overviewData.totalAdmins <= 1);

  const changeRole = (userId: string, currentRole: boolean) => {
    if (lastAdminWouldBeRemoved(currentRole)) {
      setFeedback({ tone: 'error', message: overviewData
        ? t('The last administrator cannot be removed. Grant another admin role first.')
        : t('Administrator count is unavailable, so role removal is paused for safety.') });
      return;
    }
    const nextRole = !currentRole;
    updateRole.mutate({ userId, data: { isAdmin: nextRole } }, {
      onSuccess: async () => {
        await Promise.all([
          cache.invalidateQueries({ queryKey: getGetAdminOverviewQueryKey() }),
          cache.invalidateQueries({ queryKey: getListAdminUsersQueryKey() }),
        ]);
        setFeedback({ tone: 'success', message: t(nextRole ? 'Administrator role granted.' : 'Administrator role revoked.') });
      },
      onError: () => setFeedback({ tone: 'error', message: t('Role update failed. Please try again.') }),
    });
  };

  const total = userData?.total ?? 0;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const connection = overviewData?.connections;

  return <div className="admin-page">
    <section className="admin-intro" data-testid="admin-intro">
      <div className="admin-intro-copy">
        <div className="admin-overline"><ShieldCheck size={13} />{t('Platform oversight')}</div>
        <h2>{t('A safer view of ShareWa')}</h2>
        <p>{t('Manage account access and review platform-wide signals. Private conversations stay private.')}</p>
      </div>
      <div className="admin-privacy-note"><LockKeyhole size={16} /><span>{t('Aggregate health only')}<small>{t('No message content, phone numbers, or session credentials are shown.')}</small></span></div>
    </section>

    {feedback && <div className={`admin-feedback ${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'} data-testid="admin-role-feedback">
      {feedback.tone === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />}{feedback.message}
      <button type="button" aria-label={t('Dismiss notification')} onClick={() => setFeedback(null)} data-testid="button-dismiss-admin-feedback">×</button>
    </div>}

    {overview.isLoading ? <div className="admin-skeleton-metrics">{[0, 1, 2, 3].map((item) => <div className="panel admin-skeleton-card" key={item}><i /><i /><i /></div>)}</div> :
      overview.isError || !overviewData ? <div className="admin-inline-error" role="alert" data-testid="admin-overview-error"><span>{t('Platform overview is unavailable.')}</span><button type="button" className="text-link" onClick={() => void overview.refetch()} data-testid="button-retry-admin-overview">{t('Try again')}</button></div> :
        <section className="admin-overview" aria-label={t('Aggregate platform overview')} data-testid="admin-overview">
          <div className="admin-overview-heading"><div><span className="admin-overline">{t('Platform pulse')}</span><h3>{t('Aggregate health')}</h3></div><span className="admin-safe-mark"><Activity size={14} />{t('Live summary')}</span></div>
          <div className="admin-metric-grid">
            <AdminMetric label={t('Total accounts')} value={overviewData.totalUsers} detail={t('{{count}} administrators', { count: overviewData.totalAdmins })} icon={Users} accent testId="admin-metric-users" />
            <AdminMetric label={t('Contact records')} value={overviewData.totalContacts} detail={t('{{count}} opted in · {{out}} opted out', { count: overviewData.optedInContacts, out: overviewData.optedOutContacts })} icon={ShieldCheck} testId="admin-metric-contacts" />
            <AdminMetric label={t('Messages processed')} value={overviewData.totalMessages} detail={t('{{sent}} sent · {{delivered}} delivered', { sent: overviewData.sentMessages, delivered: overviewData.deliveredMessages })} icon={Activity} testId="admin-metric-messages" />
            <AdminMetric label={t('Delivery failures')} value={overviewData.failedMessages} detail={t('{{count}} contacts awaiting consent', { count: overviewData.pendingContacts })} icon={CircleHelp} testId="admin-metric-failures" />
          </div>
          <div className="admin-connection-strip" data-testid="admin-connection-health">
            <div className="admin-connection-label"><span className="admin-live-dot" /><span>{t('Account connections')}<small>{t('Across all workspace accounts')}</small></span></div>
            {connectionKeys.map((key) => <div className={`admin-connection-count ${key}`} key={key} data-testid={`admin-connection-${key}`}><span>{t(key)}</span><strong>{connection?.[key] ?? 0}</strong></div>)}
          </div>
        </section>}

    <section className="admin-users-section">
      <div className="admin-section-heading">
        <div><span className="admin-overline">{t('Access control')}</span><h3>{t('Account roles')}</h3><p>{t('Grant or revoke administrator access. No contact or conversation details are available here.')}</p></div>
        <span className="admin-count-badge" data-testid="admin-user-total">{total.toLocaleString(locales[language])} {t('accounts')}</span>
      </div>
      {users.isLoading ? <div className="panel admin-table-skeleton" aria-label={t('Loading accounts')} data-testid="admin-users-loading">{[0, 1, 2, 3, 4].map((item) => <div key={item}><i /><i /><i /></div>)}</div> :
        users.isError || !userData ? <div className="admin-state-panel panel admin-small-state" role="alert" data-testid="admin-users-error"><AlertTriangle size={18} /><span>{t('Account list could not be loaded.')}</span><button type="button" className="text-link" onClick={() => void users.refetch()} data-testid="button-retry-admin-users">{t('Try again')}</button></div> :
          userData.users.length === 0 ? <div className="panel admin-empty" data-testid="admin-users-empty"><div className="admin-state-symbol"><Users size={18} /></div><h4>{t('No accounts to display')}</h4><p>{t('There are no accounts on this page yet.')}</p></div> :
            <div className="panel admin-user-table-wrap">
              <table className="data-table admin-user-table" data-testid="admin-user-table">
                <thead><tr><th>{t('Account')}</th><th>{t('Language')}</th><th>{t('Connection')}</th><th>{t('Role')}</th><th>{t('Joined')}</th><th className="admin-role-action-head">{t('Role action')}</th></tr></thead>
                <tbody>{userData.users.map((user) => {
                  const locked = lastAdminWouldBeRemoved(user.isAdmin);
                  const pending = updateRole.isPending && updateRole.variables?.userId === user.userId;
                  return <tr key={user.userId} data-testid={`admin-user-row-${user.userId}`}>
                    <td><div className="admin-user-identity"><span className="admin-user-avatar">{(user.fullName || user.username || '?').slice(0, 1).toUpperCase()}</span><span><strong>{user.fullName || user.username}</strong><small>@{user.username}{user.email ? ` · ${user.email}` : ''}</small></span></div></td>
                    <td><span className="admin-language">{t(user.language === 'id' ? 'Indonesian' : user.language === 'zh' ? 'Chinese' : 'English')}</span></td>
                    <td><span className={`admin-status-dot ${user.connectionStatus}`} />{t(user.connectionStatus === 'awaiting_link' ? 'awaitingLink' : user.connectionStatus)}</td>
                    <td><span className={`admin-role-pill${user.isAdmin ? ' administrator' : ''}`} data-testid={`admin-role-${user.userId}`}>{user.isAdmin ? <><Shield size={12} />{t('Administrator')}</> : t('Member')}</span></td>
                    <td className="admin-date">{dateLabel(user.createdAt, language)}</td>
                    <td className="admin-role-action-cell">{user.isAdmin ?
                      <button className="btn btn-secondary btn-sm admin-role-button" type="button" disabled={pending || updateRole.isPending || locked} title={locked ? (overviewData ? t('The last administrator cannot be removed.') : t('Administrator count is unavailable, so role removal is paused for safety.')) : t('Revoke administrator role')} onClick={() => changeRole(user.userId, true)} data-testid={`button-revoke-admin-${user.userId}`}>{pending ? <LoaderCircle className="admin-spin" size={13} /> : null}{t('Revoke role')}</button> :
                      <button className="btn btn-secondary btn-sm admin-role-button grant" type="button" disabled={pending || updateRole.isPending} onClick={() => changeRole(user.userId, false)} data-testid={`button-grant-admin-${user.userId}`}>{pending ? <LoaderCircle className="admin-spin" size={13} /> : null}{t('Make admin')}</button>}
                    </td>
                  </tr>;
                })}</tbody>
              </table>
              <div className="admin-pagination" data-testid="admin-pagination"><span>{t('Page {{page}} of {{pages}}', { page: pageNumber, pages: pageCount })}</span><div>
                <button className="icon-btn" type="button" aria-label={t('Previous page')} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} data-testid="button-admin-previous"><ChevronLeft size={16} /></button>
                <button className="icon-btn" type="button" aria-label={t('Next page')} disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} data-testid="button-admin-next"><ChevronRight size={16} /></button>
              </div></div>
            </div>}
    </section>

    {!overview.isLoading && !overview.isError && overviewData && <section className="admin-activity-section">
      <div className="admin-section-heading"><div><span className="admin-overline">{t('Workspace signals')}</span><h3>{t('Recent platform activity')}</h3><p>{t('Activity is summarized by event type only; private message content is never displayed.')}</p></div><span className="admin-count-badge">{overviewData.recentActivity.length} {t('events')}</span></div>
      {overviewData.recentActivity.length === 0 ? <div className="panel admin-empty admin-activity-empty" data-testid="admin-activity-empty"><Activity size={19} /><span>{t('No recent activity')}</span></div> :
        <div className="panel admin-activity-list" data-testid="admin-activity-list">{overviewData.recentActivity.map((event) => <div className="admin-activity-row" key={event.id} data-testid={`admin-activity-${event.id}`}>
          <span className="admin-activity-mark"><Activity size={14} /></span>
          <span className="admin-activity-user"><strong>@{event.username}</strong><small>{t('Account activity')}</small></span>
          <span className="admin-activity-kind">{t('activity:' + event.kind)}</span>
          <time>{dateLabel(event.createdAt, language)}</time>
        </div>)}</div>}
    </section>}

    {(overview.isError || users.isError) && <button type="button" className="admin-refresh-link" onClick={retry} data-testid="button-refresh-admin">{t('Refresh platform data')}<ArrowRight size={13} /></button>}
    <div className="admin-footnote"><LockKeyhole size={13} /><span>{t('Role changes are audited. Platform data is presented in aggregate to protect user privacy.')}</span></div>
  </div>;
}

export default AdminPage;
