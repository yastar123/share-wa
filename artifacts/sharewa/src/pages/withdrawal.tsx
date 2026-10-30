import { useAppLanguage } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function WithdrawalPage() {
  const { t } = useAppLanguage();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('Withdrawal')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('Balance')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold">Rp 0</div>
          <p className="text-sm text-muted-foreground">{t('Minimum withdrawal: Rp 20.000')}</p>
        </CardContent>
      </Card>
      
      <section className="panel p-6">
        <h2 className="text-lg font-semibold">{t('Request Withdrawal')}</h2>
        {/* Withdrawal form goes here */}
      </section>
    </div>
  );
}
