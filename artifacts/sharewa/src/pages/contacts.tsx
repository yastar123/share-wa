import { useState, type FormEvent } from 'react';
import { useListContacts, useCreateContact, useUpdateContact, useDeleteContact, useUpdateContactConsent } from '@workspace/api-client-react';
import { useAppLanguage } from '@/lib/i18n';
import { Search, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getListContactsQueryKey, getGetDashboardSummaryQueryKey, getGetDashboardActivityQueryKey, getListMessagesQueryKey } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';

function LoadingPanel() { const { t } = useAppLanguage(); return <div className="panel p-6 text-center">{t('Loading...')}</div>; }
function ErrorBox({ onRetry }: { onRetry: () => void }) { const { t } = useAppLanguage(); return <div className="panel p-6 text-red-500">{t('Error loading data.')} <button onClick={onRetry}>{t('Retry')}</button></div>; }

export default function ContactsPage() {
  const { language, t } = useAppLanguage();
  const [search, setSearch] = useState('');
  const [consentFilter, setConsentFilter] = useState('all');
  const contactsQuery = useListContacts({ search: search || undefined, consent: consentFilter as any });
  const create = useCreateContact();
  const update = useUpdateContact();
  const remove = useDeleteContact();
  const consent = useUpdateContactConsent();
  const cache = useQueryClient();
  
  const contacts = contactsQuery.data || [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">{t('Contacts')}</h1>
        <div className="toolbar">
            <div className="search-field"><Search size={15} /><input className="field" placeholder={t('Search...')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        </div>
      </div>
      
      <div className="panel overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('Name')}</th>
              <th>{t('Phone')}</th>
              <th>{t('Status')}</th>
              <th>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map(contact => (
              <tr key={contact.id}>
                <td className="contact-cell">
                  <span className="contact-name">{contact.displayName}</span>
                </td>
                <td className="mono">{contact.phone}</td>
                <td>
                  <Badge
                    variant={contact.consentStatus === 'opted_out' ? 'destructive' : contact.consentStatus === 'pending' ? 'secondary' : 'default'}
                  >
                    {t(contact.consentStatus === 'opted_in' ? 'Permission recorded' : contact.consentStatus === 'opted_out' ? 'Opted out' : 'Not confirmed')}
                  </Badge>
                </td>
                <td>
                   <button className="icon-btn" onClick={() => remove.mutate({ contactId: contact.id }, { onSuccess: () => cache.invalidateQueries({ queryKey: getListContactsQueryKey() }) })}>
                     <Trash2 size={16} />
                   </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
