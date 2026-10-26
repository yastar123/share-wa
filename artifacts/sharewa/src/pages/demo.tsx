import { Activity, ArrowLeft, ArrowRight, Eye, ShieldCheck, Users } from "lucide-react";
import { Link } from "wouter";
import "./demo.css";

type DemoRole = "admin" | "user";

const demoAccounts = {
  admin: {
    title: "Administrator demo",
    email: "admin.demo@sharewa.example",
    password: "DemoAdmin!2026",
    route: "/demo/admin",
  },
  user: {
    title: "Pengguna demo",
    email: "user.demo@sharewa.example",
    password: "DemoUser!2026",
    route: "/demo/user",
  },
} as const;

export function DemoAccessPanel() {
  return (
    <section className="demo-access panel" aria-labelledby="demo-access-title">
      <div className="demo-access-heading">
        <div className="demo-access-icon"><Eye size={16} /></div>
        <div>
          <div className="demo-overline">PRATINJAU PUBLIK</div>
          <h2 id="demo-access-title">Akses demo</h2>
        </div>
      </div>
      <p className="demo-access-description">
        Jelajahi tampilan admin atau pengguna biasa menggunakan data contoh. Demo ini
        tidak terhubung ke akun, database, atau layanan WhatsApp.
      </p>
      <div className="demo-account-list">
        {(Object.keys(demoAccounts) as DemoRole[]).map((role) => {
          const account = demoAccounts[role];
          return (
            <article className="demo-account-card" key={role}>
              <div className="demo-account-title">
                {role === "admin" ? <ShieldCheck size={15} /> : <Users size={15} />}
                <strong>{account.title}</strong>
              </div>
              <div className="demo-credential">
                <span>Email demo</span>
                <code>{account.email}</code>
              </div>
              <div className="demo-credential">
                <span>Sandi demo</span>
                <code>{account.password}</code>
              </div>
              <Link className="btn btn-secondary demo-open-button" href={account.route}>
                Buka pratinjau {role === "admin" ? "admin" : "pengguna"}
                <ArrowRight size={14} />
              </Link>
            </article>
          );
        })}
      </div>
      <div className="demo-safety-note">
        Kredensial ini hanya contoh tampilan, bukan login Clerk. Pratinjau bersifat
        read-only dan memakai data fiktif.
      </div>
    </section>
  );
}

const demoContacts = [
  { name: "Dina Putri", phone: "+62 800-0000-0142", status: "Izin tercatat" },
  { name: "Bima Santoso", phone: "+62 800-0000-0187", status: "Izin tercatat" },
  { name: "Nadia Rahman", phone: "+62 800-0000-0231", status: "Menunggu konfirmasi" },
];

const demoUsers = [
  { name: "Raka Pratama", email: "raka.demo@sharewa.example", role: "Admin", status: "Aktif" },
  { name: "Ayu Lestari", email: "ayu.demo@sharewa.example", role: "Pengguna", status: "Aktif" },
  { name: "Dina Putri", email: "dina.demo@sharewa.example", role: "Pengguna", status: "Aktif" },
];

export function DemoWorkspace({ role }: { role: DemoRole }) {
  const isAdmin = role === "admin";
  const account = demoAccounts[role];
  const metrics = isAdmin
    ? [
        { label: "Akun contoh", value: "24", detail: "3 ditampilkan di demo" },
        { label: "Kontak", value: "127", detail: "Data fiktif" },
        { label: "Koneksi WhatsApp", value: "0", detail: "Tidak ada akun tertaut" },
        { label: "Pesan terkirim", value: "86", detail: "Riwayat contoh" },
      ]
    : [
        { label: "Kontak saya", value: "12", detail: "Semua milik akun demo" },
        { label: "Izin tercatat", value: "10", detail: "2 menunggu konfirmasi" },
        { label: "Pesan terkirim", value: "8", detail: "Riwayat contoh" },
        { label: "WhatsApp", value: "Belum terhubung", detail: "Demo tidak menautkan akun" },
      ];

  return (
    <main className="shell demo-shell">
      <header className="demo-topbar">
        <Link href="/sign-in" className="brand"><span className="brand-mark"><span>W</span></span>ShareWa</Link>
        <div className="demo-topbar-actions">
          <span className="demo-readonly"><Eye size={13} /> Pratinjau read-only</span>
          <Link href="/sign-in" className="btn btn-secondary btn-sm"><ArrowLeft size={14} /> Kembali ke login</Link>
        </div>
      </header>
      <div className="demo-workspace">
        <section className="demo-intro">
          <div className="demo-overline"><ShieldCheck size={13} /> DATA CONTOH · TIDAK TERHUBUNG KE DATABASE</div>
          <h1>{isAdmin ? "Pratinjau administrator" : "Pratinjau ruang kerja pengguna"}</h1>
          <p>
            {isAdmin
              ? "Lihat contoh ringkasan platform dan daftar akun. Halaman ini tidak memiliki akses admin yang sebenarnya."
              : "Lihat contoh ruang kerja pribadi, kontak dengan izin, dan status pesan."}
          </p>
          <div className="demo-viewer"><span className="demo-viewer-dot" />{account.email}</div>
        </section>

        <div className="demo-metrics">
          {metrics.map((metric) => (
            <article className="panel demo-metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.detail}</small>
            </article>
          ))}
        </div>

        <div className="demo-panels">
          <section className="panel demo-panel">
            <div className="demo-panel-heading">
              <div><h2>{isAdmin ? "Akun contoh" : "Kontak dengan izin"}</h2><p>Data fiktif untuk pratinjau.</p></div>
              <span className="demo-static-badge"><Eye size={12} /> Hanya lihat</span>
            </div>
            <div className="demo-table-wrap">
              {isAdmin ? (
                <table className="demo-table">
                  <thead><tr><th>Nama</th><th>Email</th><th>Peran</th><th>Status</th></tr></thead>
                  <tbody>{demoUsers.map((user) => <tr key={user.email}><td>{user.name}</td><td>{user.email}</td><td>{user.role}</td><td><span className="demo-status">{user.status}</span></td></tr>)}</tbody>
                </table>
              ) : (
                <table className="demo-table">
                  <thead><tr><th>Nama</th><th>Nomor contoh</th><th>Status izin</th></tr></thead>
                  <tbody>{demoContacts.map((contact) => <tr key={contact.phone}><td>{contact.name}</td><td>{contact.phone}</td><td><span className={contact.status === "Izin tercatat" ? "demo-status" : "demo-status demo-status-pending"}>{contact.status}</span></td></tr>)}</tbody>
                </table>
              )}
            </div>
          </section>

          <section className="panel demo-panel demo-activity-panel">
            <div className="demo-panel-heading">
              <div><h2>Aktivitas terbaru</h2><p>Contoh aktivitas, bukan data pengguna nyata.</p></div>
              <Activity size={17} />
            </div>
            <div className="demo-activity-row"><span className="demo-activity-icon"><Users size={14} /></span><div><strong>{isAdmin ? "Akun pengguna dibuat" : "Kontak ditambahkan"}</strong><small>Hari ini · data contoh</small></div></div>
            <div className="demo-activity-row"><span className="demo-activity-icon"><ShieldCheck size={14} /></span><div><strong>Izin kontak tercatat</strong><small>Kemarin · data contoh</small></div></div>
            <div className="demo-activity-row"><span className="demo-activity-icon"><Eye size={14} /></span><div><strong>Mode pratinjau aman</strong><small>Aksi dan pengiriman dinonaktifkan</small></div></div>
          </section>
        </div>

        <footer className="demo-footer">
          <span>Semua data di halaman ini dibuat khusus untuk demo.</span>
          <Link href={isAdmin ? demoAccounts.user.route : demoAccounts.admin.route}>
            Lihat pratinjau {isAdmin ? "pengguna" : "admin"} <ArrowRight size={13} />
          </Link>
        </footer>
      </div>
    </main>
  );
}
