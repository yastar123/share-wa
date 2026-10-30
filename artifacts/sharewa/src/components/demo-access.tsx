import { ArrowRight, ShieldCheck, User } from "lucide-react";

export function DemoAccessPanel({ onFill }: { onFill: (email: string, password: string) => void }) {
  const demoAccounts = [
    {
      role: "admin",
      title: "Administrator demo",
      email: "admin.demo@sharewa.example",
      password: "DemoAdminPassword123",
      icon: ShieldCheck,
      desc: "Akses penuh fitur admin",
    },
    {
      role: "user",
      title: "Pengguna demo",
      email: "user.demo@sharewa.example",
      password: "DemoUserPassword123",
      icon: User,
      desc: "Lihat ruang kerja personal",
    },
  ];

  return (
    <div className="panel p-5 mt-6 border-primary/20 bg-primary/5 rounded-xl shadow-2xl">
      <h3 className="text-sm font-bold mb-4 text-primary uppercase tracking-wider text-center">Akses Demo Cepat</h3>
      <div className="grid gap-3">
        {demoAccounts.map((account) => {
          const Icon = account.icon;
          return (
            <button
              key={account.role}
              type="button"
              className="flex items-start gap-4 p-4 text-left bg-black/40 border border-white/10 rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-all group"
              onClick={() => onFill(account.email, account.password)}
            >
              <div className="mt-1 p-2 rounded-lg bg-white/5 group-hover:bg-primary/20 transition-colors">
                <Icon size={20} className="text-muted-foreground group-hover:text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white truncate">{account.title}</div>
                <div className="text-[11px] text-muted-foreground mt-1 line-clamp-1">{account.desc}</div>
              </div>
              <ArrowRight size={18} className="mt-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-4 text-center leading-relaxed opacity-60">
        Klik salah satu untuk mengisi, lalu tekan tombol "Masuk".
      </p>
    </div>
  );
}


